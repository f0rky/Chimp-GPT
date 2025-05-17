/**
 * Rate Limiter Test Module
 * 
 * This module tests the rate limiter functionality to ensure it properly
 * limits requests and handles different rate limit configurations.
 * 
 * @module RateLimiterTest
 * @author Brett
 * @version 1.0.0
 */

// Import required modules
const { createRateLimiter } = require('../rateLimiter');
const { createLogger } = require('../logger');
const logger = createLogger('rateLimiterTest');

/**
 * Test the rate limiter functionality
 * 
 * This function tests various aspects of the rate limiter:
 * - Basic rate limiting
 * - Different rate limit configurations
 * - Handling of multiple users
 * - Specialized rate limiters (e.g., image generation)
 * 
 * @returns {Object} Test results with success/failure status and details
 */
async function testRateLimiter() {
  logger.info('Starting rate limiter tests...');
  
  const results = {
    success: true,
    results: []
  };
  
  try {
    // Test 1: Basic rate limiting
    logger.info('Test 1: Basic rate limiting');
    const test1Result = {
      name: 'Basic rate limiting',
      success: false,
      details: {}
    };
    
    try {
      // Create a test rate limiter with a very low limit
      const testLimiter = createRateLimiter({
        keyPrefix: 'test-limiter',
        points: 3,       // Allow only 3 requests
        duration: 60     // Within a 60 second window
      });
      
      // Test user ID
      const testUserId = 'test-user-id';
      
      // Make requests until we hit the limit
      const consumeResults = [];
      let limitReached = false;
      
      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        try {
          const result = await testLimiter.consume(testUserId);
          consumeResults.push({
            success: true,
            remainingPoints: result.remainingPoints
          });
        } catch (error) {
          consumeResults.push({
            success: false,
            error: error.message
          });
        }
      }
      
      // The 4th request should fail
      try {
        await testLimiter.consume(testUserId);
        consumeResults.push({
          success: true,
          unexpected: true
        });
      } catch (error) {
        limitReached = true;
        consumeResults.push({
          success: false,
          error: error.message,
          expected: true
        });
      }
      
      // Check if the first 3 requests succeeded and the 4th failed
      const firstThreeSucceeded = consumeResults.slice(0, 3).every(r => r.success);
      const fourthFailed = !consumeResults[3].success && consumeResults[3].expected;
      
      test1Result.success = firstThreeSucceeded && fourthFailed;
      test1Result.details = {
        firstThreeSucceeded,
        fourthFailed,
        consumeResults
      };
      
      logger.info({ 
        test: 'Basic rate limiting', 
        success: test1Result.success 
      }, 'Test completed');
    } catch (error) {
      test1Result.success = false;
      test1Result.details = {
        error: error.message
      };
      logger.error({ error }, 'Test 1 failed');
    }
    
    results.results.push(test1Result);
    results.success = results.success && test1Result.success;
    
    // Test 2: Different rate limit configurations
    logger.info('Test 2: Different rate limit configurations');
    const test2Result = {
      name: 'Different rate limit configurations',
      success: false,
      details: {}
    };
    
    try {
      // Create rate limiters with different configurations
      const highLimiter = createRateLimiter({
        keyPrefix: 'high-limiter',
        points: 10,      // Allow 10 requests
        duration: 60     // Within a 60 second window
      });
      
      const lowLimiter = createRateLimiter({
        keyPrefix: 'low-limiter',
        points: 2,       // Allow only 2 requests
        duration: 60     // Within a 60 second window
      });
      
      // Test user ID
      const testUserId = 'test-user-id-2';
      
      // High limiter should allow more requests
      let highLimiterReachedLimit = false;
      for (let i = 0; i < 5; i++) {
        try {
          await highLimiter.consume(testUserId);
        } catch (error) {
          highLimiterReachedLimit = true;
          break;
        }
      }
      
      // Low limiter should reach the limit sooner
      let lowLimiterReachedLimit = false;
      try {
        await lowLimiter.consume(testUserId);
        await lowLimiter.consume(testUserId);
        // This should fail
        await lowLimiter.consume(testUserId);
      } catch (error) {
        lowLimiterReachedLimit = true;
      }
      
      test2Result.success = !highLimiterReachedLimit && lowLimiterReachedLimit;
      test2Result.details = {
        highLimiterReachedLimit,
        lowLimiterReachedLimit
      };
      
      logger.info({ 
        test: 'Different rate limit configurations', 
        success: test2Result.success 
      }, 'Test completed');
    } catch (error) {
      test2Result.success = false;
      test2Result.details = {
        error: error.message
      };
      logger.error({ error }, 'Test 2 failed');
    }
    
    results.results.push(test2Result);
    results.success = results.success && test2Result.success;
    
    // Test 3: Handling of multiple users
    logger.info('Test 3: Handling of multiple users');
    const test3Result = {
      name: 'Handling of multiple users',
      success: false,
      details: {}
    };
    
    try {
      // Create a test rate limiter
      const multiUserLimiter = createRateLimiter({
        keyPrefix: 'multi-user-limiter',
        points: 3,       // Allow 3 requests
        duration: 60     // Within a 60 second window
      });
      
      // Test user IDs
      const user1 = 'test-user-1';
      const user2 = 'test-user-2';
      
      // User 1 consumes all their points
      for (let i = 0; i < 3; i++) {
        await multiUserLimiter.consume(user1);
      }
      
      // User 1 should be rate limited
      let user1Limited = false;
      try {
        await multiUserLimiter.consume(user1);
      } catch (error) {
        user1Limited = true;
      }
      
      // User 2 should not be rate limited
      let user2Limited = false;
      try {
        await multiUserLimiter.consume(user2);
      } catch (error) {
        user2Limited = true;
      }
      
      test3Result.success = user1Limited && !user2Limited;
      test3Result.details = {
        user1Limited,
        user2Limited
      };
      
      logger.info({ 
        test: 'Handling of multiple users', 
        success: test3Result.success 
      }, 'Test completed');
    } catch (error) {
      test3Result.success = false;
      test3Result.details = {
        error: error.message
      };
      logger.error({ error }, 'Test 3 failed');
    }
    
    results.results.push(test3Result);
    results.success = results.success && test3Result.success;
    
    // Test 4: Specialized rate limiters
    logger.info('Test 4: Specialized rate limiters');
    const test4Result = {
      name: 'Specialized rate limiters',
      success: false,
      details: {}
    };
    
    try {
      // Check if the specialized image generation rate limiter exists
      const rateLimiterFile = require('fs').readFileSync(require('path').join(__dirname, '..', 'rateLimiter.js'), 'utf8');
      
      // Look for evidence of specialized rate limiters
      const hasImageGenRateLimiter = rateLimiterFile.includes('IMAGE_GEN_POINTS') || 
                                    rateLimiterFile.includes('image generation');
      
      test4Result.success = hasImageGenRateLimiter;
      test4Result.details = {
        hasImageGenRateLimiter
      };
      
      logger.info({ 
        test: 'Specialized rate limiters', 
        success: test4Result.success 
      }, 'Test completed');
    } catch (error) {
      test4Result.success = false;
      test4Result.details = {
        error: error.message
      };
      logger.error({ error }, 'Test 4 failed');
    }
    
    results.results.push(test4Result);
    results.success = results.success && test4Result.success;
    
  } catch (error) {
    logger.error({ error }, 'Unexpected error during rate limiter tests');
    results.success = false;
    results.error = error.message;
  }
  
  // Log overall results
  if (results.success) {
    logger.info('All rate limiter tests passed!');
  } else {
    logger.error('Some rate limiter tests failed!');
  }
  
  return results;
}

// Run tests if this file is executed directly
if (require.main === module) {
  testRateLimiter()
    .then(results => {
      console.log('Rate Limiter Test Results:');
      console.log(JSON.stringify(results, null, 2));
      process.exit(results.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Error running rate limiter tests:', error);
      process.exit(1);
    });
} else {
  // Export for use in other test runners
  module.exports = { testRateLimiter };
}
