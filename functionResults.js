/**
 * Function Results Storage Module
 * 
 * This module provides functionality to store and retrieve recent function call results.
 * It keeps a history of recent API calls and their results for debugging and monitoring.
 * 
 * @module FunctionResults
 * @author Brett
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const logger = createLogger('functions');

// Path to the function results file
const RESULTS_FILE = path.join(__dirname, 'data', 'function-results.json');

// Maximum number of results to store per function type
const MAX_RESULTS_PER_TYPE = 10;

/**
 * Default results object structure
 * @type {Object}
 */
const DEFAULT_RESULTS = {
  weather: [],
  time: [],
  wolfram: [],
  quake: [],
  dalle: [],
  lastUpdated: new Date().toISOString()
};

/**
 * Ensure the data directory exists
 */
function ensureDataDir() {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (error) {
      logger.error({ error }, 'Failed to create data directory');
    }
  }
}

/**
 * Save function results to the results file
 * 
 * @param {Object} results - The results object to save
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function saveResults(results) {
  try {
    ensureDataDir();
    
    // Update the lastUpdated timestamp
    results.lastUpdated = new Date().toISOString();
    
    await fs.promises.writeFile(
      RESULTS_FILE,
      JSON.stringify(results, null, 2),
      'utf8'
    );
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to save function results');
    return false;
  }
}

/**
 * Load function results from the results file
 * 
 * @returns {Promise<Object>} The loaded results object, or the default results if the file doesn't exist
 */
async function loadResults() {
  try {
    ensureDataDir();
    
    if (!fs.existsSync(RESULTS_FILE)) {
      // If the file doesn't exist, return the default results
      return { ...DEFAULT_RESULTS };
    }
    
    const data = await fs.promises.readFile(RESULTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error({ error }, 'Failed to load function results');
    return { ...DEFAULT_RESULTS };
  }
}

/**
 * Store a function result
 * 
 * @param {string} functionType - The type of function (weather, time, wolfram, quake)
 * @param {Object} params - The parameters passed to the function
 * @param {Object} result - The result returned by the function
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function storeResult(functionType, params, result) {
  try {
    // Load existing results
    const results = await loadResults();
    
    // Initialize the array for this function type if it doesn't exist
    if (!results[functionType]) {
      results[functionType] = [];
    }
    
    // Add the new result to the beginning of the array
    results[functionType].unshift({
      timestamp: new Date().toISOString(),
      params,
      result
    });
    
    // Limit the number of results
    if (results[functionType].length > MAX_RESULTS_PER_TYPE) {
      results[functionType] = results[functionType].slice(0, MAX_RESULTS_PER_TYPE);
    }
    
    // Save the updated results
    return await saveResults(results);
  } catch (error) {
    logger.error({ error }, 'Failed to store function result');
    return false;
  }
}

/**
 * Get recent results for a function type
 * 
 * @param {string} functionType - The type of function (weather, time, wolfram, quake)
 * @param {number} [limit=10] - Maximum number of results to return
 * @returns {Promise<Array>} Array of recent results
 */
async function getRecentResults(functionType, limit = 10) {
  try {
    const results = await loadResults();
    return (results[functionType] || []).slice(0, limit);
  } catch (error) {
    logger.error({ error }, 'Failed to get recent results');
    return [];
  }
}

/**
 * Get all function results
 * 
 * @returns {Promise<Object>} All function results
 */
async function getAllResults() {
  return await loadResults();
}

module.exports = {
  storeResult,
  getRecentResults,
  getAllResults,
  DEFAULT_RESULTS
};
