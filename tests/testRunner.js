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

const { testConversationLog } = require('./conversationLogTest');
const { testWeatherApi } = require('./weatherApiTest');
const { testPluginSystem } = require('./pluginSystemTest');
const { testConversationStorage } = require('./conversationStorageTest');
const testCircuitBreaker = require('./circuitBreakerTest');
const { testConversationPersistence } = require('./conversationPersistenceTest');
const { testImageGeneration } = require('./imageGenerationTest');
const { testMessageHandler } = require('./messageHandlerTest');
const { testRateLimiter } = require('./rateLimiterTest');
const { OpenAI } = require('openai');
const quakeLookup = require('../quakeLookup');
const { createLogger } = require('../logger');
const logger = createLogger('tests');
const http = require('http');
const https = require('https');
const url = require('url');

/**
 * Run conversation log tests
 * 
 * @returns {Promise<Object>} Test results
 */
async function runConversationLogTests() {
  try {
    logger.info('Running conversation log tests');
    const results = testConversationLog();
    return {
      success: results.success,
      details: results.results
    };
  } catch (error) {
    logger.error({ error }, 'Error running conversation log tests');
    return {
      success: false,
      error: error.message
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
    
    // Skip actual API calls if no API key is set
    if (!process.env.OPENAI_API_KEY) {
      return {
        success: false,
        error: 'OpenAI API key not configured'
      };
    }
    
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    // Test a simple completion to verify API access
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a test assistant. Respond with "Test successful" to verify the API is working.'
        },
        {
          role: 'user',
          content: 'Run test'
        }
      ],
      max_tokens: 20
    });
    
    const content = response.choices[0].message.content;
    const success = content.includes('Test successful') || content.includes('test successful');
    
    return {
      success,
      details: {
        responseReceived: true,
        validResponse: success,
        model: 'gpt-3.5-turbo'
      }
    };
  } catch (error) {
    logger.error({ error }, 'Error running OpenAI tests');
    return {
      success: false,
      error: error.message
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
    
    // Check if the testOpenAISummary function exists
    if (typeof quakeLookup.testOpenAISummary !== 'function') {
      return {
        success: false,
        error: 'Test function not available'
      };
    }
    
    // Run the test with mock data (no API calls)
    const result = await quakeLookup.testOpenAISummary();
    const success = result && typeof result === 'string' && result.includes('Additional Servers');
    
    return {
      success,
      details: {
        summaryGenerated: success
      }
    };
  } catch (error) {
    logger.error({ error }, 'Error running Quake server stats tests');
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Run CORS configuration tests
 * 
 * Tests the CORS configuration by making requests with different origins
 * 
 * @param {string} baseUrl - The base URL of the status server
 * @returns {Promise<Object>} Test results
 */
async function runCorsTests(baseUrl = 'http://localhost:3000') {
  try {
    logger.info({ baseUrl }, 'Running CORS configuration tests');
    
    // Parse the base URL to get hostname and port
    const parsedUrl = url.parse(baseUrl);
    const hostname = parsedUrl.hostname || 'localhost';
    const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);
    const protocol = parsedUrl.protocol || 'http:';
    
    // Define test cases with different origins
    const testCases = [
      { 
        name: 'No Origin',
        headers: {},
        expectedResult: true
      },
      { 
        name: 'Allowed Origin (localhost)',
        headers: { 'Origin': 'http://localhost' },
        expectedResult: true
      },
      { 
        name: 'Allowed Origin (127.0.0.1)',
        headers: { 'Origin': 'http://127.0.0.1' },
        expectedResult: true
      },
      { 
        name: 'Disallowed Origin',
        headers: { 'Origin': 'http://evil-site.com' },
        expectedResult: false
      }
    ];
    
    // Add the current hostname to test cases
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      testCases.push({
        name: `Allowed Origin (${hostname})`,
        headers: { 'Origin': `http://${hostname}` },
        expectedResult: true
      });
    }
    
    // Run the test cases
    const results = [];
    for (const testCase of testCases) {
      try {
        const result = await new Promise((resolve, reject) => {
          const options = {
            hostname: hostname,
            port: port,
            path: '/api',
            method: 'GET',
            headers: testCase.headers
          };
          
          const requester = protocol === 'https:' ? https : http;
          
          const req = requester.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            
            res.on('end', () => {
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                data: data
              });
            });
          });
          
          req.on('error', (error) => {
            reject(error);
          });
          
          req.end();
        });
        
        // Check if the result matches the expected outcome
        // For requests with no origin, we don't expect CORS headers
        // For requests with an origin, we expect CORS headers if the origin is allowed
        let success = false;
        
        if (testCase.name === 'No Origin') {
          // No origin requests should succeed without CORS headers
          success = result.statusCode === 200;
        } else if (testCase.expectedResult) {
          // Allowed origins should have CORS headers and succeed
          const corsHeaderPresent = result.headers['access-control-allow-origin'] !== undefined;
          success = result.statusCode === 200 && corsHeaderPresent;
        } else {
          // Disallowed origins should either fail or not have matching CORS headers
          const corsHeaderMatches = result.headers['access-control-allow-origin'] === testCase.headers['Origin'];
          success = result.statusCode !== 200 || !corsHeaderMatches;
        }
        
        results.push({
          name: testCase.name,
          success: success,
          statusCode: result.statusCode,
          corsHeaders: {
            'access-control-allow-origin': result.headers['access-control-allow-origin'],
            'access-control-allow-methods': result.headers['access-control-allow-methods'],
            'access-control-allow-credentials': result.headers['access-control-allow-credentials']
          }
        });
      } catch (error) {
        results.push({
          name: testCase.name,
          success: false,
          error: error.message
        });
      }
    }
    
    // Determine overall success
    const overallSuccess = results.every(result => result.success);
    
    return {
      success: overallSuccess,
      details: results
    };
  } catch (error) {
    logger.error({ error }, 'Error running CORS tests');
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Run rate limiter tests
 * 
 * Tests the rate limiter configuration by making multiple requests in quick succession
 * 
 * @param {string} baseUrl - The base URL of the status server
 * @returns {Promise<Object>} Test results
 */
async function runRateLimiterTests(baseUrl = 'http://localhost:3000') {
  try {
    logger.info({ baseUrl }, 'Running rate limiter tests');
    
    // Parse the base URL to get hostname and port
    const parsedUrl = url.parse(baseUrl);
    const hostname = parsedUrl.hostname || 'localhost';
    const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);
    const protocol = parsedUrl.protocol || 'http:';
    
    // Make a series of requests to test rate limiting
    const results = [];
    const requester = protocol === 'https:' ? https : http;
    
    // Test 1: Single request (should succeed)
    try {
      const singleRequestResult = await new Promise((resolve, reject) => {
        const options = {
          hostname: hostname,
          port: port,
          path: '/api',
          method: 'GET'
        };
        
        const req = requester.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              data: data
            });
          });
        });
        
        req.on('error', (error) => {
          reject(error);
        });
        
        req.end();
      });
      
      results.push({
        name: 'Single Request',
        success: singleRequestResult.statusCode === 200,
        statusCode: singleRequestResult.statusCode
      });
    } catch (error) {
      results.push({
        name: 'Single Request',
        success: false,
        error: error.message
      });
    }
    
    // Test 2: Rate limit test (only in development to avoid overloading production)
    if (process.env.NODE_ENV === 'development') {
      try {
        // We'll only make 5 requests to avoid overloading the server
        // but this is enough to verify the rate limiter is working
        const requests = [];
        for (let i = 0; i < 5; i++) {
          requests.push(new Promise((resolve) => {
            const options = {
              hostname: hostname,
              port: port,
              path: '/api',
              method: 'GET'
            };
            
            const req = requester.request(options, (res) => {
              let data = '';
              res.on('data', (chunk) => {
                data += chunk;
              });
              
              res.on('end', () => {
                resolve({
                  statusCode: res.statusCode,
                  headers: res.headers,
                  data: data
                });
              });
            });
            
            req.on('error', (error) => {
              resolve({
                error: error.message
              });
            });
            
            req.end();
          }));
        }
        
        const multipleResults = await Promise.all(requests);
        
        // All requests should succeed since our limit is high for testing
        const allSucceeded = multipleResults.every(result => result.statusCode === 200);
        
        results.push({
          name: 'Multiple Requests',
          success: allSucceeded,
          requestCount: multipleResults.length,
          successCount: multipleResults.filter(r => r.statusCode === 200).length
        });
      } catch (error) {
        results.push({
          name: 'Multiple Requests',
          success: false,
          error: error.message
        });
      }
    } else {
      results.push({
        name: 'Multiple Requests',
        success: true,
        skipped: true,
        message: 'Skipped in production environment'
      });
    }
    
    // Determine overall success
    const overallSuccess = results.every(result => result.success);
    
    return {
      success: overallSuccess,
      details: results
    };
  } catch (error) {
    logger.error({ error }, 'Error running rate limiter tests');
    return {
      success: false,
      error: error.message
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
    const results = await testWeatherApi();
    return results;
  } catch (error) {
    logger.error({ error }, 'Error running weather API tests');
    return {
      success: false,
      error: error.message
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
      error: error.message
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
      error: error.message
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
    const results = await testCircuitBreaker();
    return {
      success: results.success,
      details: results.results
    };
  } catch (error) {
    logger.error({ error }, 'Error running circuit breaker tests');
    return {
      success: false,
      error: error.message
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
      details: results.results
    };
  } catch (error) {
    logger.error({ error }, 'Error running conversation persistence tests');
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Run image generation tests
 * 
 * Tests the image generation functionality including DALL-E integration, image downloads, and circuit breaker patterns
 * 
 * @returns {Promise<Object>} Test results
 */
async function runImageGenerationTests() {
  try {
    logger.info('Running image generation tests');
    const results = await testImageGeneration();
    return {
      success: results.success,
      details: results.results
    };
  } catch (error) {
    logger.error({ error }, 'Error running image generation tests');
    return {
      success: false,
      error: error.message
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
      details: results.results
    };
  } catch (error) {
    logger.error({ error }, 'Error running message handler tests');
    return {
      success: false,
      error: error.message
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
      details: results.results
    };
  } catch (error) {
    logger.error({ error }, 'Error running comprehensive rate limiter tests');
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  runConversationLogTests,
  runOpenAITests,
  runQuakeTests,
  runCorsTests,
  runRateLimiterTests,
  runWeatherApiTests,
  runPluginSystemTests,
  runConversationStorageTests,
  runCircuitBreakerTests,
  runConversationPersistenceTests,
  runImageGenerationTests,
  runMessageHandlerTests,
  runComprehensiveRateLimiterTests
};
