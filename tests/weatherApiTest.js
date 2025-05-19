/**
 * Weather API Integration Test Module
 *
 * This module tests the weather API integration to ensure it properly
 * handles requests, responses, and error conditions.
 *
 * @module WeatherApiTest
 * @author Brett
 * @version 1.0.0
 */

// Import required modules
const { lookupWeather, lookupExtendedForecast } = require('../weatherLookup');
const simplifiedWeather = require('../simplified-weather');
const { createLogger } = require('../logger');
const logger = createLogger('weatherTest');

/**
 * Test the weather API integration
 *
 * This function tests various aspects of the weather API:
 * - Basic location lookup
 * - Response format validation
 * - Error handling for invalid locations
 * - Extended forecast functionality
 * - Simplified weather response generation
 *
 * @returns {Object} Test results with success/failure status and details
 */
async function testWeatherApi() {
  logger.info('Starting weather API tests...');

  const results = {
    success: true,
    results: [],
  };

  try {
    // Test 1: Basic location lookup
    logger.info('Test 1: Basic location lookup');
    const test1Result = {
      name: 'Basic location lookup',
      success: false,
      details: {},
    };

    try {
      const weatherData = await lookupWeather('London');

      // Validate response format
      const validResponse =
        weatherData && weatherData.location && weatherData.current && weatherData.current.condition;

      test1Result.success = validResponse;
      test1Result.details = {
        location: weatherData?.location?.name || 'N/A',
        condition: weatherData?.current?.condition?.text || 'N/A',
        temperature: weatherData?.current?.temp_c || 'N/A',
      };

      if (!validResponse) {
        logger.warn({ weatherData }, 'Invalid response format in Test 1');
      }
    } catch (error) {
      test1Result.success = false;
      test1Result.error = error.message;
      logger.error({ error }, 'Error in Test 1: Basic location lookup');
    }

    results.results.push(test1Result);

    // Test 2: Error handling for invalid location
    logger.info('Test 2: Error handling for invalid location');
    const test2Result = {
      name: 'Error handling for invalid location',
      success: false,
      details: {},
    };

    try {
      const weatherData = await lookupWeather('ThisIsNotARealLocationXYZ123');

      // This should fail or return an error object
      test2Result.success = weatherData && weatherData.error;
      test2Result.details = {
        errorHandled: weatherData && weatherData.error ? 'Yes' : 'No',
        errorMessage: weatherData && weatherData.error ? weatherData.error.message : 'N/A',
      };

      if (!test2Result.success) {
        logger.warn({ weatherData }, 'Invalid location did not return proper error');
      }
    } catch (error) {
      // If it throws an error, that's also acceptable error handling
      test2Result.success = true;
      test2Result.details = {
        errorHandled: 'Yes (exception)',
        errorMessage: error.message,
      };
      logger.info({ error: error.message }, 'Invalid location threw exception (expected)');
    }

    results.results.push(test2Result);

    // Test 3: Extended forecast functionality
    logger.info('Test 3: Extended forecast functionality');
    const test3Result = {
      name: 'Extended forecast functionality',
      success: false,
      details: {},
    };

    try {
      const forecastData = await lookupExtendedForecast('New York');

      // Validate forecast data
      const validForecast =
        forecastData &&
        forecastData.location &&
        forecastData.forecast &&
        forecastData.forecast.forecastday &&
        forecastData.forecast.forecastday.length > 0;

      test3Result.success = validForecast;
      test3Result.details = {
        location: forecastData?.location?.name || 'N/A',
        forecastDays: forecastData?.forecast?.forecastday?.length || 0,
        firstDayDate: forecastData?.forecast?.forecastday?.[0]?.date || 'N/A',
      };

      if (!validForecast) {
        logger.warn({ forecastData }, 'Invalid forecast format in Test 3');
      }
    } catch (error) {
      test3Result.success = false;
      test3Result.error = error.message;
      logger.error({ error }, 'Error in Test 3: Extended forecast functionality');
    }

    results.results.push(test3Result);

    // Test 4: Simplified weather response generation
    logger.info('Test 4: Simplified weather response generation');
    const test4Result = {
      name: 'Simplified weather response generation',
      success: false,
      details: {},
    };

    try {
      const response = await simplifiedWeather.getWeatherResponse(
        'Tokyo',
        "What's the weather like in Tokyo?"
      );

      // Validate response
      const validResponse = response && typeof response === 'string' && response.length > 0;

      test4Result.success = validResponse;
      test4Result.details = {
        responseLength: response?.length || 0,
        responsePreview: response?.substring(0, 50) + '...' || 'N/A',
      };

      if (!validResponse) {
        logger.warn({ response }, 'Invalid simplified response in Test 4');
      }
    } catch (error) {
      test4Result.success = false;
      test4Result.error = error.message;
      logger.error({ error }, 'Error in Test 4: Simplified weather response');
    }

    results.results.push(test4Result);

    // Calculate overall success
    const failedTests = results.results.filter(test => !test.success);
    results.success = failedTests.length === 0;
    results.summary = {
      total: results.results.length,
      passed: results.results.length - failedTests.length,
      failed: failedTests.length,
    };

    logger.info(
      {
        passed: results.summary.passed,
        failed: results.summary.failed,
        total: results.summary.total,
      },
      'Weather API tests completed'
    );
  } catch (error) {
    results.success = false;
    results.error = error.message;
    logger.error({ error }, 'Unexpected error in weather API tests');
  }

  return results;
}

// Run tests if this file is executed directly
if (require.main === module) {
  testWeatherApi()
    .then(results => {
      console.log(JSON.stringify(results, null, 2));
      process.exit(results.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution error:', error);
      process.exit(1);
    });
}

module.exports = { testWeatherApi };
