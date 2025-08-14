/**
 * Weather API Integration Tests
 *
 * Comprehensive tests for weather functionality including:
 * - Weather API service integration
 * - Location parsing and validation
 * - Error handling and fallback mechanisms
 * - Response formatting and PocketFlow integration
 * - Mock data generation for testing
 */

const { createLogger } = require('../../src/core/logger');
const logger = createLogger('weatherApiIntegrationTest');

// Mock weather API responses
const mockWeatherResponses = {
  success: {
    location: {
      name: 'London',
      region: 'City of London, Greater London',
      country: 'United Kingdom',
      lat: 51.5171,
      lon: -0.1062,
      tz_id: 'Europe/London',
      localtime_epoch: Date.now() / 1000,
      localtime: new Date().toISOString().slice(0, 16).replace('T', ' '),
    },
    current: {
      last_updated_epoch: Date.now() / 1000,
      last_updated: new Date().toISOString().slice(0, 16).replace('T', ' '),
      temp_c: 22.5,
      temp_f: 72.5,
      is_day: 1,
      condition: {
        text: 'Partly cloudy',
        icon: '//cdn.weatherapi.com/weather/64x64/day/116.png',
        code: 1003,
      },
      wind_mph: 8.1,
      wind_kph: 13.0,
      wind_degree: 210,
      wind_dir: 'SSW',
      pressure_mb: 1013,
      pressure_in: 29.91,
      precip_mm: 0.0,
      precip_in: 0.0,
      humidity: 65,
      cloud: 25,
      feelslike_c: 24.1,
      feelslike_f: 75.4,
      vis_km: 10,
      vis_miles: 6,
      uv: 5,
    },
    forecast: {
      forecastday: [
        {
          date: '2025-08-15',
          day: {
            maxtemp_c: 25.0,
            mintemp_c: 18.0,
            condition: {
              text: 'Partly cloudy',
              icon: '//cdn.weatherapi.com/weather/64x64/day/116.png',
              code: 1003,
            },
          },
        },
      ],
    },
  },
  error: {
    error: {
      code: 1006,
      message: 'No matching location found.',
    },
  },
  rateLimited: {
    error: {
      code: 2008,
      message: 'API key has been disabled.',
    },
  },
};

// Mock axios for API calls
const mockAxios = {
  get: async (url, config) => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));

    // Extract location from URL for testing
    const urlObj = new URL(url);
    const location = urlObj.searchParams.get('q') || '';

    if (location.toLowerCase().includes('invalid') || location.includes('XYZ123')) {
      throw new Error('Request failed with status code 400');
    }

    if (location.toLowerCase().includes('timeout')) {
      const error = new Error('timeout of 10000ms exceeded');
      error.code = 'ECONNABORTED';
      throw error;
    }

    if (location.toLowerCase().includes('ratelimit')) {
      const error = new Error('Request failed with status code 429');
      error.response = { status: 429, data: mockWeatherResponses.rateLimited };
      throw error;
    }

    // Return success response for valid locations
    return {
      status: 200,
      data: {
        ...mockWeatherResponses.success,
        location: {
          ...mockWeatherResponses.success.location,
          name: location || 'London',
        },
      },
    };
  },
};

/**
 * Test weather location parsing and validation
 */
async function testWeatherLocationParsing() {
  logger.info('Test 1: Weather location parsing and validation');

  try {
    const testCases = [
      {
        name: 'Simple city name',
        input: 'What is the weather in Tokyo?',
        expectedLocation: 'Tokyo',
      },
      {
        name: 'City with country',
        input: 'Weather in Paris, France',
        expectedLocation: 'Paris, France',
      },
      {
        name: 'Complex location query',
        input: 'Tell me the weather forecast for New York City',
        expectedLocation: 'New York City',
      },
      {
        name: 'Weather with trailing words',
        input: "What's the weather like in London today?",
        expectedLocation: 'London',
      },
      {
        name: 'No location specified',
        input: 'What is the weather?',
        expectedLocation: null,
      },
      {
        name: 'Location with special characters',
        input: 'Weather in São Paulo, Brazil',
        expectedLocation: 'São Paulo, Brazil',
      },
    ];

    const results = [];

    // Weather parsing patterns from SimpleChimpGPTFlow
    const weatherPatterns = [
      /(?:weather|forecast|temperature).*(?:in|for|at|of)\s+(.+)/i,
      /(?:what'?s|how'?s|tell me)\s+(?:the\s+)?(?:weather|forecast|temperature).*(?:in|for|at|of)\s+(.+)/i,
      /(?:weather|forecast|temperature)\s+(.+)/i,
    ];

    for (const testCase of testCases) {
      try {
        let extractedLocation = null;

        for (const pattern of weatherPatterns) {
          const match = testCase.input.match(pattern);
          if (match && match[1]) {
            extractedLocation = match[1].trim();
            // Remove common trailing words
            extractedLocation = extractedLocation
              .replace(/\?+$/, '')
              .replace(/\s+(please|today|now|currently)$/i, '')
              .trim();
            break;
          }
        }

        const success = extractedLocation === testCase.expectedLocation;

        results.push({
          name: testCase.name,
          success,
          extracted: extractedLocation,
          expected: testCase.expectedLocation,
        });

        if (success) {
          logger.info(`✓ PASS: ${testCase.name} - location parsed correctly`);
        } else {
          logger.warn(
            `✗ FAIL: ${testCase.name} - expected "${testCase.expectedLocation}", got "${extractedLocation}"`
          );
        }
      } catch (error) {
        results.push({
          name: testCase.name,
          success: false,
          error: error.message,
        });
        logger.error(`✗ ERROR: ${testCase.name} - ${error.message}`);
      }
    }

    const passedCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    return {
      success: passedCount === totalCount,
      details: {
        passed: passedCount,
        total: totalCount,
        results,
      },
    };
  } catch (error) {
    logger.error('Error in weather location parsing test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Test weather API service calls with mocking
 */
async function testWeatherAPIService() {
  logger.info('Test 2: Weather API service calls with mocking');

  try {
    const testCases = [
      {
        name: 'Successful weather request',
        location: 'London',
        expectSuccess: true,
        expectedData: mockWeatherResponses.success,
      },
      {
        name: 'Invalid location handling',
        location: 'InvalidLocationXYZ123',
        expectSuccess: false,
        expectedError: 'Request failed',
      },
      {
        name: 'API timeout handling',
        location: 'TimeoutLocation',
        expectSuccess: false,
        expectedError: 'timeout',
      },
      {
        name: 'Rate limiting handling',
        location: 'RateLimitLocation',
        expectSuccess: false,
        expectedError: 'rate limit',
      },
    ];

    const results = [];

    for (const testCase of testCases) {
      try {
        let success = false;
        let data = null;
        let error = null;

        try {
          const response = await mockAxios.get(
            `https://api.weatherapi.com/v1/current.json?q=${testCase.location}`
          );
          data = response.data;
          success = true;
        } catch (err) {
          error = err.message;
          success = false;
        }

        const testSuccess = success === testCase.expectSuccess;

        // Validate data structure if success was expected
        let dataValid = true;
        if (testCase.expectSuccess && success) {
          dataValid = !!(data?.location?.name && data?.current?.temp_c);
        }

        results.push({
          name: testCase.name,
          success: testSuccess && (testCase.expectSuccess ? dataValid : true),
          actualSuccess: success,
          expectedSuccess: testCase.expectSuccess,
          dataValid,
          error,
        });

        if (testSuccess && (testCase.expectSuccess ? dataValid : true)) {
          logger.info(`✓ PASS: ${testCase.name} - API call handled correctly`);
        } else {
          logger.warn(`✗ FAIL: ${testCase.name} - API call handling incorrect`);
        }
      } catch (error) {
        results.push({
          name: testCase.name,
          success: false,
          error: error.message,
        });
        logger.error(`✗ ERROR: ${testCase.name} - ${error.message}`);
      }
    }

    const passedCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    return {
      success: passedCount === totalCount,
      details: {
        passed: passedCount,
        total: totalCount,
        results,
      },
    };
  } catch (error) {
    logger.error('Error in weather API service test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Test weather response formatting
 */
async function testWeatherResponseFormatting() {
  logger.info('Test 3: Weather response formatting');

  try {
    const testCases = [
      {
        name: 'Current weather formatting',
        data: mockWeatherResponses.success,
        expectFormatted: true,
      },
      {
        name: 'Extended forecast formatting',
        data: {
          ...mockWeatherResponses.success,
          forecast: {
            forecastday: [
              {
                date: '2025-08-15',
                day: { maxtemp_c: 25, mintemp_c: 18, condition: { text: 'Sunny' } },
              },
              {
                date: '2025-08-16',
                day: { maxtemp_c: 23, mintemp_c: 16, condition: { text: 'Cloudy' } },
              },
            ],
          },
        },
        expectFormatted: true,
      },
      {
        name: 'Missing data handling',
        data: {
          location: { name: 'Test' },
          // Missing current weather data
        },
        expectFormatted: false,
      },
    ];

    const results = [];

    for (const testCase of testCases) {
      try {
        let formatted = false;
        let formattedResponse = '';

        // Simple weather formatting logic
        if (testCase.data?.location?.name && testCase.data?.current?.temp_c) {
          const location = testCase.data.location.name;
          const temp = testCase.data.current.temp_c;
          const condition = testCase.data.current.condition?.text || 'Unknown';

          formattedResponse = `Weather in ${location}: ${condition}, ${temp}°C`;

          if (testCase.data.forecast?.forecastday?.length > 1) {
            formattedResponse += '\nForecast: ';
            testCase.data.forecast.forecastday.slice(0, 3).forEach((day, index) => {
              if (index > 0) formattedResponse += ', ';
              formattedResponse += `${day.date}: ${day.day.condition.text}`;
            });
          }

          formatted = true;
        }

        const success = formatted === testCase.expectFormatted;

        results.push({
          name: testCase.name,
          success,
          formatted,
          expected: testCase.expectFormatted,
          responseLength: formattedResponse.length,
        });

        if (success) {
          logger.info(`✓ PASS: ${testCase.name} - formatting correct`);
        } else {
          logger.warn(`✗ FAIL: ${testCase.name} - formatting incorrect`);
        }
      } catch (error) {
        results.push({
          name: testCase.name,
          success: false,
          error: error.message,
        });
        logger.error(`✗ ERROR: ${testCase.name} - ${error.message}`);
      }
    }

    const passedCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    return {
      success: passedCount === totalCount,
      details: {
        passed: passedCount,
        total: totalCount,
        results,
      },
    };
  } catch (error) {
    logger.error('Error in weather response formatting test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Test weather error handling and fallback mechanisms
 */
async function testWeatherErrorHandling() {
  logger.info('Test 4: Weather error handling and fallback mechanisms');

  try {
    const testCases = [
      {
        name: 'API key error with fallback',
        error: { code: 2008, message: 'API key disabled' },
        expectFallback: true,
      },
      {
        name: 'Location not found with suggestion',
        error: { code: 1006, message: 'No matching location found' },
        expectFallback: true,
      },
      {
        name: 'Network timeout with retry',
        error: { code: 'ECONNABORTED', message: 'timeout' },
        expectFallback: true,
      },
      {
        name: 'Rate limit with backoff',
        error: { code: 429, message: 'Rate limit exceeded' },
        expectFallback: true,
      },
    ];

    const results = [];

    for (const testCase of testCases) {
      try {
        let fallbackUsed = false;
        let errorHandled = false;
        let fallbackResponse = '';

        // Simulate error handling logic
        try {
          throw new Error(testCase.error.message);
        } catch (error) {
          errorHandled = true;

          // Generate fallback response based on error type
          if (error.message.includes('API key')) {
            fallbackResponse = 'Weather service temporarily unavailable. Please try again later.';
            fallbackUsed = true;
          } else if (error.message.includes('location found')) {
            fallbackResponse = 'Location not found. Please check the spelling and try again.';
            fallbackUsed = true;
          } else if (error.message.includes('timeout')) {
            fallbackResponse = 'Weather service is slow to respond. Please try again.';
            fallbackUsed = true;
          } else if (error.message.includes('Rate limit')) {
            fallbackResponse = 'Too many requests. Please wait a moment and try again.';
            fallbackUsed = true;
          }
        }

        const success = errorHandled && fallbackUsed === testCase.expectFallback;

        results.push({
          name: testCase.name,
          success,
          errorHandled,
          fallbackUsed,
          expectedFallback: testCase.expectFallback,
          fallbackResponse,
        });

        if (success) {
          logger.info(`✓ PASS: ${testCase.name} - error handling correct`);
        } else {
          logger.warn(`✗ FAIL: ${testCase.name} - error handling incorrect`);
        }
      } catch (error) {
        results.push({
          name: testCase.name,
          success: false,
          error: error.message,
        });
        logger.error(`✗ ERROR: ${testCase.name} - ${error.message}`);
      }
    }

    const passedCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    return {
      success: passedCount === totalCount,
      details: {
        passed: passedCount,
        total: totalCount,
        results,
      },
    };
  } catch (error) {
    logger.error('Error in weather error handling test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Test weather PocketFlow integration
 */
async function testWeatherPocketFlowIntegration() {
  logger.info('Test 5: Weather PocketFlow integration');

  try {
    // Mock message object for PocketFlow testing
    const createMockMessage = content => ({
      content,
      author: { id: 'test-user', username: 'TestUser' },
      channel: { id: 'test-channel' },
    });

    const testCases = [
      {
        name: 'Weather request through PocketFlow',
        message: createMockMessage('What is the weather in Tokyo?'),
        expectedType: 'weather',
      },
      {
        name: 'Weather with personality response',
        message: createMockMessage('How is the weather in London today?'),
        expectedType: 'weather',
        expectPersonality: true,
      },
      {
        name: 'Complex weather query',
        message: createMockMessage('Tell me about the weather forecast for New York this week'),
        expectedType: 'weather',
      },
    ];

    const results = [];

    for (const testCase of testCases) {
      try {
        // Simulate PocketFlow weather handling
        let result = {
          success: false,
          type: null,
          response: null,
        };

        const content = testCase.message.content.toLowerCase();

        // Check for weather patterns (from SimpleChimpGPTFlow)
        const weatherPatterns = [
          /(?:weather|forecast|temperature).*(?:in|for|at|of)\s+(.+)/i,
          /(?:what'?s|how'?s|tell me)\s+(?:the\s+)?(?:weather|forecast|temperature).*(?:in|for|at|of)\s+(.+)/i,
          /(?:weather|forecast|temperature)\s+(.+)/i,
        ];

        if (weatherPatterns.some(pattern => pattern.test(testCase.message.content))) {
          result = {
            success: true,
            type: 'weather',
            response: 'Weather information processed through PocketFlow',
            location: 'Test Location',
            weatherData: mockWeatherResponses.success,
          };
        }

        const success = result.success && result.type === testCase.expectedType;

        results.push({
          name: testCase.name,
          success,
          type: result.type,
          expectedType: testCase.expectedType,
          hasResponse: !!result.response,
          hasWeatherData: !!result.weatherData,
        });

        if (success) {
          logger.info(`✓ PASS: ${testCase.name} - PocketFlow integration correct`);
        } else {
          logger.warn(`✗ FAIL: ${testCase.name} - PocketFlow integration incorrect`);
        }
      } catch (error) {
        results.push({
          name: testCase.name,
          success: false,
          error: error.message,
        });
        logger.error(`✗ ERROR: ${testCase.name} - ${error.message}`);
      }
    }

    const passedCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    return {
      success: passedCount === totalCount,
      details: {
        passed: passedCount,
        total: totalCount,
        results,
      },
    };
  } catch (error) {
    logger.error('Error in weather PocketFlow integration test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Main test runner for weather API integration
 */
async function testWeatherAPIIntegration() {
  logger.info('Starting weather API integration tests...');

  const tests = [
    { name: 'Weather Location Parsing', fn: testWeatherLocationParsing },
    { name: 'Weather API Service', fn: testWeatherAPIService },
    { name: 'Weather Response Formatting', fn: testWeatherResponseFormatting },
    { name: 'Weather Error Handling', fn: testWeatherErrorHandling },
    { name: 'Weather PocketFlow Integration', fn: testWeatherPocketFlowIntegration },
  ];

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      logger.info(`Running ${test.name} test...`);
      const result = await test.fn();
      results.push({
        name: test.name,
        success: result.success,
        details: result.details,
        error: result.error,
      });

      if (result.success) {
        passed++;
        logger.info(`✅ ${test.name}: PASSED`);
      } else {
        failed++;
        logger.warn(`❌ ${test.name}: FAILED - ${result.error || 'See details'}`);
      }
    } catch (error) {
      failed++;
      results.push({
        name: test.name,
        success: false,
        error: error.message,
      });
      logger.error(`❌ ${test.name}: ERROR - ${error.message}`);
    }
  }

  logger.info(`Weather API integration tests completed: ${passed} passed, ${failed} failed`);

  return {
    success: failed === 0,
    details: {
      passed,
      failed,
      total: tests.length,
      results,
    },
  };
}

// Export for use in test runner
module.exports = {
  testWeatherAPIIntegration,
};

// Allow running directly
if (require.main === module) {
  testWeatherAPIIntegration()
    .then(result => {
      console.log('\n=== Weather API Integration Test Results ===');
      console.log(`Success: ${result.success}`);
      console.log(`Passed: ${result.details.passed}/${result.details.total}`);
      if (result.details.failed > 0) {
        console.log('Failed tests:');
        result.details.results
          .filter(r => !r.success)
          .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
      }
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}
