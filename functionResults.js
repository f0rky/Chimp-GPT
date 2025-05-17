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
 * @property {@property {Array<FunctionResult>} dalle} gptimage
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
  gptimage: [],
  plugins: {}, // Will store plugin results by plugin ID
  lastUpdated: new Date().toISOString(),
};

/**
 * Ensures the data directory exists and is writable
 *
 * @returns {boolean} True if the directory exists and is writable, false otherwise
 */
function ensureDataDir() {
  const dataDir = path.join(__dirname, 'data');
  try {
    // Check if directory exists
    if (!fs.existsSync(dataDir)) {
      logger.info(`Creating data directory: ${dataDir}`);
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o755 });
    }

    // Verify the directory exists after creation attempt
    if (!fs.existsSync(dataDir)) {
      logger.error(`Failed to create data directory: ${dataDir}`);
      return false;
    }

    // Check if directory is writable by trying to write a test file
    const testFile = path.join(dataDir, '.write-test');
    fs.writeFileSync(testFile, 'test', { flag: 'w' });
    fs.unlinkSync(testFile); // Clean up test file

    return true;
  } catch (error) {
    logger.error({ error, path: dataDir }, 'Failed to create or access data directory');
    return false;
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
    // Create data directory synchronously to ensure it exists before any async operations
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      try {
        logger.info(`Creating data directory: ${dataDir}`);
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o755 });
      } catch (mkdirError) {
        logger.error({ error: mkdirError }, 'Failed to create data directory');
        return false;
      }
    }

    // Double-check that the directory exists
    if (!fs.existsSync(dataDir)) {
      logger.error(`Data directory does not exist and could not be created: ${dataDir}`);
      return false;
    }

    // Update the lastUpdated timestamp
    results.lastUpdated = new Date().toISOString();

    // Validate that the results object can be properly serialized
    let jsonString;
    try {
      jsonString = JSON.stringify(results, null, 2);
      // Verify the JSON is valid by parsing it back
      JSON.parse(jsonString);
    } catch (parseError) {
      logger.error({ error: parseError }, 'Generated invalid JSON for function results file');
      return false;
    }

    // Create a backup of the current results file before writing
    if (fs.existsSync(RESULTS_FILE)) {
      try {
        await fs.promises.copyFile(RESULTS_FILE, RESULTS_FILE + '.bak');
        logger.debug('Created backup of function results file');
      } catch (backupError) {
        logger.warn({ error: backupError }, 'Failed to create backup of function results file');
        // Continue with the save operation even if backup fails
      }
    }

    // Use a more reliable approach for writing files with synchronous operations
    try {
      // Write to a completely new file first
      const tempFile = RESULTS_FILE + '.new';

      // Use synchronous file writing to ensure the file is completely written
      fs.writeFileSync(tempFile, jsonString, { encoding: 'utf8', flag: 'w' });

      // Verify the file was written correctly by reading it back synchronously
      try {
        const verifyData = fs.readFileSync(tempFile, 'utf8');
        JSON.parse(verifyData); // This will throw if the JSON is invalid

        // If verification passes, create a backup of the current file if it exists
        if (fs.existsSync(RESULTS_FILE)) {
          try {
            fs.copyFileSync(RESULTS_FILE, RESULTS_FILE + '.bak');
            logger.debug('Created backup of function results file');
          } catch (backupError) {
            logger.warn({ error: backupError }, 'Failed to create backup of function results file');
            // Continue with the save operation even if backup fails
          }
        }

        // Move the new file to the real file location
        fs.renameSync(tempFile, RESULTS_FILE);
        return true;
      } catch (verifyError) {
        logger.error(
          { error: verifyError },
          'Verification of written function results file failed'
        );

        // Try to clean up the temporary file
        try {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
        } catch (cleanupError) {
          logger.warn(
            { error: cleanupError },
            'Failed to clean up temporary function results file'
          );
        }

        // Try to restore from backup if verification fails
        if (fs.existsSync(RESULTS_FILE + '.bak')) {
          try {
            fs.copyFileSync(RESULTS_FILE + '.bak', RESULTS_FILE);
            logger.info('Restored function results file from backup after failed verification');
            return true;
          } catch (restoreError) {
            logger.error(
              { error: restoreError },
              'Failed to restore function results file from backup'
            );
          }
        }
        return false;
      }
    } catch (writeError) {
      logger.error({ error: writeError }, 'Failed to write function results file');
      return false;
    }
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
    // Ensure data directory exists and is writable
    const dirReady = ensureDataDir();
    if (!dirReady) {
      logger.error('Cannot load function results: data directory not available or not writable');
      return { ...DEFAULT_RESULTS };
    }

    if (!fs.existsSync(RESULTS_FILE)) {
      // If the file doesn't exist, return the default results
      return { ...DEFAULT_RESULTS };
    }

    // Try to read and parse the file
    try {
      // Use synchronous file reading for more reliability
      let data = fs.readFileSync(RESULTS_FILE, 'utf8');

      // Trim any whitespace or unexpected characters that might be at the end of the file
      data = data.trim();

      // Check if the file starts and ends with valid JSON brackets
      if (!data.startsWith('{') || !data.endsWith('}')) {
        logger.warn('Function results file does not contain valid JSON object format');

        // Try to find valid JSON boundaries
        const startIndex = data.indexOf('{');
        const lastBraceIndex = data.lastIndexOf('}');

        if (startIndex >= 0 && lastBraceIndex > startIndex) {
          // Extract only the content between the first { and last }
          data = data.substring(startIndex, lastBraceIndex + 1);
          logger.info('Extracted potential valid JSON from corrupted file');
        } else {
          throw new Error('Could not find valid JSON structure in function results file');
        }
      }

      // Check for truncated JSON (which would cause 'Unexpected end of JSON input')
      const openBraces = (data.match(/\{/g) || []).length;
      const closeBraces = (data.match(/\}/g) || []).length;
      if (openBraces !== closeBraces) {
        logger.warn(
          `Function results file has mismatched braces: ${openBraces} open vs ${closeBraces} close`
        );
        throw new Error('Function results file has mismatched braces - likely truncated');
      }

      // Try to parse the JSON data
      let results;
      try {
        results = JSON.parse(data);
      } catch (parseError) {
        logger.error({ error: parseError }, 'JSON parse error in function results file');

        // Handle 'Unexpected end of JSON input' specifically
        if (parseError.message.includes('Unexpected end of JSON input')) {
          logger.warn('Detected truncated JSON file - attempting to repair');

          // Create a new function results file with default values
          const defaultResults = { ...DEFAULT_RESULTS };
          defaultResults.lastUpdated = new Date().toISOString();

          try {
            const jsonString = JSON.stringify(defaultResults, null, 2);
            fs.writeFileSync(RESULTS_FILE, jsonString, { encoding: 'utf8', flag: 'w' });
            logger.info(
              'Created new function results file with default values after truncation error'
            );
            return defaultResults;
          } catch (writeError) {
            logger.error(
              { error: writeError },
              'Failed to create new function results file after truncation error'
            );
            return defaultResults;
          }
        }

        // Try to clean the data by removing any non-JSON content
        try {
          // Find the last closing brace (which should be the end of the JSON)
          const lastBraceIndex = data.lastIndexOf('}');
          if (lastBraceIndex > 0) {
            // Extract only the content up to and including the last brace
            const cleanedData = data.substring(0, lastBraceIndex + 1);
            logger.info('Attempting to parse cleaned JSON data');
            results = JSON.parse(cleanedData);
          } else {
            throw new Error('Could not find valid JSON structure');
          }
        } catch (cleanError) {
          logger.info('Attempting to recover function results from backup file');
          if (fs.existsSync(RESULTS_FILE + '.bak')) {
            try {
              const backupData = fs.readFileSync(RESULTS_FILE + '.bak', 'utf8');
              results = JSON.parse(backupData.trim());
              logger.info('Successfully recovered function results from backup');
            } catch (backupError) {
              logger.error(
                { error: backupError },
                'Failed to recover function results from backup'
              );

              // Create a new function results file with default values as last resort
              const defaultResults = { ...DEFAULT_RESULTS };
              defaultResults.lastUpdated = new Date().toISOString();

              try {
                const jsonString = JSON.stringify(defaultResults, null, 2);
                fs.writeFileSync(RESULTS_FILE, jsonString, { encoding: 'utf8', flag: 'w' });
                logger.info('Created new function results file with default values as last resort');
                return defaultResults;
              } catch (writeError) {
                logger.error(
                  { error: writeError },
                  'Failed to create new function results file as last resort'
                );
                return defaultResults;
              }
            }
          } else {
            logger.warn('No backup function results file found, using default results');

            // Create a new function results file with default values
            const defaultResults = { ...DEFAULT_RESULTS };
            defaultResults.lastUpdated = new Date().toISOString();

            try {
              const jsonString = JSON.stringify(defaultResults, null, 2);
              fs.writeFileSync(RESULTS_FILE, jsonString, { encoding: 'utf8', flag: 'w' });
              logger.info(
                'Created new function results file with default values when no backup exists'
              );
              return defaultResults;
            } catch (writeError) {
              logger.error(
                { error: writeError },
                'Failed to create new function results file when no backup exists'
              );
              return defaultResults;
            }
          }
        }
      }

      // Validate the results structure
      if (!results || typeof results !== 'object') {
        throw new Error('Invalid results structure: not an object');
      }

      // Ensure all required fields exist
      const requiredFields = ['weather', 'time', 'wolfram', 'quake', 'gptimage', 'plugins'];
      const missingFields = requiredFields.filter(field => !(field in results));

      if (missingFields.length > 0) {
        logger.warn(
          { missingFields },
          'Results file missing required fields, using defaults for those fields'
        );

        // Add missing fields from default results
        missingFields.forEach(field => {
          results[field] = DEFAULT_RESULTS[field];
        });
      }

      return results;
    } catch (parseError) {
      logger.error({ error: parseError }, 'Failed to parse function results file');

      // Try to recover from backup if it exists
      const backupFile = RESULTS_FILE + '.bak';
      if (fs.existsSync(backupFile)) {
        try {
          logger.info('Attempting to recover from backup file');
          const backupData = await fs.promises.readFile(backupFile, 'utf8');
          const backupResults = JSON.parse(backupData);

          // If we got here, the backup is valid
          logger.info('Successfully recovered from backup file');
          return backupResults;
        } catch (backupError) {
          logger.error({ error: backupError }, 'Failed to recover from backup file');
        }
      }

      // If all else fails, return default results
      return { ...DEFAULT_RESULTS };
    }
  } catch (error) {
    logger.error({ error }, 'Failed to load function results');
    return { ...DEFAULT_RESULTS };
  }
}

/**
 * Store a function result.
 *
 * @param {string} functionType - The type of function (weather, time, wolfram, quake, gptimage, plugin.{pluginId})
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
        result,
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
        result,
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
    return false;
  }
}

/**
 * Attempts to repair a corrupted function results file.
 *
 * @returns {Promise<boolean>} True if repair was successful or not needed, false if repair failed
 */
async function repairResultsFile() {
  logger.info('Starting function results file repair process');

  try {
    // Ensure the data directory exists
    const dirReady = ensureDataDir();
    if (!dirReady) {
      logger.error('Cannot repair function results: data directory not available or not writable');
      return false;
    }

    // If the file doesn't exist, create a new one with default values
    if (!fs.existsSync(RESULTS_FILE)) {
      logger.info('Function results file does not exist, creating new file with defaults');
      return await saveResults({ ...DEFAULT_RESULTS });
    }

    // Try to read and parse the file
    try {
      const data = await fs.promises.readFile(RESULTS_FILE, 'utf8');
      const results = JSON.parse(data);

      // File parsed successfully, check for integrity
      logger.info('Function results file parsed successfully, checking for integrity');

      // Validate the results structure
      if (!results || typeof results !== 'object') {
        throw new Error('Invalid results structure: not an object');
      }

      // Ensure all required fields exist
      const requiredFields = [
        'weather',
        'time',
        'wolfram',
        'quake',
        'gptimage',
        'plugins',
        'lastUpdated',
      ];
      const missingFields = requiredFields.filter(field => !(field in results));

      if (missingFields.length > 0) {
        logger.warn(
          { missingFields },
          'Results file missing required fields, adding them from defaults'
        );

        // Add missing fields from default results
        missingFields.forEach(field => {
          results[field] = DEFAULT_RESULTS[field];
        });

        // Save the repaired file
        return await saveResults(results);
      }

      // If we got here, the file is healthy
      logger.info('Function results file is healthy, no repair needed');
      return true;
    } catch (parseError) {
      logger.error(
        { error: parseError },
        'Failed to parse function results file, attempting repair'
      );

      // Try to recover from backup if it exists
      const backupFile = RESULTS_FILE + '.bak';
      if (fs.existsSync(backupFile)) {
        try {
          logger.info('Attempting to recover from backup file');
          const backupData = await fs.promises.readFile(backupFile, 'utf8');
          const backupResults = JSON.parse(backupData);

          // If we got here, the backup is valid
          logger.info('Successfully recovered from backup file');
          return await saveResults(backupResults);
        } catch (backupError) {
          logger.error({ error: backupError }, 'Failed to recover from backup file');
        }
      }

      // Create a backup of the corrupted file for analysis
      try {
        const corruptedBackup = RESULTS_FILE + '.corrupted';
        await fs.promises.copyFile(RESULTS_FILE, corruptedBackup);
        logger.info(`Backed up corrupted file to ${corruptedBackup}`);
      } catch (backupError) {
        logger.warn({ error: backupError }, 'Failed to backup corrupted file');
      }

      // If all else fails, create a new file with default values
      logger.info('Creating new function results file with default values');
      return await saveResults({ ...DEFAULT_RESULTS });
    }
  } catch (error) {
    logger.error({ error }, 'Failed to repair function results file');
    return false;
  }
}

module.exports = {
  storeResult,
  getRecentResults,
  getAllResults,
  clearResults,
  repairResultsFile,
  DEFAULT_RESULTS,
};
