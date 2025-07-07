const { openai: openaiLogger } = require('../logger');
const { trackApiCall, trackError } = require('../healthCheck');

/**
 * Generates a natural language response based on function results
 *
 * After a function call is made, this function sends the result back to OpenAI
 * to generate a natural language response that explains the data in a user-friendly way.
 *
 * @param {Object} functionResult - The result from the called function
 * @param {Array<Object>} conversationLog - The conversation history
 * @param {string|null} functionName - The name of the function that was called
 * @param {Object|null} timings - Timing object for performance tracking
 * @param {Object} openai - OpenAI client instance
 * @returns {Promise<string>} A natural language response explaining the function result
 */
async function generateNaturalResponse(
  functionResult,
  conversationLog,
  functionName = null,
  timings = null,
  openai
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

module.exports = {
  generateNaturalResponse,
};
