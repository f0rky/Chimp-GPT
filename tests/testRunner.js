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
const { OpenAI } = require('openai');
const quakeLookup = require('../quakeLookup');
const { createLogger } = require('../logger');
const logger = createLogger('tests');

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

module.exports = {
  runConversationLogTests,
  runOpenAITests,
  runQuakeTests
};
