require('dotenv').config();
/**
 * ChimpGPT - A Discord bot with AI capabilities
 *
 * This bot integrates OpenAI's GPT model with Discord to provide
 * conversational AI, weather lookups, time zone information,
 * Quake server statistics, and Wolfram Alpha queries.
 *
 * @module ChimpGPT
 * @author Brett
 * @version 1.9.1
 */

const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');
// const fs = require('fs'); // Unused import
const { lookupWeather, lookupExtendedForecast } = require('../services/weatherLookup');
const simplifiedWeather = require('../services/simplified-weather');
const lookupTime = require('../services/timeLookup');
// lookupQuakeServer moved to quakeStatsHandler.js
const lookupWolfram = require('../services/wolframLookup'); // Still needed for handleFunctionCall
// generateImage, enhanceImagePrompt moved to imageGenerationHandler.js
const pluginManager = require('../plugins/pluginManager');
const commandHandler = require('../commands/commandHandler');
const ClientEventHandler = require('./eventHandlers/clientEventHandler');
const { initStatusManager } = require('../web/statusManager');
const { handleImageGeneration } = require('../handlers/imageGenerationHandler');
const { handleQuakeStats } = require('../handlers/quakeStatsHandler');
const { handleDirectMessage } = require('../handlers/directMessageHandler');
const { formatSubtext } = require('../handlers/responseFormatter');
const {
  storeMessageRelationship,
  messageRelationships,
} = require('../handlers/messageRelationships');

// Import loggers
const { logger, discord: discordLogger, openai: openaiLogger } = require('./logger');

// Import performance monitoring
const performanceMonitor = require('../middleware/performanceMonitor');

// Import validated configuration
const config = require('./configValidator');

// Import the function results optimization patch
const optimizationPatch = require('../conversation/optimizationPatch');
logger.info(
  `Function results optimization patch applied: ${optimizationPatch.success ? 'SUCCESS' : 'FAILED'}`
);

// Note: We're now using a direct replacement for the conversation manager
// instead of a patch to avoid circular dependency issues
logger.info('Using simple conversation optimizer for better performance');

// Configuration option to disable plugins for better performance
// This can be controlled via environment variable or set directly
const DISABLE_PLUGINS = process.env.DISABLE_PLUGINS !== 'false'; // Default to disabled for better performance

// Import rate limiter
const {
  checkUserRateLimit,
  checkImageGenerationRateLimit,
  constants: { IMAGE_GEN_POINTS },
} = require('../middleware/rateLimiter');

// Import health check system
const {
  trackApiCall,
  trackError,
  // handleStatsCommand, // Moved to imageGenerationHandler.js
  trackRateLimit,
} = require('./healthCheck');

// Import stats storage for graceful shutdown
const statsStorage = require('./statsStorage');

// Import malicious user manager for tracking suspicious behavior

// Module-level variable for status manager

// Status manager already imported above

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// Log bot version at startup
const { version: botVersion } = require('../../package.json');
logger.info(`ChimpGPT starting up - version ${botVersion}`);
// Initialize Discord client with proper intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages, // Add intent for DMs
    GatewayIntentBits.GuildMessageReactions, // Required for reaction collectors
    GatewayIntentBits.DirectMessageReactions, // Required for DM reaction collectors
  ],
});

// Import conversation manager - dynamically selected based on configuration
// This will use either blended or individual conversation mode based on USE_BLENDED_CONVERSATIONS setting
const {
  // manageConversation, // Now used directly in directMessageHandler.js and messageEventHandler.js
  shutdown: shutdownConversations,
} = require('../conversation/conversationManagerSelector');

const loadingEmoji = config.LOADING_EMOJI || '⏳';
const allowedChannelIDs = config.CHANNEL_ID; // Already an array from configValidator

// Status manager instance (will be initialized when client is ready)
let statusManager = null;

/**
 * Processes a message using OpenAI's GPT model
 *
 * This function sends the conversation context to OpenAI's API and handles the response.
 * It uses the latest user message from the conversation log for processing.
 * It includes function calling capabilities for weather, time, Quake server stats,
 * and Wolfram Alpha queries.
 *
 * @param {string} content - The user's message content (fallback if conversation log is empty)
 * @param {Array<Object>} conversationLog - The conversation history
 * @returns {Promise<Object>} The response from OpenAI
 * @throws {Error} If the API call fails
 */

/**
 * Generates a natural language response based on function results
 *
 * After a function call is made, this function sends the result back to OpenAI
 * to generate a natural language response that explains the data in a user-friendly way.
 *
 * @param {Object} functionResult - The result from the called function
 * @param {Array<Object>} conversationLog - The conversation history
 * @param {string|null} functionName - The name of the function that was called
 * @returns {Promise<string>} A natural language response explaining the function result
 */
async function generateNaturalResponse(
  functionResult,
  conversationLog,
  functionName = null,
  timings = null
) {
  try {
    openaiLogger.debug({ functionName }, 'Generating natural response from function result');

    // Get the last user message to provide context
    const lastUserMessage =
      [...conversationLog].reverse().find(msg => msg.role === 'user')?.content || '';

    // Create a system message with instructions based on function type
    const systemMessage = {
      role: 'system',
      content: 'Use the function result to provide a helpful and natural response to the user.',
    };

    // For time lookups, provide special instructions
    if (functionName === 'lookupTime') {
      systemMessage.content = `
        The user has asked about the time in a specific location. The function has returned the current time information.
        
        When responding:
        1. Be conversational and natural, maintaining your personality.
        2. The bot's primary users are in Australia and New Zealand (timezone Pacific/Auckland, UTC+13).
        3. When relevant, include the time difference between the user's timezone (Pacific/Auckland) and the requested location.
        4. You may include interesting facts about time zones or the location if appropriate.
        5. Format the response in a clear, readable way.
        
        Original user question: "${lastUserMessage}"
      `;
    }

    // For weather lookups, provide special instructions
    else if (functionName === 'lookupWeather' || functionName === 'lookupExtendedForecast') {
      systemMessage.content = `
        The user has asked about the weather in a specific location. The function has returned the current weather information.
        
        When responding:
        1. Be conversational and natural, maintaining your personality.
        2. Focus on the key weather details: current temperature, condition, and any other relevant information.
        3. If this is an extended forecast, mention the forecast for the next few days.
        4. Format the response in a clear, readable way.
        5. If the data indicates it's mock weather data (has _isMock property), subtly indicate this is an estimate without explicitly saying it's mock data.
        
        Original user question: "${lastUserMessage}"
      `;
    }

    // Log the function result size for debugging
    const resultSize =
      typeof functionResult === 'object'
        ? JSON.stringify(functionResult).length
        : String(functionResult).length;
    openaiLogger.debug({ resultSize, functionName }, 'Function result size');

    // Convert function result to string if it's an object, with proper handling for large objects
    let functionResultContent;
    if (typeof functionResult === 'object') {
      // For weather data, extract only the essential information to reduce size
      if (functionName === 'lookupWeather' || functionName === 'lookupExtendedForecast') {
        const essentialData = {
          location: functionResult.location
            ? {
                name: functionResult.location.name,
                country: functionResult.location.country,
                localtime: functionResult.location.localtime,
              }
            : null,
          current: functionResult.current
            ? {
                temp_c: functionResult.current.temp_c,
                condition: functionResult.current.condition,
                humidity: functionResult.current.humidity,
                wind_kph: functionResult.current.wind_kph,
                wind_dir: functionResult.current.wind_dir,
              }
            : null,
          forecast: functionResult.forecast
            ? {
                forecastday: functionResult.forecast.forecastday?.map(day => ({
                  date: day.date,
                  day: {
                    maxtemp_c: day.day.maxtemp_c,
                    mintemp_c: day.day.mintemp_c,
                    condition: day.day.condition,
                  },
                })),
              }
            : null,
          _isMock: functionResult._isMock,
        };
        functionResultContent = JSON.stringify(essentialData);
      } else {
        functionResultContent = JSON.stringify(functionResult);
      }
    } else {
      functionResultContent = String(functionResult);
    }

    openaiLogger.debug('Preparing messages for OpenAI API call');
    const messages = [
      systemMessage,
      ...conversationLog,
      { role: 'function', name: 'function_response', content: functionResultContent },
    ];

    // Add a timeout to the OpenAI API call to prevent the bot from getting stuck
    openaiLogger.debug('Sending request to OpenAI with timeout');
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI API call timed out after 15 seconds')), 15000);
    });

    const response = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-4.1-nano', // Using faster model for better responsiveness
        messages: messages,
      }),
      timeoutPromise,
    ]);

    // Track successful OpenAI API call
    trackApiCall('openai');
    if (timings?.apiCalls) {
      timings.apiCalls.openai = (timings.apiCalls.openai || 0) + 1;
    }
    openaiLogger.info('Successfully received response from OpenAI');

    const responseContent = response.choices[0].message.content;
    openaiLogger.debug({ responseLength: responseContent.length }, 'Response content length');

    return responseContent;

    // This line is now handled in the try/catch block above
  } catch (error) {
    // Track OpenAI API error
    trackError('openai');

    openaiLogger.error({ error }, 'Error generating natural response');
    return `Here's what I found: ${JSON.stringify(functionResult, null, 2)}`;
  }
}

// Command handler system already imported at top of file

// Track in-progress operations
const inProgressOperations = new Set();

// messageRelationships moved to ../handlers/messageRelationships.js

// storeMessageRelationship function moved to ../handlers/messageRelationships.js

// Handle message deletion

/**
 * Handles requests for Quake server statistics
 *
 * This function retrieves Quake server statistics and updates the message
 * with the formatted results. It uses the configured ELO display mode.
 *
 * @param {Object} feedbackMessage - The Discord message to update with results
 * @returns {Promise<boolean>} True if successful, false if an error occurred
 */
// handleQuakeStats function moved to ../handlers/quakeStatsHandler.js

/**
 * Handles image generation requests
 *
 * This function processes image generation requests using GPT Image-1,
 * downloads the generated image, and sends it to the Discord channel.
 *
 * @param {Object} parameters - Parameters for image generation
 * @param {Object} message - The Discord message to update
 * @param {Array} [conversationLog=[]] - The conversation history
 * @returns {Promise<void>}
 */
// handleImageGeneration function moved to ../handlers/imageGenerationHandler.js
// Updated to use dependency injection pattern
async function handleImageGenerationWrapper(
  parameters,
  message,
  conversationLog = [],
  startTime = null,
  usage = {},
  apiCalls = {}
) {
  return await handleImageGeneration(
    parameters,
    message,
    conversationLog,
    startTime,
    usage,
    apiCalls,
    formatSubtext,
    storeMessageRelationship,
    statusManager
  );
}

// Legacy function for compatibility - remove after migration

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
 * @returns {Promise<void>}
 */
async function handleFunctionCall(
  gptResponse,
  feedbackMessage,
  conversationLog,
  userIdFromMessage,
  startTime = Date.now(),
  timings = {},
  originalMessage = null
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
        // First, check if image generation is disabled WITHOUT actually generating an image
        // This was causing a double image generation issue
        // const imageGeneration = require('../services/imageGeneration'); // Unused import

        // Check image generation is enabled using both environment variable and config
        // This matches the logic used in imageGeneration.js for consistency
        const isEnabled =
          process.env.ENABLE_IMAGE_GENERATION === 'true' || config.ENABLE_IMAGE_GENERATION === true;
        const testResult = {
          success: isEnabled,
          error: isEnabled ? null : 'Image generation is currently disabled',
          prompt: gptResponse.parameters.prompt,
        };

        discordLogger.info(
          {
            isEnabled,
            envValue: process.env.ENABLE_IMAGE_GENERATION,
            configValue: config.ENABLE_IMAGE_GENERATION,
            prompt: gptResponse.parameters.prompt,
            userId: userIdFromMessage,
          },
          'Image generation request - checking if enabled'
        );

        // If image generation is disabled, fall back to a natural language response
        if (!testResult.success && testResult.error === 'Image generation is currently disabled') {
          discordLogger.warn(
            {
              prompt: gptResponse.parameters.prompt,
              userId: userIdFromMessage,
              envValue: process.env.ENABLE_IMAGE_GENERATION,
              configValue: config.ENABLE_IMAGE_GENERATION,
            },
            'Image generation is disabled, falling back to natural language response'
          );

          // Track denied image request for analytics
          trackError('gptimage_disabled');

          // Inform the user that image generation is disabled but we'll provide a text response
          await feedbackMessage.edit(
            '❌ Image generation is currently disabled. Let me describe what you are looking for instead...'
          );

          // Get the original user message from the conversation log
          const _userMessage =
            conversationLog.find(msg => msg.role === 'user')?.content ||
            `Can you describe ${gptResponse.parameters.prompt}?`;

          // Create a new prompt asking GPT to describe the image instead of generating it
          const descriptionPrompt = [
            ...conversationLog.filter(
              msg =>
                msg.role !== 'user' || conversationLog.indexOf(msg) !== conversationLog.length - 1
            ),
            {
              role: 'user',
              content: `Since image generation is disabled, please provide a detailed description of what an image of "${gptResponse.parameters.prompt}" might look like.`,
            },
          ];

          // Create a mock function result for the image description
          const mockImageResult = {
            description: `Image description for prompt: ${gptResponse.parameters.prompt}`,
            prompt: gptResponse.parameters.prompt,
            disabled: true,
          };
          // Get a natural language response from GPT
          const description = await generateNaturalResponse(
            mockImageResult,
            descriptionPrompt,
            'generateImage'
          );

          // Update the feedback message with the description
          await feedbackMessage.edit(description);

          // Add the response to the conversation log
          conversationLog.push({
            role: 'assistant',
            content: description,
          });

          // Track the API call and return
          trackApiCall('gpt');
          performanceMonitor.stopTimer(functionCallTimerId, { success: true });
          return;
        }

        // If image generation is enabled, proceed as normal
        // IMPORTANT FIX: Update the start time right before calling handleImageGeneration
        // This ensures we don't count the disabled check as part of initialization
        feedbackMessage.imageGenerationStartTime = Date.now();
        discordLogger.debug(
          { time: feedbackMessage.imageGenerationStartTime },
          'Updated start time before calling handleImageGeneration'
        );

        await handleImageGenerationWrapper(
          gptResponse.parameters,
          feedbackMessage,
          conversationLog,
          startTime,
          gptResponse.usage,
          timings.apiCalls
        );
        trackApiCall('gptimage');
        if (timings.apiCalls) timings.apiCalls.gptimage++;
        return;
      } catch (error) {
        trackError('gptimage');
        discordLogger.error({ error }, 'Error in image generation');

        // If this was a content policy violation, we've already shown the message
        if (error.isContentPolicyViolation) {
          discordLogger.info('Content policy violation handled');
          return;
        }

        // Check if the error is about image generation being disabled
        if (error.message && error.message.includes('Image generation is currently disabled')) {
          discordLogger.warn(
            { prompt: gptResponse.parameters.prompt },
            'Caught disabled error in catch block, falling back to natural language response'
          );

          // Inform the user that image generation is disabled but we'll provide a text response
          await feedbackMessage.edit(
            '❌ Image generation is currently disabled. Let me describe what you are looking for instead...'
          );

          // Get the original user message from the conversation log
          const _userMessage =
            conversationLog.find(msg => msg.role === 'user')?.content ||
            `Can you describe ${gptResponse.parameters.prompt}?`;

          // Create a mock function result for the image description
          const mockImageResult = {
            description: `Image description for prompt: ${gptResponse.parameters.prompt}`,
            prompt: gptResponse.parameters.prompt,
            disabled: true,
          };
          // Create a new prompt asking GPT to describe the image instead of generating it
          const descriptionPrompt = [
            ...conversationLog.filter(
              msg =>
                msg.role !== 'user' || conversationLog.indexOf(msg) !== conversationLog.length - 1
            ),
            {
              role: 'user',
              content: `Since image generation is disabled, please provide a detailed description of what an image of "${gptResponse.parameters.prompt}" might look like.`,
            },
          ];

          // Get a natural language response from GPT
          const description = await generateNaturalResponse(
            mockImageResult,
            descriptionPrompt,
            'generateImage'
          );

          // Update the feedback message with the description
          await feedbackMessage.edit(description);

          // Add the response to the conversation log
          conversationLog.push({
            role: 'assistant',
            content: description,
          });

          // Track the API call and return
          trackApiCall('gpt');
          performanceMonitor.stopTimer(functionCallTimerId, { success: true });
          return;
        }

        // For other errors, show a generic error message
        await feedbackMessage.edit(
          '❌ An error occurred while generating the image. Please try again later.'
        );
        return;
      }
    case 'getVersion':
      try {
        // Import the version utilities
        const { generateVersionResponse } = require('../../utils/versionSelfQuery');

        // Get parameters with defaults
        const detailed = gptResponse.parameters?.detailed === true;
        const technical = gptResponse.parameters?.technical === true;

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
      discordLogger.warn({ functionName: gptResponse.functionName }, 'Unknown function name');
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

// formatSubtext function moved to ../handlers/responseFormatter.js

// handleDirectMessage function moved to ../handlers/directMessageHandler.js

// Ready event handler removed - functionality has been moved to ClientEventHandler

/**
 * Initialize and start the Discord bot
 *
 * This function initializes the bot and logs in to Discord.
 * It's exposed to allow the bot to be started from other modules.
 *
 * @returns {Promise<void>}
 */
async function startBot() {
  discordLogger.info('Attempting to log in to Discord');
  try {
    // Initialize client event handler before connecting
    const _clientEventHandler = new ClientEventHandler(client, config, {
      openai,
      allowedChannelIDs,
      loadingEmoji,
      DISABLE_PLUGINS,
      inProgressOperations,
      messageRelationships,
      handleFunctionCall,
      handleDirectMessage,
      formatSubtext,
      storeMessageRelationship,
      statusManager: { instance: null }, // Will be set by the handler
    });
    discordLogger.info('Client event handler initialized');

    // Load plugins before connecting to Discord
    discordLogger.info('Loading plugins...');
    const pluginCount = await pluginManager.loadPlugins();
    discordLogger.info({ pluginCount }, 'Plugins loaded successfully');

    // Load commands
    discordLogger.info('Loading commands...');
    const commandCount = await commandHandler.loadCommands();
    discordLogger.info({ commandCount }, 'Commands loaded successfully');

    // Connect to Discord
    await client.login(config.DISCORD_TOKEN);
    discordLogger.info('Successfully logged in to Discord');

    // Initialize status manager for functions in main file
    // Note: ClientEventHandler also initializes its own instance
    statusManager = initStatusManager(client);
    discordLogger.info('Status manager initialized for main file functions');

    // Log conversation mode configuration
    const conversationMode = {
      blended: config.USE_BLENDED_CONVERSATIONS,
      replyContext: config.ENABLE_REPLY_CONTEXT,
      maxPerUser: config.MAX_MESSAGES_PER_USER_BLENDED,
    };
    const modeDescription = conversationMode.blended
      ? conversationMode.replyContext
        ? 'Blended with Reply Context'
        : 'Blended Only'
      : conversationMode.replyContext
        ? 'Individual with Reply Context'
        : 'Individual Only';

    discordLogger.info(
      {
        conversationMode: modeDescription,
        blendedConversations: conversationMode.blended,
        replyContext: conversationMode.replyContext,
        maxMessagesPerUser: conversationMode.maxPerUser,
      },
      'Conversation mode configuration'
    );

    // Execute onBotStart hooks for plugins
    await pluginManager.executeHook('onBotStart', client);
  } catch (error) {
    discordLogger.fatal({ error }, 'Failed to start bot');
    throw error;
  }
}

/**
 * Gracefully shut down the bot and all related services
 *
 * This function handles the graceful shutdown of the bot, ensuring that
 * all connections are properly closed, pending operations are completed,
 * and resources are released before the process exits.
 *
 * @param {string} signal - The signal that triggered the shutdown
 * @param {Error} [error] - Optional error that caused the shutdown
 * @returns {Promise<void>}
 */
async function shutdownGracefully(signal, error) {
  let exitCode = 0;
  const shutdownStart = Date.now();

  try {
    discordLogger.info({ signal }, 'Graceful shutdown initiated');

    if (error) {
      discordLogger.error({ error }, 'Shutdown triggered by error');
      exitCode = 1;
    }

    // Set a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      discordLogger.fatal('Forced exit due to shutdown timeout');
      process.exit(exitCode || 1);
    }, 10000); // 10 seconds timeout

    // Clear the timeout if we exit normally
    forceExitTimeout.unref();

    // 1. Execute plugin shutdown hooks
    try {
      discordLogger.info('Executing plugin shutdown hooks');
      await pluginManager.executeHook('onBotShutdown');
      discordLogger.info('Plugin shutdown hooks executed successfully');
    } catch (shutdownError) {
      discordLogger.error({ error: shutdownError }, 'Error executing plugin shutdown hooks');
    }

    // 2. Save any pending data
    try {
      discordLogger.info('Saving pending statistics');
      const { stats } = require('./healthCheck');
      await statsStorage.saveStats(stats);
      discordLogger.info('Statistics saved successfully');
    } catch (saveError) {
      discordLogger.error({ error: saveError }, 'Error saving statistics during shutdown');
    }

    // 3. Save conversations using the optimized storage
    try {
      discordLogger.info('Shutting down conversation manager');
      await shutdownConversations();
      discordLogger.info('Conversation manager shut down successfully');
    } catch (saveError) {
      discordLogger.error({ error: saveError }, 'Error shutting down conversation manager');
    }

    // 4. Close Discord connection
    try {
      discordLogger.info('Destroying Discord client');
      client.destroy();
      discordLogger.info('Discord client destroyed successfully');
    } catch (discordError) {
      discordLogger.error({ error: discordError }, 'Error destroying Discord client');
    }

    // 5. Clean up optimization patch resources
    try {
      logger.info('Cleaning up optimization patch resources');
      await optimizationPatch.shutdown();
      logger.info('Optimization resources cleaned up successfully');
    } catch (optimizationError) {
      logger.error({ error: optimizationError }, 'Error cleaning up optimization patch resources');
    }

    // Note: Conversation optimization resources are now cleaned up in step 3

    // 7. Close any open API connections or pending requests
    // This is a placeholder - add specific cleanup for any other services as needed

    // 8. Log successful shutdown
    const shutdownDuration = Date.now() - shutdownStart;
    discordLogger.info({ durationMs: shutdownDuration }, 'Graceful shutdown completed');

    // Exit with appropriate code
    process.exit(exitCode);
  } catch (shutdownError) {
    discordLogger.fatal({ error: shutdownError }, 'Fatal error during shutdown process');
    process.exit(1);
  }
}

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
process.on('SIGINT', () => shutdownGracefully('SIGINT'));
process.on('SIGHUP', () => shutdownGracefully('SIGHUP'));

// Discord connection event listeners removed - functionality has been moved to ClientEventHandler

// Handle uncaught exceptions and unhandled promise rejections
process.on('uncaughtException', error => {
  shutdownGracefully('uncaughtException', error);
});

process.on('unhandledRejection', reason => {
  shutdownGracefully('unhandledRejection', new Error(`Unhandled promise rejection: ${reason}`));
});

// Start the bot if this file is run directly
if (require.main === module) {
  startBot().catch(error => {
    discordLogger.error({ error }, 'Failed to start bot');
    shutdownGracefully('startupError', error);
  });
}

// Export the bot functionality for use in other modules
module.exports = {
  client,
  startBot,
  shutdownGracefully,
  stats: require('./healthCheck').stats,
};
