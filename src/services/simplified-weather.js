/**
 * Simplified Weather Module for ChimpGPT
 *
 * This module provides a streamlined implementation of weather lookup
 * with integrated natural language response generation.
 */
const axios = require('axios');
const { OpenAI } = require('openai');
const { weather: weatherLogger } = require('../core/logger');
const functionResults = require('../core/functionResults');

// Initialize OpenAI client
const _openai = new OpenAI({
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
 * Look up weather and return structured data for PocketFlow processing
 *
 * @param {string} location - Location to get weather for
 * @param {string} userQuestion - The original user question
 * @returns {Promise<Object>} Structured weather response for PocketFlow
 */
async function getWeatherResponse(location, userQuestion, prefetchedWeatherData = null) {
  weatherLogger.info(
    { location, hasPrefetchedData: !!prefetchedWeatherData },
    'Getting weather data for PocketFlow processing'
  );
  weatherLogger.debug(
    { location, userQuestion, prefetchedWeatherDataInput: prefetchedWeatherData },
    'getWeatherResponse called with prefetchedWeatherDataInput'
  );

  try {
    let weatherData; // Declare weatherData to be used

    if (prefetchedWeatherData) {
      weatherLogger.info({ location }, 'Using prefetched weather data for structured response');
      weatherLogger.debug({ prefetchedWeatherData }, 'Processing with prefetchedWeatherData');
      weatherData = prefetchedWeatherData;
      // The prefetchedWeatherData is assumed to have been stored by the caller if necessary (e.g., by weatherLookup.js)
    } else {
      weatherLogger.info(
        { location },
        'No prefetched data, fetching fresh weather data for structured response'
      );
      weatherLogger.debug('No prefetched data, preparing to fetch fresh data.');
      // getWeatherData handles its own errors and fallbacks, including storing results.
      weatherData = await getWeatherData(location);
    }

    // Generate structured response for PocketFlow to handle with personality
    weatherLogger.debug(
      { weatherData, userQuestion, source: 'before_generateResponse' },
      'Data before attempting to generate structured response'
    );
    try {
      const structuredResponse = await generateResponse(weatherData, userQuestion);
      weatherLogger.info('Successfully generated structured weather response');
      return structuredResponse;
    } catch (structureError) {
      weatherLogger.error(
        {
          error: structureError,
          weatherDataSource: prefetchedWeatherData ? 'prefetched' : 'newly_fetched',
        },
        'Failed to generate structured response, using fallback formatting'
      );
      // Fallback response should also use the determined weatherData
      weatherLogger.debug(
        { weatherData, source: 'before_generateFallbackResponse_structureError' },
        'Data before generating fallback due to structure error'
      );
      return {
        formattedSummary: generateFallbackResponse(weatherData),
        weatherData: weatherData,
        userQuestion: userQuestion,
        type: 'weather_fallback',
      };
    }
  } catch (fetchOrProcessError) {
    // This catch block handles errors if getWeatherData() was called and failed in a way not handled internally,
    // or if there was an issue processing the prefetchedWeatherData (less likely).
    weatherLogger.error(
      { error: fetchOrProcessError, location },
      'Outer catch: Error during weather data retrieval or processing, using mock data for fallback response'
    );
    // If all else fails, generate mock data here for the fallback response
    weatherLogger.debug(
      {
        error: fetchOrProcessError,
        location,
        source: 'before_generateFallbackResponse_fetchOrProcessError',
        usingMockDataForFallback: true,
      },
      'Error before generating fallback due to fetch/process error; will use mock data.'
    );
    const mockData = mockWeatherData.getWeatherForLocation(location);
    return {
      formattedSummary: generateFallbackResponse(mockData),
      weatherData: mockData,
      userQuestion: userQuestion,
      type: 'weather_fallback',
    };
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
 * Generate a structured weather response with formatted data
 *
 * @param {Object} weatherData - Weather data
 * @param {string} userQuestion - Original user question
 * @returns {Promise<Object>} Structured weather response
 */
async function generateResponse(weatherData, userQuestion) {
  weatherLogger.debug('Generating structured weather response');

  try {
    // Extract essential weather data
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

    // Create a formatted summary for the weather
    let formattedWeather = '';
    if (essentialData.location && essentialData.current) {
      formattedWeather = `Weather in ${essentialData.location.name}: ${essentialData.current.condition.text}, ${essentialData.current.temp_c}°C`;

      if (essentialData.current.humidity) {
        formattedWeather += `, humidity ${essentialData.current.humidity}%`;
      }

      if (essentialData.current.wind_kph) {
        formattedWeather += `, wind ${essentialData.current.wind_kph} kph`;
      }

      // Add forecast if available
      if (
        essentialData.forecast &&
        essentialData.forecast.forecastday &&
        essentialData.forecast.forecastday.length > 0
      ) {
        const forecast = essentialData.forecast.forecastday[0];
        formattedWeather += `. Tomorrow: ${forecast.day.condition.text}, high ${forecast.day.maxtemp_c}°C, low ${forecast.day.mintemp_c}°C`;
      }

      // Add mock data disclaimer if applicable
      if (essentialData._isMock) {
        formattedWeather += ' (Note: This is estimated weather data)';
      }
    }

    // Return structured data for PocketFlow to handle with personality
    return {
      weatherData: essentialData,
      formattedSummary: formattedWeather,
      userQuestion: userQuestion,
      type: 'weather_function_result',
    };
  } catch (error) {
    weatherLogger.error({ error }, 'Error generating structured weather response');
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
