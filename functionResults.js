/**
 * @typedef {Object} FunctionResult
 * @property {string} timestamp - ISO timestamp of when the result was stored
 * @property {Object} params - Parameters passed to the function
 * @property {Object} result - Result returned by the function
 *
 * @typedef {Object} PluginFunctionResult
 * @property {string} timestamp
 * @property {Object} params
 * @property {Object} result
 *
 * @typedef {Object} FunctionResultsData
 * @property {Array<FunctionResult>} weather
 * @property {Array<FunctionResult>} time
 * @property {Array<FunctionResult>} wolfram
 * @property {Array<FunctionResult>} quake
 * @property {Array<FunctionResult>} dalle
 * @property {Object.<string, Array<PluginFunctionResult>>} plugins
 * @property {string} lastUpdated
 */
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
  plugins: {},  // Will store plugin results by plugin ID
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
 * Save function results to the results file.
 *
 * @param {FunctionResultsData} results - The results object to save
 * @returns {Promise<boolean>} True if successful, false otherwise
 * @throws {Error} If an error occurs while writing to the file
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
 * Load function results from the results file.
 *
 * @returns {Promise<FunctionResultsData>} The loaded results object, or the default results if the file doesn't exist
 * @throws {Error} If an error occurs while reading from the file
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
 * Store a function result.
 *
 * @param {string} functionType - The type of function (weather, time, wolfram, quake, dalle, plugin.{pluginId})
 * @param {Object} params - The parameters passed to the function
 * @param {Object} result - The result returned by the function
 * @returns {Promise<boolean>} True if successful, false otherwise
 * @throws {Error} If an error occurs while storing the result
 */
async function storeResult(functionType, params, result) {
  try {
    // Load existing results
    const results = await loadResults();
    
    // Check if this is a plugin result
    if (functionType.startsWith('plugin.')) {
      const pluginId = functionType.substring(7); // Remove 'plugin.' prefix
      
      // Initialize the plugins object if it doesn't exist
      if (!results.plugins) {
        results.plugins = {};
      }
      
      // Initialize the array for this plugin if it doesn't exist
      if (!results.plugins[pluginId]) {
        results.plugins[pluginId] = [];
      }
      
      // Add the new result to the beginning of the array
      results.plugins[pluginId].unshift({
        timestamp: new Date().toISOString(),
        params,
        result
      });
      
      // Limit the number of results
      if (results.plugins[pluginId].length > MAX_RESULTS_PER_TYPE) {
        results.plugins[pluginId] = results.plugins[pluginId].slice(0, MAX_RESULTS_PER_TYPE);
      }
    } else {
      // Handle regular function types
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
    }
    
    // Save the updated results
    return await saveResults(results);
  } catch (error) {
    logger.error({ error }, 'Failed to store function result');
    return false;
  }
}

/**
 * Get recent results for a function type.
 *
 * @param {string} functionType - The type of function (weather, time, wolfram, quake)
 * @param {number} [limit=10] - Maximum number of results to return
 * @returns {Promise<Array<FunctionResult|PluginFunctionResult>>} Array of recent results
 * @throws {Error} If an error occurs while loading results
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
 * Get all stored function results.
 *
 * @returns {Promise<FunctionResultsData>} The complete results object
 * @throws {Error} If an error occurs while loading results
 */
async function getAllResults() {
  return await loadResults();
}

/**
 * Clear all stored function results.
 *
 * @returns {Promise<boolean>} True if successful, false otherwise
 * @throws {Error} If an error occurs while clearing results
 */
async function clearResults() {
  try {
    await saveResults(DEFAULT_RESULTS);
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to clear function results');
    return false;
  }
}

module.exports = {
  storeResult,
  getRecentResults,
  getAllResults,
  clearResults,
  DEFAULT_RESULTS
};
