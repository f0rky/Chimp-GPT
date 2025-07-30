/**
 * Wolfram Alpha Integration Module
 *
 * This module provides integration with the Wolfram Alpha API to answer
 * knowledge-based questions. It uses the Short Answer API which provides
 * concise, natural language responses to queries.
 *
 * @module WolframLookup
 * @author Brett
 * @version 1.0.0
 */

const axios = require('axios');
const { wolfram: wolframLogger } = require('../core/logger');
const { sanitizeQuery } = require('../utils/inputSanitizer');
const functionResults = require('../core/functionResults');
const apiKeyManager = require('../utils/apiKeyManager');
const retryWithBreaker = require('../utils/retryWithBreaker');
const breakerManager = require('../middleware/breakerManager');

// Circuit breaker configuration for Wolfram Alpha API calls
const WOLFRAM_BREAKER_CONFIG = {
  maxRetries: 2,
  breakerLimit: 5, // Opens after 5 consecutive failures
  breakerTimeoutMs: 180000, // 3 minutes timeout
  onBreakerOpen: error => {
    wolframLogger.error({ error }, 'Wolfram Alpha API circuit breaker opened');
    breakerManager.notifyOwnerBreakerTriggered(
      'Wolfram Alpha API circuit breaker opened: ' + error.message
    );
  },
};

/**
 * Internal function that performs the actual Wolfram Alpha API call
 * @async
 * @param {string} query - The question or query to send to Wolfram Alpha
 * @returns {Promise<string>} The answer from Wolfram Alpha
 */
async function _performWolframLookup(query) {
  // Sanitize the query input
  const sanitizedQuery = sanitizeQuery(query);

  // Log if the query was modified during sanitization
  if (sanitizedQuery !== query) {
    wolframLogger.warn(
      { original: query, sanitized: sanitizedQuery },
      'Query was sanitized before Wolfram lookup'
    );
  }

  // Get API key from secure manager with fallback to environment variable
  let appId;
  try {
    appId = apiKeyManager.getApiKey('WOLFRAM_APP_ID');
    wolframLogger.debug('Using API key from secure manager');
  } catch (error) {
    wolframLogger.warn(
      { error: error.message },
      'Failed to get API key from manager, falling back to environment variable'
    );
    appId = process.env.WOLFRAM_APP_ID;

    if (!appId) {
      wolframLogger.error('Wolfram API key not available in environment variables');
      throw new Error('Wolfram API key not available');
    }
  }

  const options = {
    method: 'GET',
    url: `http://api.wolframalpha.com/v1/result`,
    params: {
      i: sanitizedQuery,
      appid: appId,
    },
  };

  try {
    wolframLogger.debug({ query: sanitizedQuery }, 'Sending request to Wolfram Alpha');
    const response = await axios.request(options);
    const answer = response.data;
    wolframLogger.info({ query: sanitizedQuery, answer }, 'Received response from Wolfram Alpha');

    // Store the result for status page
    await functionResults
      .storeResult(
        'wolfram',
        { query: sanitizedQuery },
        {
          answer,
          formatted: `Wolfram Alpha says: ${answer}`,
        }
      )
      .catch(err => wolframLogger.error({ err }, 'Failed to store Wolfram lookup result'));
    return `Wolfram Alpha says: ${answer}`;
  } catch (error) {
    wolframLogger.error({ error, query: sanitizedQuery }, 'Error querying Wolfram Alpha');

    // Store the error result for status page
    await functionResults
      .storeResult(
        'wolfram',
        { query: sanitizedQuery },
        {
          error: true,
          errorMessage: error.message,
          formatted: `Error querying Wolfram Alpha: ${error.message}`,
        }
      )
      .catch(err => wolframLogger.error({ err }, 'Failed to store Wolfram lookup error result'));

    // Re-throw the error for the circuit breaker to handle
    throw error;
  }
}

/**
 * Get a short answer from Wolfram Alpha for a given query with circuit breaker protection
 *
 * This function sends a query to the Wolfram Alpha Short Answer API
 * and returns the response. It handles errors gracefully and logs
 * both the query and response for debugging purposes.
 *
 * @async
 * @param {string} query - The question or query to send to Wolfram Alpha
 * @returns {Promise<string>} The answer from Wolfram Alpha or an error message
 */
async function getWolframShortAnswer(query) {
  try {
    return await retryWithBreaker(() => _performWolframLookup(query), WOLFRAM_BREAKER_CONFIG);
  } catch (error) {
    wolframLogger.error(
      { error, query },
      'Wolfram Alpha lookup failed after circuit breaker protection'
    );

    // Provide a fallback response when circuit breaker is open
    if (error.message.includes('Circuit breaker is open')) {
      return `Wolfram Alpha service is temporarily unavailable. Please try again in a few minutes.`;
    }

    // For API errors, provide more specific feedback
    if (error.response) {
      if (error.response.status === 401) {
        return `Sorry, Wolfram Alpha API authentication failed. Please try again later.`;
      } else if (error.response.status === 429) {
        return `Wolfram Alpha rate limit reached. Please try again later.`;
      } else if (error.response.data) {
        return `Wolfram Alpha error: ${error.response.data}`;
      }
    }

    // For other errors, provide a generic fallback
    return `Sorry, I couldn't get an answer from Wolfram Alpha for "${query}" right now. Please try again later.`;
  }
}

/**
 * Wolfram Alpha module exports
 * @exports WolframLookup
 */
module.exports = {
  getWolframShortAnswer,
};
