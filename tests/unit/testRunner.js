/**
 * Test Runner Module
 *
 * This module provides functions to run various tests for the ChimpGPT bot
 * and return the results in a standardized format for display in the status page.
 *
 * @module TestRunner
 * @author Brett
 * @version 1.0.0
 */

// Import non-circular dependencies first
const { OpenAI } = require('openai');
const { CHAT_MODEL } = require('../../src/services/chatModel');
const { createLogger } = require('../../src/core/logger');
const logger = createLogger('tests');
const { runCorsTests, runRateLimiterTests } = require('../../src/utils/statusDiagnostics');

// Import test modules using function-level imports to avoid circular dependencies
// This delays loading until the functions are actually called
let testWeatherApi, testCircuitBreaker, testHumanCircuitBreaker, testInputSanitizer;
let testApiKeyManager, testErrorClasses, testCommandHandler, testSecurityHardening;
let testDashboardSecurity;

// Function to load modules dynamically to avoid circular dependencies
function loadTestModules() {
  if (!testWeatherApi) {
    testWeatherApi = require('./weatherApiTest').testWeatherApi;
    testCircuitBreaker = require('./circuitBreakerTest'); // Exports directly
    testHumanCircuitBreaker = require('./humanCircuitBreakerTest').testHumanCircuitBreaker;
    testInputSanitizer = require('./inputSanitizerTest').testInputSanitizer;
    testApiKeyManager = require('./apiKeyManagerTest').testApiKeyManager;
    testErrorClasses = require('./errorClassesTest').testErrorClasses;
    testCommandHandler = require('./commandHandlerTest').testCommandHandler;
    testSecurityHardening = require('./securityHardeningTest');
    testDashboardSecurity = require('./dashboardSecurityTest');
  }
}

/**
 * Run conversation log tests
 *
 * @returns {Promise<Object>} Test results
 */
async function runConversationLogTests() {
  try {
    logger.info('Running conversation log tests');
    // Load test modules dynamically to avoid circular dependencies
    loadTestModules();
    // Properly await the async testConversationLog function
    const results = await testConversationLog();
    return {
      success: results.success,
      details: results.tests, // Updated to match the new property name in conversationLogTest.js
    };
  } catch (error) {
    logger.error({ error }, 'Error running conversation log tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run OpenAI integration tests
 *
 * Tests the OpenAI API connection and basic functionality
 *
 * @returns {Promise<Object>} Test results
 */
async function runOpenAITests() {
  try {
    logger.info('Running OpenAI integration tests');

    // Load test modules dynamically to avoid circular dependencies
    loadTestModules();

    // Skip actual API calls if no API key is set
    if (!process.env.OPENAI_API_KEY) {
      return {
        success: false,
        error: 'OpenAI API key not configured',
      };
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Test a simple completion to verify API access
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a test assistant. Respond with "Test successful" to verify the API is working.',
        },
        {
          role: 'user',
          content: 'Run test',
        },
      ],
      max_completion_tokens: 20,
    });

    const content = response.choices[0].message.content;
    const success = content.includes('Test successful') || content.includes('test successful');

    return {
      success,
      details: {
        responseReceived: true,
        validResponse: success,
        model: CHAT_MODEL,
      },
    };
  } catch (error) {
    logger.error({ error }, 'Error running OpenAI tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run Quake server stats tests
 *
 * Tests the Quake server stats functionality using the test function
 *
 * @returns {Promise<Object>} Test results
 */
async function runQuakeTests() {
  try {
    logger.info('Running Quake server stats tests');

    // Load test modules dynamically to avoid circular dependencies
    loadTestModules();

    // Check if the testOpenAISummary function exists
    if (typeof quakeLookup.testOpenAISummary !== 'function') {
      return {
        success: false,
        error: 'Test function not available',
      };
    }

    // Run the test with mock data (no API calls)
    const result = await quakeLookup.testOpenAISummary();
    const success = result && typeof result === 'string' && result.includes('Additional Servers');

    return {
      success,
      details: {
        summaryGenerated: success,
      },
    };
  } catch (error) {
    logger.error({ error }, 'Error running Quake server stats tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run weather API tests
 *
 * Tests the weather API integration and response handling
 *
 * @returns {Promise<Object>} Test results
 */
async function runWeatherApiTests() {
  try {
    logger.info('Running weather API tests');
    loadTestModules();
    const results = await testWeatherApi();
    return results;
  } catch (error) {
    logger.error({ error }, 'Error running weather API tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run plugin system tests
 *
 * Tests the plugin system functionality including loading, validation, and execution
 *
 * @returns {Promise<Object>} Test results
 */
async function runPluginSystemTests() {
  try {
    logger.info('Running plugin system tests');
    const results = await testPluginSystem();
    return results;
  } catch (error) {
    logger.error({ error }, 'Error running plugin system tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run conversation storage tests
 *
 * Tests the persistent conversation storage functionality
 *
 * @returns {Promise<Object>} Test results
 */
async function runConversationStorageTests() {
  try {
    logger.info('Running conversation storage tests');
    const results = await testConversationStorage();
    return results;
  } catch (error) {
    logger.error({ error }, 'Error running conversation storage tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run circuit breaker tests
 *
 * Tests the circuit breaker pattern implementation including retries, failures, and circuit opening/closing
 *
 * @returns {Promise<Object>} Test results
 */
async function runCircuitBreakerTests() {
  try {
    logger.info('Running circuit breaker tests');
    loadTestModules();
    const results = await testCircuitBreaker();
    return {
      success: results.success,
      details: results.results,
    };
  } catch (error) {
    logger.error({ error }, 'Error running circuit breaker tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run conversation persistence tests
 *
 * Tests the conversation persistence functionality including saving, loading, pruning, and error recovery
 *
 * @returns {Promise<Object>} Test results
 */
async function runConversationPersistenceTests() {
  try {
    logger.info('Running conversation persistence tests');
    const results = await testConversationPersistence();
    return {
      success: results.success,
      details: results.results,
    };
  } catch (error) {
    logger.error({ error }, 'Error running conversation persistence tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run image generation tests
 *
 * Tests the image generation functionality including GPT Image model integration, image downloads, and circuit breaker patterns
 *
 * @returns {Promise<Object>} Test results
 */
async function runImageGenerationTests() {
  try {
    logger.info('Running image generation tests');
    const results = await testImageGeneration();
    return {
      success: results.success,
      details: results.results,
    };
  } catch (error) {
    logger.error({ error }, 'Error running image generation tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run message handler tests
 *
 * Tests the message handling functionality including command parsing, message filtering, and error handling
 *
 * @returns {Promise<Object>} Test results
 */
async function runMessageHandlerTests() {
  try {
    logger.info('Running message handler tests');
    const results = await testMessageHandler();
    return {
      success: results.success,
      details: results.results,
    };
  } catch (error) {
    logger.error({ error }, 'Error running message handler tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run comprehensive rate limiter tests
 *
 * Tests the rate limiter functionality including different configurations, multiple users, and specialized limiters
 *
 * @returns {Promise<Object>} Test results
 */
async function runComprehensiveRateLimiterTests() {
  try {
    logger.info('Running comprehensive rate limiter tests');
    const results = await testRateLimiter();
    return {
      success: results.success,
      details: results.results,
    };
  } catch (error) {
    logger.error({ error }, 'Error running comprehensive rate limiter tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run human circuit breaker tests
 *
 * Tests the human circuit breaker functionality including approval workflows
 *
 * @returns {Promise<Object>} Test results
 */
async function runHumanCircuitBreakerTests() {
  try {
    logger.info('Running human circuit breaker tests');
    loadTestModules();
    const results = await testHumanCircuitBreaker();
    return {
      success: results.success,
      details: results.results,
    };
  } catch (error) {
    logger.error({ error }, 'Error running human circuit breaker tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run input sanitizer tests
 *
 * Tests the input sanitization functionality for security
 *
 * @returns {Promise<Object>} Test results
 */
async function runInputSanitizerTests() {
  try {
    logger.info('Running input sanitizer tests');
    loadTestModules();
    const results = await testInputSanitizer();
    return {
      success: results.success,
      details: results.results,
    };
  } catch (error) {
    logger.error({ error }, 'Error running input sanitizer tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

async function runSecurityHardeningTests() {
  try {
    logger.info('Running security hardening tests');
    loadTestModules();
    const results = await testSecurityHardening();
    return {
      success: results.success,
      details: results.results,
    };
  } catch (error) {
    logger.error({ error }, 'Error running security hardening tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

async function runDashboardSecurityTests() {
  try {
    logger.info('Running dashboard security tests');
    loadTestModules();
    const results = await testDashboardSecurity();
    return {
      success: results.success,
      details: results.results,
    };
  } catch (error) {
    logger.error({ error }, 'Error running dashboard security tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run API key manager tests
 *
 * Tests the API key management functionality
 *
 * @returns {Promise<Object>} Test results
 */
async function runApiKeyManagerTests() {
  try {
    logger.info('Running API key manager tests');
    loadTestModules();
    const results = await testApiKeyManager();
    return {
      success: results.success,
      details: results.results,
    };
  } catch (error) {
    logger.error({ error }, 'Error running API key manager tests');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run error classes tests
 *
 * Tests the custom error classes functionality
 *
 * @returns {Promise<Object>} Test results
 */
async function runErrorClassesTests() {
  loadTestModules();
  return testErrorClasses();
}

/**
 * Run command handler tests
 *
 * Tests the command handler's prefix functionality
 *
 * @returns {Promise<Object>} Test results
 */
async function runCommandHandlerTests() {
  loadTestModules();
  return testCommandHandler();
}

// Main execution when run directly
if (require.main === module) {
  (async () => {
    console.log('🧪 Running Chimp-GPT Test Suite\n');
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    const results = {};

    // Test suite configuration
    const tests = [
      { name: 'Error Classes', fn: runErrorClassesTests },
      { name: 'Command Handler', fn: runCommandHandlerTests },
      { name: 'Input Sanitizer', fn: runInputSanitizerTests },
      { name: 'Security Hardening', fn: runSecurityHardeningTests },
      { name: 'Dashboard Security', fn: runDashboardSecurityTests },
      { name: 'API Key Manager', fn: runApiKeyManagerTests },
      { name: 'Human Circuit Breaker', fn: runHumanCircuitBreakerTests },
      { name: 'Circuit Breaker', fn: runCircuitBreakerTests },
      { name: 'Weather API', fn: runWeatherApiTests },
    ];

    // Run each test suite
    for (const test of tests) {
      try {
        console.log(`Running ${test.name} tests...`);
        const result = await test.fn();
        results[test.name] = result;
        totalTests++;

        if (result.success) {
          passedTests++;
          console.log(`✅ ${test.name}: PASSED`);
        } else {
          failedTests++;
          console.log(`❌ ${test.name}: FAILED`);
          if (result.error) {
            console.log(`   Error: ${result.error}`);
          }
        }

        if (result.details) {
          console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
        }
        console.log('');
      } catch (error) {
        failedTests++;
        totalTests++;
        console.log(`❌ ${test.name}: ERROR - ${error.message}`);
        results[test.name] = { success: false, error: error.message };
      }
    }

    // Print summary
    console.log('═══════════════════════════════════════');
    console.log('📊 Test Summary');
    console.log('═══════════════════════════════════════');
    console.log(`Total Test Suites: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);
    console.log(
      `Success Rate: ${totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0}%`
    );

    // Exit with appropriate code
    process.exit(failedTests > 0 ? 1 : 0);
  })().catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
}

// Export all test functions at the end to avoid circular dependencies
// Make sure this is the absolute last statement in the file
module.exports = {
  runOpenAITests,
  runCorsTests,
  runRateLimiterTests,
  runWeatherApiTests,
  runCircuitBreakerTests,
  runHumanCircuitBreakerTests,
  runInputSanitizerTests,
  runApiKeyManagerTests,
  runErrorClassesTests,
  runCommandHandlerTests,
  runSecurityHardeningTests,
  runDashboardSecurityTests,
};
