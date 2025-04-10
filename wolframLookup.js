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
  const appId = process.env.WOLFRAM_APP_ID;  // Assume the Wolfram App ID is stored in an environment variable

  const options = {
    method: 'GET',
    url: `http://api.wolframalpha.com/v1/result`,
    params: {
      i: query,
      appid: appId
    }
  };

  try {
    wolframLogger.debug({ query }, 'Sending request to Wolfram Alpha');
    const response = await axios.request(options);
    const answer = response.data;
    wolframLogger.info({ query, answer }, 'Received response from Wolfram Alpha');
    return `Wolfram Alpha says: ${answer}`;
  } catch (error) {
    wolframLogger.error({ error, query }, 'Error querying Wolfram Alpha');
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
  getWolframShortAnswer
};
