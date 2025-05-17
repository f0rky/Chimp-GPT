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
const { wolfram: wolframLogger } = require('./logger');
const { sanitizeQuery } = require('./utils/inputSanitizer');
const functionResults = require('./functionResults');
const apiKeyManager = require('./utils/apiKeyManager');

/**
 * Get a short answer from Wolfram Alpha for a given query
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
    if (error.response && error.response.data) {
      return `Error: ${error.response.data}`;
    }
    return `Error: ${error.message}`;
  }
}

/**
 * Wolfram Alpha module exports
 * @exports WolframLookup
 */
module.exports = {
  getWolframShortAnswer,
};
