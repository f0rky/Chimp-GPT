/**
 * Function Results Optimization Patch
 *
 * This module applies the function results optimizer as a drop-in replacement
 * for the original function results module. It intercepts calls to the original
 * module to ensure all operations are non-blocking and properly optimized.
 *
 * @module OptimizationPatch
 * @author Cascade
 * @version 1.0.0
 */

const originalFunctionResults = require('./functionResults');
const optimizer = require('./functionResultsOptimizer');
const { createLogger } = require('./logger');
const logger = createLogger('optimizationPatch');

// Initialize the optimizer
optimizer.init().catch(err => {
  logger.error({ error: err }, 'Failed to initialize function results optimizer');
});

/**
 * Replace methods in the original function results module with optimized versions
 */
function applyPatches() {
  // Store original methods for reference
  const original = {
    storeResult: originalFunctionResults.storeResult,
    getRecentResults: originalFunctionResults.getRecentResults,
    getAllResults: originalFunctionResults.getAllResults,
    clearResults: originalFunctionResults.clearResults,
    repairResultsFile: originalFunctionResults.repairResultsFile,
  };

  // Override storeResult
  originalFunctionResults.storeResult = async function (functionType, params, result) {
    try {
      // Use the optimizer's version
      await optimizer.storeResult(functionType, params, result);

      // Return true for success
      return true;
    } catch (error) {
      logger.error({ error, functionType }, 'Error in patched storeResult');

      // Try the original method as fallback
      try {
        return await original.storeResult(functionType, params, result);
      } catch (fallbackError) {
        logger.error({ error: fallbackError }, 'Fallback to original storeResult also failed');
        return false;
      }
    }
  };

  // Override getRecentResults
  originalFunctionResults.getRecentResults = async function (functionType, limit = 10) {
    try {
      // Use the optimizer's version
      return await optimizer.getRecentResults(functionType, limit);
    } catch (error) {
      logger.error({ error, functionType }, 'Error in patched getRecentResults');

      // Try the original method as fallback
      try {
        return await original.getRecentResults(functionType, limit);
      } catch (fallbackError) {
        logger.error({ error: fallbackError }, 'Fallback to original getRecentResults also failed');
        return [];
      }
    }
  };

  // Override getAllResults
  originalFunctionResults.getAllResults = async function () {
    try {
      // Use the optimizer's version
      return await optimizer.getAllResults();
    } catch (error) {
      logger.error({ error }, 'Error in patched getAllResults');

      // Try the original method as fallback
      try {
        return await original.getAllResults();
      } catch (fallbackError) {
        logger.error({ error: fallbackError }, 'Fallback to original getAllResults also failed');
        return {
          weather: [],
          time: [],
          wolfram: [],
          quake: [],
          gptimage: [],
          plugins: {},
          lastUpdated: new Date().toISOString(),
        };
      }
    }
  };

  // Override clearResults (passthrough)
  originalFunctionResults.clearResults = async function () {
    // Just reset the optimizer
    try {
      await optimizer.init();
      return true;
    } catch (error) {
      logger.error({ error }, 'Error in patched clearResults');

      // Try the original method as fallback
      try {
        return await original.clearResults();
      } catch (fallbackError) {
        logger.error({ error: fallbackError }, 'Fallback to original clearResults also failed');
        return false;
      }
    }
  };

  // Override repairResultsFile (passthrough)
  originalFunctionResults.repairResultsFile = async function () {
    // Just reset the optimizer
    try {
      await optimizer.init();
      return true;
    } catch (error) {
      logger.error({ error }, 'Error in patched repairResultsFile');

      // Try the original method as fallback
      try {
        return await original.repairResultsFile();
      } catch (fallbackError) {
        logger.error(
          { error: fallbackError },
          'Fallback to original repairResultsFile also failed'
        );
        return false;
      }
    }
  };

  logger.info('Successfully applied function results optimization patches');
  return true;
}

/**
 * Clean up resources when the application is shutting down
 */
async function shutdown() {
  try {
    await optimizer.shutdown();
    logger.info('Optimization patch shutdown complete');
    return true;
  } catch (error) {
    logger.error({ error }, 'Error during optimization patch shutdown');
    return false;
  }
}

// Apply patches immediately
const success = applyPatches();

// Export the success status and methods
module.exports = {
  success,
  shutdown,
};
