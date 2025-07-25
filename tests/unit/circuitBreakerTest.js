/**
 * Circuit Breaker Integration Test Module
 *
 * This module tests the circuit breaker pattern implementation to ensure it properly
 * handles retries, failures, and circuit opening/closing.
 *
 * @module CircuitBreakerTest
 * @author Brett
 * @version 1.0.0
 */

// Import required modules
const axios = require('axios');
const retryWithBreaker = require('../../utils/retryWithBreaker');
const breakerManager = require('../../src/middleware/breakerManager');
const { createLogger } = require('../../src/core/logger');
const logger = createLogger('circuitBreakerTest');

// Mock server for testing
const MOCK_SERVER_URL = 'https://httpstat.us';

/**
 * Test the circuit breaker implementation
 *
 * This function tests various aspects of the circuit breaker:
 * - Successful API calls
 * - Retry functionality
 * - Circuit opening on repeated failures
 * - Circuit timeout and reset
 *
 * @returns {Object} Test results with success/failure status and details
 */
async function testCircuitBreaker() {
  logger.info('Starting circuit breaker tests...');

  const results = {
    success: true,
    results: [],
  };

  // Reset breaker state before tests
  breakerManager.resetBreaker();

  try {
    // Test 1: Successful API call
    logger.info('Test 1: Successful API call');
    const test1Result = {
      name: 'Successful API call',
      success: false,
      details: {},
    };

    try {
      const response = await retryWithBreaker(
        async () => {
          return await axios.get(`${MOCK_SERVER_URL}/200`);
        },
        {
          maxRetries: 1,
          breakerLimit: 3,
          breakerTimeoutMs: 5000,
        }
      );

      test1Result.success = response.status === 200;
      test1Result.details = {
        status: response.status,
        expected: 200,
      };

      logger.info({ test: 'Successful API call', success: test1Result.success }, 'Test completed');
    } catch (error) {
      test1Result.success = false;
      test1Result.details = {
        error: error.message,
      };
      logger.error({ error }, 'Test 1 failed');
    }

    results.results.push(test1Result);
    results.success = results.success && test1Result.success;

    // Test 2: Retry functionality
    logger.info('Test 2: Retry functionality');
    const test2Result = {
      name: 'Retry functionality',
      success: false,
      details: {},
    };

    let retryCount = 0;

    try {
      const response = await retryWithBreaker(
        async () => {
          retryCount++;
          if (retryCount === 1) {
            // Fail on first attempt
            throw new Error('Simulated failure for retry test');
          }
          return await axios.get(`${MOCK_SERVER_URL}/200`);
        },
        {
          maxRetries: 2,
          breakerLimit: 3,
          breakerTimeoutMs: 5000,
        }
      );

      test2Result.success = response.status === 200 && retryCount === 2;
      test2Result.details = {
        status: response.status,
        retryCount,
        expected: {
          status: 200,
          retryCount: 2,
        },
      };

      logger.info(
        { test: 'Retry functionality', success: test2Result.success, retryCount },
        'Test completed'
      );
    } catch (error) {
      test2Result.success = false;
      test2Result.details = {
        error: error.message,
        retryCount,
      };
      logger.error({ error, retryCount }, 'Test 2 failed');
    }

    results.results.push(test2Result);
    results.success = results.success && test2Result.success;

    // Test 3: Circuit opening on repeated failures
    logger.info('Test 3: Circuit opening on repeated failures');
    const test3Result = {
      name: 'Circuit opening on repeated failures',
      success: false,
      details: {},
    };

    // Reset breaker state before test
    breakerManager.resetBreaker();
    let failureCount = 0;
    let circuitOpened = false;

    try {
      // First call - will fail and retry once (2 failures total)
      try {
        await retryWithBreaker(
          async () => {
            failureCount++;
            throw new Error('Simulated failure to open circuit');
          },
          {
            maxRetries: 1,
            breakerLimit: 3, // Circuit should open after 3 failures
            breakerTimeoutMs: 5000,
            onBreakerOpen: () => {
              circuitOpened = true;
            },
          }
        );
      } catch (e) {
        // Expected error, continue to next call
        logger.info({ failureCount }, 'First call failed as expected');
      }

      // Second call - should trigger circuit breaker (3rd failure)
      await retryWithBreaker(
        async () => {
          failureCount++;
          throw new Error('Simulated failure to open circuit');
        },
        {
          maxRetries: 0, // No retries to make testing simpler
          breakerLimit: 3, // Circuit should open after 3 failures
          breakerTimeoutMs: 5000,
          onBreakerOpen: () => {
            circuitOpened = true;
          },
        }
      );

      // Should not reach here
      test3Result.success = false;
      test3Result.details = {
        reason: 'Function did not throw error as expected',
      };
    } catch (error) {
      // Check if circuit was opened
      test3Result.success = circuitOpened && error.message.includes('Circuit breaker opened');
      test3Result.details = {
        error: error.message,
        failureCount,
        circuitOpened,
        expected: {
          circuitOpened: true,
          errorContains: 'Circuit breaker opened',
        },
      };

      logger.info(
        {
          test: 'Circuit opening',
          success: test3Result.success,
          failureCount,
          circuitOpened,
          error: error.message,
        },
        'Test completed'
      );
    }

    results.results.push(test3Result);
    results.success = results.success && test3Result.success;

    // Test 4: Circuit timeout and reset
    logger.info('Test 4: Circuit timeout and reset');
    const test4Result = {
      name: 'Circuit timeout and reset',
      success: false,
      details: {},
    };

    try {
      // Set up a breaker with a very short timeout
      const shortTimeoutMs = 100; // 100ms timeout for testing

      // First, trigger the breaker to open
      try {
        await retryWithBreaker(
          async () => {
            throw new Error('Simulated failure to open circuit');
          },
          {
            maxRetries: 1,
            breakerLimit: 1, // Open after 1 failure
            breakerTimeoutMs: shortTimeoutMs,
          }
        );
      } catch (error) {
        // Expected error, circuit should now be open
      }

      // Wait for the timeout to expire
      await new Promise(resolve => setTimeout(resolve, shortTimeoutMs + 50));

      // Now try again, should succeed after timeout
      const response = await retryWithBreaker(
        async () => {
          return await axios.get(`${MOCK_SERVER_URL}/200`);
        },
        {
          maxRetries: 1,
          breakerLimit: 3,
          breakerTimeoutMs: shortTimeoutMs,
        }
      );

      test4Result.success = response.status === 200;
      test4Result.details = {
        status: response.status,
        expected: 200,
      };

      logger.info(
        { test: 'Circuit timeout and reset', success: test4Result.success },
        'Test completed'
      );
    } catch (error) {
      test4Result.success = false;
      test4Result.details = {
        error: error.message,
      };
      logger.error({ error }, 'Test 4 failed');
    }

    results.results.push(test4Result);
    results.success = results.success && test4Result.success;
  } catch (error) {
    logger.error({ error }, 'Unexpected error during circuit breaker tests');
    results.success = false;
    results.error = error.message;
  }

  // Reset breaker state after tests
  breakerManager.resetBreaker();

  // Log overall results
  if (results.success) {
    logger.info('All circuit breaker tests passed!');
  } else {
    logger.error('Some circuit breaker tests failed!');
  }

  return results;
}

// Run tests if this file is executed directly
if (require.main === module) {
  testCircuitBreaker()
    .then(results => {
      console.log('Circuit Breaker Test Results:');
      console.log(JSON.stringify(results, null, 2));
      process.exit(results.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Error running circuit breaker tests:', error);
      process.exit(1);
    });
} else {
  // Export for use in other test runners
  module.exports = testCircuitBreaker;
}
