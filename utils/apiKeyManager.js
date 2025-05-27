/**
 * API Key Manager Module
 *
 * This module provides centralized API key management with rotation capabilities,
 * usage tracking, and security features. It serves as a secure interface for
 * accessing API keys throughout the application.
 *
 * @module ApiKeyManager
 * @author Brett
 * @version 1.0.0
 */

const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('../logger');
const logger = createLogger('apiKeyManager');

// Import validated config instead of using process.env directly
const config = require('../configValidator');

/**
 * @typedef {Object} ApiKeyUsage
 * @property {string} key - The API key (partially masked for security)
 * @property {number} usageCount - Number of times the key has been used
 * @property {number} errorCount - Number of errors encountered with this key
 * @property {Date} lastUsed - Last time the key was used
 * @property {Date} rotationDate - When the key was last rotated
 * @property {boolean} isActive - Whether the key is currently active
 */

/**
 * @typedef {Object} ApiKeyInfo
 * @property {string} name - The name of the API key (e.g., 'OPENAI_API_KEY')
 * @property {string} description - Description of what the API key is used for
 * @property {string} key - The actual API key value
 * @property {string} maskedKey - Masked version of the key for logging
 * @property {number} usageCount - Number of times the key has been used
 * @property {number} errorCount - Number of errors encountered with this key
 * @property {Date} lastUsed - Last time the key was used
 * @property {Date} rotationDate - When the key was last rotated or null if never rotated
 * @property {boolean} isActive - Whether the key is currently active
 */

// In-memory store of API key usage data
const keyUsageData = new Map();

// Path for storing key usage data
const DATA_DIR = path.join(process.cwd(), 'data');
const KEY_USAGE_FILE = path.join(DATA_DIR, 'key_usage.json');

/**
 * Mask an API key for secure logging
 * @param {string} key - The API key to mask
 * @returns {string} - Masked version of the key
 */
function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '(undefined)';
  if (key.length <= 8) return '****';

  // Keep first 4 and last 4 characters, mask the rest
  return `${key.substring(0, 4)}${'*'.repeat(key.length - 8)}${key.substring(key.length - 4)}`;
}

/**
 * Initialize the API key manager
 * @async
 */
async function initialize() {
  logger.info('Initializing API key manager');

  try {
    // Ensure data directory exists
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
    }

    // Try to load existing usage data
    try {
      const data = await fs.readFile(KEY_USAGE_FILE, 'utf8');
      const parsedData = JSON.parse(data);

      // Restore dates from ISO strings
      Object.entries(parsedData).forEach(([keyName, usage]) => {
        usage.lastUsed = usage.lastUsed ? new Date(usage.lastUsed) : new Date();
        usage.rotationDate = usage.rotationDate ? new Date(usage.rotationDate) : null;
        keyUsageData.set(keyName, usage);
      });

      logger.info('Loaded API key usage data from disk');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err }, 'Error loading API key usage data, starting fresh');
      } else {
        logger.info('No existing API key usage data found, starting fresh');
      }
    }

    // Initialize data for all known API keys if not already present
    initializeKeyData('OPENAI_API_KEY', 'OpenAI API for chat completions and image generation');
    initializeKeyData('X_RAPIDAPI_KEY', 'RapidAPI key for weather and other external services');
    initializeKeyData('WOLFRAM_APP_ID', 'Wolfram Alpha API for knowledge queries');

    // Save initial data
    await saveKeyUsageData();

    logger.info('API key manager initialized successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize API key manager');
  }
}

/**
 * Initialize usage data for a specific API key
 * @param {string} keyName - Environment variable name of the API key
 * @param {string} description - Description of what the key is used for
 */
function initializeKeyData(keyName, description) {
  if (!keyUsageData.has(keyName)) {
    const keyValue = config[keyName] || '';

    keyUsageData.set(keyName, {
      name: keyName,
      description,
      key: keyValue,
      maskedKey: maskApiKey(keyValue),
      usageCount: 0,
      errorCount: 0,
      lastUsed: null,
      rotationDate: null,
      isActive: !!keyValue,
    });

    logger.debug({ keyName, masked: maskApiKey(keyValue) }, 'Initialized API key data');
  }
}

/**
 * Save key usage data to disk
 * @async
 */
async function saveKeyUsageData() {
  try {
    // Convert Map to Object for JSON serialization
    const dataObject = {};
    keyUsageData.forEach((value, key) => {
      dataObject[key] = value;
    });

    await fs.writeFile(KEY_USAGE_FILE, JSON.stringify(dataObject, null, 2), 'utf8');
    logger.debug('Saved API key usage data to disk');
  } catch (err) {
    logger.error({ err }, 'Failed to save API key usage data');
  }
}

/**
 * Get an API key with usage tracking
 * @param {string} keyName - Name of the API key to retrieve
 * @returns {string} - The API key
 * @throws {Error} - If the key is not found or inactive
 */
function getApiKey(keyName) {
  const keyData = keyUsageData.get(keyName);

  if (!keyData) {
    logger.warn({ keyName }, 'Requested API key not found in manager');
    throw new Error(`API key ${keyName} not found in manager`);
  }

  if (!keyData.isActive) {
    logger.warn({ keyName }, 'Requested API key is inactive');
    throw new Error(`API key ${keyName} is inactive`);
  }

  // Update usage data
  keyData.usageCount++;
  keyData.lastUsed = new Date();

  // Schedule saving usage data (debounced to avoid excessive disk writes)
  setTimeout(() => saveKeyUsageData(), 5000);

  logger.debug({ keyName, usageCount: keyData.usageCount }, 'API key retrieved');

  return keyData.key;
}

/**
 * Record an error with an API key
 * @param {string} keyName - Name of the API key that had an error
 * @param {Error} error - The error that occurred
 */
function recordApiKeyError(keyName, error) {
  const keyData = keyUsageData.get(keyName);

  if (!keyData) {
    logger.warn({ keyName }, 'Cannot record error for unknown API key');
    return;
  }

  keyData.errorCount++;
  logger.warn(
    {
      keyName,
      errorCount: keyData.errorCount,
      errorMessage: error.message,
    },
    'Recorded API key error'
  );

  // Schedule saving usage data
  setTimeout(() => saveKeyUsageData(), 5000);
}

/**
 * Rotate an API key (for future implementation)
 * @param {string} keyName - Name of the API key to rotate
 * @param {string} newKey - The new API key value
 * @returns {boolean} - Success status
 */
function rotateApiKey(keyName, newKey) {
  const keyData = keyUsageData.get(keyName);

  if (!keyData) {
    logger.warn({ keyName }, 'Cannot rotate unknown API key');
    return false;
  }

  // Store the old key info for logging
  const oldMaskedKey = keyData.maskedKey;

  // Update key data
  keyData.key = newKey;
  keyData.maskedKey = maskApiKey(newKey);
  keyData.rotationDate = new Date();
  keyData.isActive = true;

  logger.info(
    {
      keyName,
      oldKey: oldMaskedKey,
      newKey: keyData.maskedKey,
      rotationDate: keyData.rotationDate,
    },
    'API key rotated'
  );

  // Save updated data
  saveKeyUsageData();

  return true;
}

/**
 * Get usage statistics for all API keys
 * @returns {Array<ApiKeyInfo>} - Array of API key usage information (with masked keys)
 */
function getApiKeyStats() {
  const stats = [];

  keyUsageData.forEach(keyData => {
    stats.push({
      name: keyData.name,
      description: keyData.description,
      maskedKey: keyData.maskedKey,
      usageCount: keyData.usageCount,
      errorCount: keyData.errorCount,
      lastUsed: keyData.lastUsed,
      rotationDate: keyData.rotationDate,
      isActive: keyData.isActive,
    });
  });

  return stats;
}

// Initialize API keys synchronously first, then do the async initialization
function initializeSync() {
  logger.info('Initializing API key manager synchronously');

  // Initialize data for all known API keys immediately
  initializeKeyData('OPENAI_API_KEY', 'OpenAI API for chat completions and image generation');
  initializeKeyData('X_RAPIDAPI_KEY', 'RapidAPI key for weather and other external services');
  initializeKeyData('WOLFRAM_APP_ID', 'Wolfram Alpha API for knowledge queries');

  logger.info('API key manager initialized synchronously');
}

// Run synchronous initialization immediately
initializeSync();

// Then run async initialization
initialize().catch(err => {
  logger.error({ err }, 'Failed to complete async initialization of API key manager');
});

module.exports = {
  getApiKey,
  recordApiKeyError,
  rotateApiKey,
  getApiKeyStats,
  maskApiKey,
};
