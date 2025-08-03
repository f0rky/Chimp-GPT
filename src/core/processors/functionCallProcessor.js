const { discord: discordLogger } = require('../logger');
const performanceMonitor = require('../../middleware/performanceMonitor');
const {
  checkUserRateLimit,
  checkImageGenerationRateLimit,
  constants: { IMAGE_GEN_POINTS },
} = require('../../middleware/rateLimiter');
const { trackApiCall, trackError, trackRateLimit } = require('../healthCheck');
const lookupTime = require('../../services/timeLookup');
const { lookupWeather, lookupExtendedForecast } = require('../../services/weatherLookup');
const simplifiedWeather = require('../../services/simplified-weather');
const lookupWolfram = require('../../services/wolframLookup');
const { handleImageGeneration } = require('../../handlers/imageGenerationHandler');
const { handleQuakeStats } = require('../../handlers/quakeStatsHandler');

/**
 * Handles function calls from OpenAI's response
 *
 * This function processes function calls detected in OpenAI's response,
 * executes the appropriate function with the provided arguments, and
 * generates a natural language response based on the function result.
 * It also handles rate limiting for API-intensive functions.
 *
 * @param {Object} gptResponse - The response from OpenAI containing the function call
 * @param {Object} feedbackMessage - The Discord message to update with results
 * @param {Array<Object>} conversationLog - The conversation history
 * @param {string} userIdFromMessage - User ID for rate limiting
 * @param {number} startTime - Start time for timing calculations
 * @param {Object} timings - Timing object for performance tracking
 * @param {Object} originalMessage - The original user message
 * @param {string} loadingEmoji - Loading emoji to display
 * @param {Object} statusManager - Status manager instance
 * @param {Function} generateNaturalResponse - Function to generate natural responses
 * @param {Function} formatSubtext - Function to format response subtext
 * @param {Function} storeMessageRelationship - Function to store message relationships
 * @param {Object} pfpManager - PFP manager instance for saving images
 * @returns {Promise<void>}
 */
async function handleFunctionCall(
  gptResponse,
  feedbackMessage,
  conversationLog,
  userIdFromMessage,
  startTime = Date.now(),
  timings = {},
  originalMessage = null,
  loadingEmoji,
  statusManager,
  generateNaturalResponse,
  formatSubtext,
  storeMessageRelationship,
  pfpManager = null
) {
  // Start function call timer
  const functionCallTimerId = performanceMonitor.startTimer('function_call', {
    functionName: gptResponse.functionName,
    hasParameters: !!gptResponse.parameters,
  });
  const loadingMessages = {
    lookupTime: 'Checking watch...',
    lookupWeather: 'Looking outside...',
    lookupExtendedForecast: "Let me ping the cloud, and I don't mean the fluffy ones...",
    getWolframShortAnswer: 'Consulting Wolfram Alpha...',
    quakeLookup: 'Checking server stats...',
    getVersion: 'Checking my version...',
  };

  // Special handling for image generation to match the format used in handleImageGeneration
  if (gptResponse.functionName === 'generateImage') {
    // Record the time when we start the image generation process
    const imageStartTime = Date.now();
    discordLogger.debug(
      { time: imageStartTime },
      'Starting image generation process in handleFunctionCall'
    );

    const initialMessage = `🎨 Creating your image... (0s)

🔄 Currently: ⚙️ Initializing...`;
    await feedbackMessage.edit(initialMessage);

    // Store the start time in a property on the message object so handleImageGeneration can use it
    feedbackMessage.imageGenerationStartTime = imageStartTime;
  } else {
    await feedbackMessage.edit(
      `${loadingEmoji} ${loadingMessages[gptResponse.functionName] || 'Processing...'}`
    );
  }

  const userId = userIdFromMessage; // Use the ID passed from messageCreate

  // Define rate limit costs for different function calls - reduced to be more permissive
  const functionCosts = {
    lookupTime: 1,
    lookupWeather: 1,
    lookupExtendedForecast: 2,
    getWolframShortAnswer: 2,
    quakeLookup: 1,
    generateImage: 1, // Image generation has its own specialized rate limiter
    getVersion: 0.5, // Very low cost for version queries
  };

  // Special handling for image generation with dedicated rate limiter
  if (gptResponse.functionName === 'generateImage') {
    // Use the specialized image generation rate limiter (3 per minute)
    const imageRateLimitResult = await checkImageGenerationRateLimit(userId);

    if (imageRateLimitResult.limited) {
      discordLogger.info(
        {
          userId,
          functionName: gptResponse.functionName,
          secondsBeforeNext: imageRateLimitResult.secondsBeforeNext,
        },
        'User rate limited for image generation'
      );

      // Track rate limit in health check system
      trackRateLimit(userId);

      await feedbackMessage.edit(
        `⏱️ You can only generate ${IMAGE_GEN_POINTS} images per minute. Please wait ${imageRateLimitResult.secondsBeforeNext} seconds before generating another image.`
      );
      return;
    }
  } else {
    // Apply general rate limits for other functions
    const cost = functionCosts[gptResponse.functionName] || 1;
    const rateLimitResult = await checkUserRateLimit(userId, cost, {
      // More permissive rate limits for general API usage
      points: 30,
      duration: 30, // 30 seconds for better responsiveness
    });

    // If user is rate limited for this function, inform them
    if (rateLimitResult.limited) {
      discordLogger.info(
        {
          userId,
          functionName: gptResponse.functionName,
          secondsBeforeNext: rateLimitResult.secondsBeforeNext,
        },
        'User rate limited for function call'
      );

      // Track rate limit in health check system
      trackRateLimit(userId);

      await feedbackMessage.edit(
        `⏱️ Rate limit reached. Please wait ${rateLimitResult.secondsBeforeNext} seconds before trying again.`
      );
      return;
    }
  }

  // Rate limiting is now handled in the conditional blocks above

  let functionResult;
  switch (gptResponse.functionName) {
    case 'lookupTime':
      try {
        const timeTimerId = performanceMonitor.startTimer('time_api', {
          location: gptResponse.parameters.location,
        });
        functionResult = await lookupTime(gptResponse.parameters.location);
        performanceMonitor.stopTimer(timeTimerId, { success: true });
        trackApiCall('time');
        if (timings.apiCalls) timings.apiCalls.time++;
      } catch (error) {
        trackError('time');
        throw error;
      }
      break;
    case 'lookupWeather':
      try {
        // Get the original weather data for status updates
        const weatherData = await lookupWeather(gptResponse.parameters.location);
        trackApiCall('weather');
        if (timings.apiCalls) timings.apiCalls.weather++;
        discordLogger.info(
          { location: gptResponse.parameters.location, weatherData, source: 'lookupWeather_case' },
          'Weather data fetched in handleFunctionCall'
        );

        // Update status if we have valid weather data
        if (
          weatherData &&
          weatherData.location &&
          weatherData.current &&
          weatherData.current.condition &&
          weatherData.current.condition.text
        ) {
          statusManager.trackWeatherLookup(
            weatherData.location.name,
            weatherData.current.condition.text
          );
        } else {
          discordLogger.warn(
            { weatherData },
            'Weather data incomplete or has errors, not updating status'
          );
        }

        // Use the simplified implementation to get a natural language response
        performanceMonitor.startTimer('weather_api', {
          location: gptResponse.parameters.location,
        });
        const userQuestion =
          conversationLog.find(msg => msg.role === 'user')?.content ||
          `What's the weather in ${gptResponse.parameters.location}?`;

        const response = await simplifiedWeather.getWeatherResponse(
          gptResponse.parameters.location,
          userQuestion,
          weatherData // Pass the prefetched data
        );

        // Update the feedback message directly with the response
        await feedbackMessage.edit(response);

        // Add the response to the conversation log
        conversationLog.push({
          role: 'assistant',
          content: response,
        });

        // Stop timer and return early since we've already handled the response
        performanceMonitor.stopTimer(functionCallTimerId, { success: true });
        return;
      } catch (error) {
        trackError('weather');
        discordLogger.error({ error }, 'Error in weather lookup');
        await feedbackMessage.edit(
          'I encountered an error while checking the weather. Please try again later.'
        );
        return;
      }
    case 'lookupExtendedForecast':
      try {
        // Get the original weather data for status updates
        const weatherData = await lookupExtendedForecast(
          gptResponse.parameters.location,
          gptResponse.parameters.days
        );
        trackApiCall('weather');
        discordLogger.info(
          {
            location: gptResponse.parameters.location,
            days: gptResponse.parameters.days,
            weatherData,
            source: 'lookupExtendedForecast_case',
          },
          'Weather data fetched in handleFunctionCall'
        );

        // Update status if we have valid weather data
        if (
          weatherData &&
          weatherData.location &&
          weatherData.current &&
          weatherData.current.condition &&
          weatherData.current.condition.text
        ) {
          statusManager.trackWeatherLookup(
            weatherData.location.name,
            weatherData.current.condition.text
          );
        } else {
          discordLogger.warn(
            { weatherData },
            'Weather data incomplete or has errors, not updating status'
          );
        }

        // Use the simplified implementation to get a natural language response
        const userQuestion =
          conversationLog.find(msg => msg.role === 'user')?.content ||
          `What's the ${gptResponse.parameters.days}-day forecast for ${gptResponse.parameters.location}?`;

        const response = await simplifiedWeather.getWeatherResponse(
          gptResponse.parameters.location,
          userQuestion,
          weatherData // Pass the prefetched data
        );

        // Update the feedback message directly with the response
        await feedbackMessage.edit(response);

        // Add the response to the conversation log
        conversationLog.push({
          role: 'assistant',
          content: response,
        });

        // Stop timer and return early since we've already handled the response
        performanceMonitor.stopTimer(functionCallTimerId, { success: true });
        return;
      } catch (error) {
        trackError('weather');
        discordLogger.error({ error }, 'Error in extended forecast lookup');
        await feedbackMessage.edit(
          'I encountered an error while checking the forecast. Please try again later.'
        );
        return;
      }
    case 'getWolframShortAnswer':
      try {
        const wolframTimerId = performanceMonitor.startTimer('wolfram_api', {
          query: gptResponse.parameters.query,
        });
        functionResult = await lookupWolfram.getWolframShortAnswer(gptResponse.parameters.query);
        performanceMonitor.stopTimer(wolframTimerId, { success: true });
        trackApiCall('wolfram');
        if (timings.apiCalls) timings.apiCalls.wolfram++;
      } catch (error) {
        trackError('wolfram');
        throw error;
      }
      break;
    case 'quakeLookup':
      try {
        await handleQuakeStats(feedbackMessage, loadingEmoji, statusManager);
        trackApiCall('quake');
        if (timings.apiCalls) timings.apiCalls.quake++;
        return;
      } catch (error) {
        trackError('quake');
        throw error;
      }
    case 'generateImage':
      try {
        // Call the extracted image generation handler with dependency injection
        await handleImageGeneration(
          gptResponse.parameters,
          feedbackMessage,
          conversationLog,
          startTime,
          gptResponse.usage,
          timings.apiCalls,
          formatSubtext,
          storeMessageRelationship,
          statusManager,
          pfpManager
        );
        trackApiCall('gptimage');
        if (timings.apiCalls) timings.apiCalls.gptimage++;
        return;
      } catch (error) {
        trackError('gptimage');
        discordLogger.error({ error }, 'Error in image generation');
        await feedbackMessage.edit(
          '❌ An error occurred while generating the image. Please try again later.'
        );
        return;
      }
    case 'getVersion':
      try {
        // Import the version utilities
        const { generateVersionResponse } = require('../utils/versionSelfQuery');

        // Get parameters with defaults
        const detailed = gptResponse.parameters?.detailed === true;
        const technical = gptResponse.parameters?.technical === true;

        // Import config for version generation
        const config = require('../configValidator');

        // Generate the version response
        const versionResponse = generateVersionResponse({
          detailed,
          technical,
          config,
        });

        // Update the message with the version response
        await feedbackMessage.edit(versionResponse);

        // Add the response to the conversation log
        conversationLog.push({
          role: 'assistant',
          content: versionResponse,
        });

        // Track this as a successful API call for stats
        trackApiCall('version_query', true);

        // Stop timer and return early since we've already handled the response
        performanceMonitor.stopTimer(functionCallTimerId, { success: true });
        return;
      } catch (error) {
        trackError('other');
        discordLogger.error({ error }, 'Error in version lookup');
        await feedbackMessage.edit(
          'I encountered an error while checking my version. Please try again later.'
        );
        return;
      }
    default:
      discordLogger.warn(
        {
          functionName: gptResponse.functionName,
          availableFunctions: [
            'lookupTime',
            'lookupWeather',
            'lookupExtendedForecast',
            'getWolframShortAnswer',
            'quakeLookup',
            'generateImage',
            'getVersion',
          ],
          parameters: gptResponse.parameters,
        },
        'Unknown function name - this may indicate a mismatch between OpenAI function definitions and processor'
      );
      functionResult = { error: `Unknown function: ${gptResponse.functionName}` };
  }

  try {
    // Log the function result for debugging
    discordLogger.debug(
      { functionName: gptResponse.functionName },
      'Generating natural response from function result'
    );

    const naturalResponse = await generateNaturalResponse(
      functionResult,
      conversationLog,
      gptResponse.functionName,
      timings
    );

    if (naturalResponse?.trim()) {
      conversationLog.push({
        role: 'assistant',
        content: naturalResponse,
      });

      // Calculate standardized subtext
      const subtext = formatSubtext(startTime, gptResponse.usage, timings.apiCalls);
      const maxLength = 2000 - subtext.length - 3;

      let finalResponse = naturalResponse;
      if (finalResponse.length > maxLength) {
        finalResponse = finalResponse.slice(0, maxLength) + '...';
      }
      finalResponse += subtext;

      await feedbackMessage.edit(finalResponse);

      // Store message relationship for context preservation
      if (originalMessage) {
        const contextType = gptResponse.functionName;
        const contextContent =
          finalResponse.slice(0, 100) + (finalResponse.length > 100 ? '...' : '');
        storeMessageRelationship(originalMessage, feedbackMessage, contextType, contextContent);
      }
    } else {
      // If no natural response was generated, provide a direct response with the data
      let directResponse = '';

      if (
        gptResponse.functionName === 'lookupWeather' ||
        gptResponse.functionName === 'lookupExtendedForecast'
      ) {
        if (functionResult && functionResult.location && functionResult.current) {
          directResponse = `Current weather in ${functionResult.location.name}: ${functionResult.current.condition.text}, ${functionResult.current.temp_c}°C`;

          // Add forecast if available
          if (
            functionResult.forecast &&
            functionResult.forecast.forecastday &&
            functionResult.forecast.forecastday.length > 0
          ) {
            directResponse += '\n\nForecast:';
            functionResult.forecast.forecastday.forEach(day => {
              directResponse += `\n${day.date}: ${day.day.condition.text}, ${day.day.maxtemp_c}°C / ${day.day.mintemp_c}°C`;
            });
          }
        } else {
          directResponse = 'Weather data could not be retrieved. Please try again later.';
        }
      } else {
        directResponse =
          "I retrieved the information but couldn't generate a natural response. Here's the raw data:\n\n" +
          JSON.stringify(functionResult, null, 2).slice(0, 1500);
      }

      // Add timing and token info to direct response
      // Add standardized subtext to direct response
      const subtext = formatSubtext(startTime, gptResponse.usage, timings.apiCalls);
      const maxLength = 2000 - subtext.length - 3;

      if (directResponse.length > maxLength) {
        directResponse = directResponse.slice(0, maxLength) + '...';
      }
      directResponse += subtext;

      await feedbackMessage.edit(directResponse);

      // Store message relationship for context preservation
      if (originalMessage) {
        const contextType = gptResponse.functionName;
        const contextContent =
          directResponse.slice(0, 100) + (directResponse.length > 100 ? '...' : '');
        storeMessageRelationship(originalMessage, feedbackMessage, contextType, contextContent);
      }
    }
  } catch (error) {
    discordLogger.error(
      { error, functionName: gptResponse.functionName },
      'Error in natural response generation'
    );

    // Provide a fallback response with the raw data
    let fallbackResponse =
      "I encountered an error while processing the response, but here's what I found:\n\n";

    if (
      gptResponse.functionName === 'lookupWeather' ||
      gptResponse.functionName === 'lookupExtendedForecast'
    ) {
      if (functionResult && functionResult.location && functionResult.current) {
        fallbackResponse += `Current weather in ${functionResult.location.name}: ${functionResult.current.condition.text}, ${functionResult.current.temp_c}°C`;
      } else {
        fallbackResponse += 'Weather data could not be retrieved properly.';
      }
    } else {
      fallbackResponse += JSON.stringify(functionResult, null, 2).slice(0, 1500);
    }

    await feedbackMessage.edit(fallbackResponse);
  }
}

module.exports = {
  handleFunctionCall,
};
