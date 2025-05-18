/**
 * Function Results Optimizer
 *
 * This module optimizes the function results storage by:
 * 1. Implementing a memory cache to reduce disk I/O
 * 2. Adding proper limits to prevent unbounded growth
 * 3. Making file operations asynchronous and non-blocking
 * 4. Implementing periodic cleanup of old results
 *
 * @module FunctionResultsOptimizer
 * @author Cascade
 * @version 1.0.0
 */

const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('./logger');
const logger = createLogger('functionOptimizer');

// Path to the function results file
const RESULTS_FILE = path.join(__dirname, 'data', 'function-results.json');

// Configuration
const MAX_RESULTS_PER_TYPE = 10;
const MAX_RESULTS_AGE_DAYS = 7; // Remove results older than 7 days
const SAVE_INTERVAL_MS = 5 * 60 * 1000; // Save every 5 minutes
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit for results file

// In-memory cache of results
let resultsCache = null;
let isDirty = false;
let saveTimer = null;
let isOptimizing = false;

/**
 * Initialize the optimizer
 * @returns {Promise<void>}
 */
async function init() {
  try {
    // Load existing results into memory
    resultsCache = await loadResultsFromDisk();
    
    // Start periodic saving if not already started
    if (!saveTimer) {
      saveTimer = setInterval(async () => {
        if (isDirty) {
          await saveResultsToDisk();
          isDirty = false;
        }
      }, SAVE_INTERVAL_MS);
      
      // Ensure the timer doesn't keep the process alive
      saveTimer.unref();
    }
    
    // Run initial cleanup
    await cleanupOldResults();
    
    logger.info('Function results optimizer initialized');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize function results optimizer');
  }
}

/**
 * Load results from disk
 * @returns {Promise<Object>} The loaded results
 */
async function loadResultsFromDisk() {
  try {
    const dataDir = path.join(__dirname, 'data');
    
    // Check if data directory exists
    try {
      await fs.access(dataDir);
    } catch (error) {
      // Create directory if it doesn't exist
      await fs.mkdir(dataDir, { recursive: true });
    }
    
    // Check if results file exists
    try {
      await fs.access(RESULTS_FILE);
    } catch (error) {
      // Create default results if file doesn't exist
      const defaultResults = {
        weather: [],
        time: [],
        wolfram: [],
        quake: [],
        gptimage: [],
        plugins: {},
        lastUpdated: new Date().toISOString()
      };
      
      await fs.writeFile(RESULTS_FILE, JSON.stringify(defaultResults, null, 2));
      return defaultResults;
    }
    
    // Load existing results
    const data = await fs.readFile(RESULTS_FILE, 'utf8');
    
    try {
      return JSON.parse(data);
    } catch (parseError) {
      logger.error({ error: parseError }, 'Failed to parse function results, using default');
      return {
        weather: [],
        time: [],
        wolfram: [],
        quake: [],
        gptimage: [],
        plugins: {},
        lastUpdated: new Date().toISOString()
      };
    }
  } catch (error) {
    logger.error({ error }, 'Error loading function results from disk');
    
    // Return default results if loading fails
    return {
      weather: [],
      time: [],
      wolfram: [],
      quake: [],
      gptimage: [],
      plugins: {},
      lastUpdated: new Date().toISOString()
    };
  }
}

/**
 * Save results to disk
 * @returns {Promise<boolean>} Whether the save was successful
 */
async function saveResultsToDisk() {
  // Don't save if we're in the middle of optimizing
  if (isOptimizing) {
    logger.debug('Skipping save while optimization is in progress');
    return true;
  }
  
  try {
    // Update last updated timestamp
    resultsCache.lastUpdated = new Date().toISOString();
    
    // Save to disk with atomic write pattern
    const tempFile = `${RESULTS_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(resultsCache, null, 2));
    await fs.rename(tempFile, RESULTS_FILE);
    
    logger.debug('Saved function results to disk');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to save function results to disk');
    return false;
  }
}

/**
 * Clean up old results
 * @returns {Promise<void>}
 */
async function cleanupOldResults() {
  if (!resultsCache) {
    await init();
  }
  
  isOptimizing = true;
  try {
    const now = Date.now();
    const maxAgeMs = MAX_RESULTS_AGE_DAYS * 24 * 60 * 60 * 1000;
    let modified = false;
    
    // Clean up standard function types
    const standardTypes = ['weather', 'time', 'wolfram', 'quake', 'gptimage'];
    
    standardTypes.forEach(type => {
      if (Array.isArray(resultsCache[type])) {
        const oldLength = resultsCache[type].length;
        
        // Filter out old results
        resultsCache[type] = resultsCache[type].filter(item => {
          const timestamp = new Date(item.timestamp).getTime();
          return (now - timestamp) < maxAgeMs;
        });
        
        // Trim to max size
        if (resultsCache[type].length > MAX_RESULTS_PER_TYPE) {
          resultsCache[type] = resultsCache[type].slice(-MAX_RESULTS_PER_TYPE);
        }
        
        if (resultsCache[type].length !== oldLength) {
          modified = true;
        }
      }
    });
    
    // Clean up plugin results
    if (resultsCache.plugins && typeof resultsCache.plugins === 'object') {
      for (const pluginId in resultsCache.plugins) {
        if (Array.isArray(resultsCache.plugins[pluginId])) {
          const oldLength = resultsCache.plugins[pluginId].length;
          
          // Filter out old results
          resultsCache.plugins[pluginId] = resultsCache.plugins[pluginId].filter(item => {
            const timestamp = new Date(item.timestamp).getTime();
            return (now - timestamp) < maxAgeMs;
          });
          
          // Trim to max size
          if (resultsCache.plugins[pluginId].length > MAX_RESULTS_PER_TYPE) {
            resultsCache.plugins[pluginId] = resultsCache.plugins[pluginId].slice(-MAX_RESULTS_PER_TYPE);
          }
          
          if (resultsCache.plugins[pluginId].length !== oldLength) {
            modified = true;
          }
          
          // Remove empty arrays
          if (resultsCache.plugins[pluginId].length === 0) {
            delete resultsCache.plugins[pluginId];
            modified = true;
          }
        }
      }
    }
    
    // Save if modified
    if (modified) {
      isDirty = true;
      await saveResultsToDisk();
      logger.info('Cleaned up old function results');
    }
  } catch (error) {
    logger.error({ error }, 'Error cleaning up function results');
  } finally {
    isOptimizing = false;
  }
}

/**
 * Check if the results file size is too large
 * @returns {Promise<boolean>} Whether the file is too large
 */
async function isResultsFileTooLarge() {
  try {
    const stats = await fs.stat(RESULTS_FILE);
    return stats.size > MAX_FILE_SIZE_BYTES;
  } catch (error) {
    // If file doesn't exist, it's not too large
    return false;
  }
}

/**
 * Store a function result in the cache
 * @param {string} functionType - The function type
 * @param {Object} params - The function parameters
 * @param {Object} result - The function result
 * @returns {Promise<boolean>} Whether the store was successful
 */
async function storeResult(functionType, params, result) {
  if (!resultsCache) {
    await init();
  }
  
  try {
    // Check file size and run cleanup if needed
    if (await isResultsFileTooLarge()) {
      logger.warn(`Function results file exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB, cleaning up`);
      await cleanupOldResults();
    }
    
    const resultEntry = {
      timestamp: new Date().toISOString(),
      params,
      result
    };
    
    // Handle plugin results
    if (functionType.startsWith('plugin.')) {
      const pluginId = functionType.split('.')[1];
      
      if (!resultsCache.plugins) {
        resultsCache.plugins = {};
      }
      
      if (!resultsCache.plugins[pluginId]) {
        resultsCache.plugins[pluginId] = [];
      }
      
      // Add to beginning for most recent first
      resultsCache.plugins[pluginId].unshift(resultEntry);
      
      // Trim if needed
      if (resultsCache.plugins[pluginId].length > MAX_RESULTS_PER_TYPE) {
        resultsCache.plugins[pluginId] = resultsCache.plugins[pluginId].slice(0, MAX_RESULTS_PER_TYPE);
      }
    } else {
      // Standard function types
      if (!resultsCache[functionType]) {
        resultsCache[functionType] = [];
      }
      
      // Add to beginning for most recent first
      resultsCache[functionType].unshift(resultEntry);
      
      // Trim if needed
      if (resultsCache[functionType].length > MAX_RESULTS_PER_TYPE) {
        resultsCache[functionType] = resultsCache[functionType].slice(0, MAX_RESULTS_PER_TYPE);
      }
    }
    
    // Mark as dirty but don't save immediately
    isDirty = true;
    
    return true;
  } catch (error) {
    logger.error({ error, functionType }, 'Error storing function result');
    return false;
  }
}

/**
 * Get recent results for a function type
 * @param {string} functionType - The function type
 * @param {number} [limit=10] - Maximum number of results to return
 * @returns {Promise<Array>} The recent results
 */
async function getRecentResults(functionType, limit = 10) {
  if (!resultsCache) {
    await init();
  }
  
  try {
    // Handle plugin results
    if (functionType.startsWith('plugin.')) {
      const pluginId = functionType.split('.')[1];
      
      if (!resultsCache.plugins || !resultsCache.plugins[pluginId]) {
        return [];
      }
      
      return resultsCache.plugins[pluginId].slice(0, limit);
    }
    
    // Standard function types
    if (!resultsCache[functionType]) {
      return [];
    }
    
    return resultsCache[functionType].slice(0, limit);
  } catch (error) {
    logger.error({ error, functionType }, 'Error getting recent results');
    return [];
  }
}

/**
 * Get all results
 * @returns {Promise<Object>} All results
 */
async function getAllResults() {
  if (!resultsCache) {
    await init();
  }
  
  // Return a copy to prevent direct modification
  return JSON.parse(JSON.stringify(resultsCache));
}

/**
 * Shutdown the optimizer
 * @returns {Promise<void>}
 */
async function shutdown() {
  // Clear the save timer
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }
  
  // Save one last time if dirty
  if (isDirty && resultsCache) {
    await saveResultsToDisk();
  }
  
  logger.info('Function results optimizer shut down');
}

module.exports = {
  init,
  storeResult,
  getRecentResults,
  getAllResults,
  cleanupOldResults,
  shutdown
};
