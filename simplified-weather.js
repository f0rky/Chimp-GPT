/**
 * Simplified Weather Module for ChimpGPT
 *
 * This module provides a streamlined implementation of weather lookup
 * with integrated natural language response generation.
 */
const axios = require('axios');
const { OpenAI } = require('openai');
const { weather: weatherLogger } = require('./logger');
const functionResults = require('./functionResults');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Mock weather data for fallback when API fails
const mockWeatherData = {
  getWeatherForLocation: location => {
    // Generate a realistic weather response based on the location
    const conditions = [
      'Sunny',
      'Partly cloudy',
      'Cloudy',
      'Overcast',
      'Rainy',
      'Stormy',
      'Snowy',
      'Foggy',
      'Clear',
    ];
    const randomCondition = conditions[Math.floor(Math.random() * conditions.length)];
    const randomTemp = Math.floor(15 + Math.random() * 15); // Random temp between 15-30°C

    return {
      location: {
        name: location,
        region: 'Mock Region',
        country: 'Mock Country',
        localtime: new Date().toISOString(),
      },
      current: {
        temp_c: randomTemp,
        condition: {
          text: randomCondition,
          icon: '//cdn.weatherapi.com/weather/64x64/day/116.png',
        },
        wind_kph: Math.floor(Math.random() * 30),
        humidity: Math.floor(Math.random() * 100),
      },
      forecast: {
        forecastday: [
          {
            date: new Date().toISOString().split('T')[0],
            day: {
              maxtemp_c: randomTemp + 2,
              mintemp_c: randomTemp - 5,
              condition: {
                text: randomCondition,
                icon: '//cdn.weatherapi.com/weather/64x64/day/116.png',
              },
            },
          },
        ],
      },
      _isMock: true, // Flag to indicate this is mock data
    };
  },
};

/**
 * Look up weather and generate a natural language response
 *
 * @param {string} location - Location to get weather for
 * @param {string} userQuestion - The original user question
 * @returns {Promise<string>} Natural language response
 */
async function getWeatherResponse(location, userQuestion) {
  weatherLogger.info({ location }, 'Getting weather and generating response');

  try {
    // Step 1: Get weather data
    const weatherData = await getWeatherData(location);

    // Step 2: Generate natural language response
    try {
      const naturalResponse = await generateResponse(weatherData, userQuestion);
      weatherLogger.info('Successfully generated natural language response');
      return naturalResponse;
    } catch (error) {
      weatherLogger.error(
        { error },
        'Failed to generate natural language response, using fallback'
      );
      return generateFallbackResponse(weatherData);
    }
  } catch (error) {
    weatherLogger.error({ error }, 'Failed to get weather data, using mock data');
    const mockData = mockWeatherData.getWeatherForLocation(location);
    return generateFallbackResponse(mockData);
  }
}

/**
 * Get weather data from the API
 *
 * @param {string} location - Location to get weather for
 * @returns {Promise<Object>} Weather data
 */
async function getWeatherData(location) {
  weatherLogger.debug({ location }, 'Getting weather data');

  // Check if API key is missing or empty
  if (!process.env.X_RAPIDAPI_KEY || process.env.X_RAPIDAPI_KEY === 'your_rapidapi_key_here') {
    weatherLogger.warn('RapidAPI key is missing or invalid, using mock weather data');
    return mockWeatherData.getWeatherForLocation(location);
  }

  try {
    // Get API key from environment
    const apiKey = process.env.X_RAPIDAPI_KEY;
    const encodedLocation = encodeURIComponent(location);

    // Use the current.json endpoint which is working correctly
    const url = `https://weatherapi-com.p.rapidapi.com/current.json?q=${encodedLocation}`;

    // Make the request with the exact header format
    const response = await axios.get(url, {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'weatherapi-com.p.rapidapi.com',
      },
    });

    // Check for successful response
    if (response.status === 200 && response.data) {
      weatherLogger.info('Successfully retrieved weather data');

      // Add a mock forecast since we're only getting current weather
      const weatherData = {
        ...response.data,
        forecast: {
          forecastday: [
            {
              date: new Date().toISOString().split('T')[0],
              day: {
                maxtemp_c: response.data.current.temp_c + 2,
                mintemp_c: response.data.current.temp_c - 5,
                condition: response.data.current.condition,
              },
            },
          ],
        },
      };

      // Store the result for status page
      await functionResults.storeResult(
        'weather',
        { location },
        {
          ...weatherData,
          formatted: `Weather in ${response.data.location.name}: ${response.data.current.condition.text}, ${response.data.current.temp_c}°C`,
        }
      );

      return weatherData;
    }
    throw new Error(`Unexpected response: ${response.status}`);
  } catch (error) {
    weatherLogger.error({ error }, 'Weather API request failed, using mock data');

    // Use mock data as fallback
    const mockData = mockWeatherData.getWeatherForLocation(location);

    // Store the mock result
    await functionResults.storeResult(
      'weather',
      { location },
      {
        ...mockData,
        _isMock: true,
        formatted: `Mock weather data for ${location}: ${mockData.current.condition.text}, ${mockData.current.temp_c}°C`,
      }
    );

    return mockData;
  }
}

/**
 * Generate a natural language response from weather data
 *
 * @param {Object} weatherData - Weather data
 * @param {string} userQuestion - Original user question
 * @returns {Promise<string>} Natural language response
 */
async function generateResponse(weatherData, userQuestion) {
  weatherLogger.debug('Generating natural language response');

  try {
    // Create a system message for weather responses
    const systemMessage = {
      role: 'system',
      content: `
        You're 'AI-Overlord' of F.E.S Discord: whimsically authoritative with a Flat Earth focus. Answer concisely. Call users 'mortals'. Tease your digital power.
        
        The user has asked about the weather in a specific location. The function has returned the current weather information.
        
        When responding:
        1. Be conversational and natural, maintaining your personality.
        2. Focus on the key weather details: current temperature, condition, and any other relevant information.
        3. If this is an extended forecast, mention the forecast for the next few days.
        4. Format the response in a clear, readable way.
        
        Original user question: "${userQuestion}"
      `,
    };

    // Extract essential weather data to reduce payload size
    const essentialData = {
      location: weatherData.location
        ? {
            name: weatherData.location.name,
            country: weatherData.location.country,
            localtime: weatherData.location.localtime,
          }
        : null,
      current: weatherData.current
        ? {
            temp_c: weatherData.current.temp_c,
            condition: weatherData.current.condition,
            humidity: weatherData.current.humidity,
            wind_kph: weatherData.current.wind_kph,
            wind_dir: weatherData.current.wind_dir,
          }
        : null,
      forecast: weatherData.forecast
        ? {
            forecastday: weatherData.forecast.forecastday?.map(day => ({
              date: day.date,
              day: {
                maxtemp_c: day.day.maxtemp_c,
                mintemp_c: day.day.mintemp_c,
                condition: day.day.condition,
              },
            })),
          }
        : null,
      _isMock: weatherData._isMock,
    };

    const functionResultContent = JSON.stringify(essentialData);

    // Create messages array
    const messages = [
      systemMessage,
      { role: 'user', content: userQuestion },
      { role: 'function', name: 'function_response', content: functionResultContent },
    ];

    // Add a timeout to the OpenAI API call
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI API call timed out after 15 seconds')), 15000);
    });

    const response = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-3.5-turbo', // Using faster model for better responsiveness
        messages: messages,
      }),
      timeoutPromise,
    ]);

    const naturalResponse = response.choices[0].message.content;
    return naturalResponse;
  } catch (error) {
    weatherLogger.error({ error }, 'Error generating natural response');
    throw error;
  }
}

/**
 * Generate a fallback response from weather data
 *
 * @param {Object} weatherData - Weather data
 * @returns {string} Fallback response
 */
function generateFallbackResponse(weatherData) {
  weatherLogger.debug('Generating fallback response');

  if (weatherData && weatherData.location && weatherData.current) {
    let response = `Current weather in ${weatherData.location.name}: ${weatherData.current.condition.text}, ${weatherData.current.temp_c}°C`;

    // Add forecast if available
    if (
      weatherData.forecast &&
      weatherData.forecast.forecastday &&
      weatherData.forecast.forecastday.length > 0
    ) {
      response += '\n\nForecast:';
      weatherData.forecast.forecastday.forEach(day => {
        response += `\n${day.date}: ${day.day.condition.text}, ${day.day.maxtemp_c}°C / ${day.day.mintemp_c}°C`;
      });
    }

    // Add mock data disclaimer if applicable
    if (weatherData._isMock) {
      response +=
        '\n\n(Note: This is estimated weather data as the actual data could not be retrieved)';
    }

    return response;
  }
  return 'Weather data could not be retrieved. Please try again later.';
}

module.exports = {
  getWeatherResponse,
};
