/**
 * Image Usage Tracker
 *
 * Tracks and stores information about image generation requests
 * to help monitor costs and usage patterns over time.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const { atomicWriteFile, safeReadFile, validateFilePath } = require('../../utils/securityUtils');

// Configuration constants
const IMAGE_USAGE_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB max file size for usage history
  MAX_ENTRIES: 10000, // Maximum number of entries to keep
};

// Create a dedicated logger for the image usage tracker
const logger = createLogger('imageUsage');

// Path to the usage history file
const USAGE_HISTORY_FILE = path.join(__dirname, '..', '..', 'data', 'image_usage_history.json');

// Ensure the data directory exists
async function ensureDataDirectory() {
  const dataDir = path.join(__dirname, '..', '..', 'data');
  try {
    // Validate directory path for security
    const validatedPath = validateFilePath(dataDir);
    
    // Check if directory exists
    try {
      await fs.access(validatedPath);
    } catch (error) {
      // Directory doesn't exist, create it
      logger.info(`Creating data directory at ${validatedPath}`);
      await fs.mkdir(validatedPath, { recursive: true, mode: 0o755 });
    }

    return true;
  } catch (error) {
    logger.error({ error, path: dataDir }, 'Failed to create data directory');
    return false;
  }
}

// Load the usage history from file
async function loadUsageHistory() {
  const dirReady = await ensureDataDirectory();
  if (!dirReady) {
    logger.error('Cannot load usage history: data directory not accessible');
    return getDefaultHistory();
  }

  try {
    // Check if file exists
    await fs.access(USAGE_HISTORY_FILE);
    
    // Read file securely
    const data = await safeReadFile(USAGE_HISTORY_FILE, {
      maxSize: IMAGE_USAGE_CONFIG.MAX_FILE_SIZE
    });
    
    const history = JSON.parse(data);
    
    // Trim entries if we have too many
    if (history.entries && history.entries.length > IMAGE_USAGE_CONFIG.MAX_ENTRIES) {
      logger.info(`Trimming usage history from ${history.entries.length} to ${IMAGE_USAGE_CONFIG.MAX_ENTRIES} entries`);
      history.entries = history.entries
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, IMAGE_USAGE_CONFIG.MAX_ENTRIES);
    }
    
    return history;
  } catch (error) {
    logger.error({ error }, 'Error loading usage history');
    return getDefaultHistory();
  }
}

// Get default history object
function getDefaultHistory() {
  return {
    entries: [],
    totalCost: 0,
    totalRequests: 0,
    lastUpdated: new Date().toISOString(),
  };
}

// Save the usage history to file
async function saveUsageHistory(history) {
  const dirReady = await ensureDataDirectory();
  if (!dirReady) {
    logger.error('Cannot save usage history: data directory not accessible');
    return false;
  }

  try {
    // Update the lastUpdated timestamp
    history.lastUpdated = new Date().toISOString();

    // Validate JSON before writing
    const jsonString = JSON.stringify(history, null, 2);
    
    // Check file size
    if (Buffer.byteLength(jsonString, 'utf8') > IMAGE_USAGE_CONFIG.MAX_FILE_SIZE) {
      logger.error({ size: Buffer.byteLength(jsonString, 'utf8') }, 'Usage history file too large');
      return false;
    }

    // Write to file atomically
    await atomicWriteFile(USAGE_HISTORY_FILE, jsonString);
    logger.debug('Saved image usage history');
    return true;
  } catch (error) {
    logger.error({ error }, 'Error saving usage history');
    return false;
  }
}

/**
 * Track a new image generation request
 *
 * @param {Object} usageData - Data about the image generation request
 * @param {string} usageData.prompt - The prompt used for generation
 * @param {string} usageData.size - Image size (e.g., "1024x1024")
 * @param {string} usageData.quality - Image quality (e.g., "standard", "hd")
 * @param {number} usageData.cost - Estimated cost in USD
 * @param {number} usageData.apiCallDuration - Time taken for the API call in ms
 * @param {string} usageData.userId - Discord user ID who requested the image
 * @param {string} usageData.username - Discord username who requested the image
 * @returns {Object} The updated usage history
 */
async function trackImageGeneration(usageData) {
  try {
    // Load the current history
    const history = await loadUsageHistory();

    // Create a new entry
    const entry = {
      timestamp: new Date().toISOString(),
      prompt: usageData.prompt,
      size: usageData.size,
      quality: usageData.quality,
      cost: usageData.cost,
      apiCallDuration: usageData.apiCallDuration,
      userId: usageData.userId,
      username: usageData.username,
    };

    // Add the entry to history
    history.entries.push(entry);

    // Update totals
    history.totalCost += usageData.cost;
    history.totalRequests += 1;

    // Save the updated history
    const saved = await saveUsageHistory(history);
    
    if (saved) {
      // Log the tracking
      logger.info(
        {
          cost: usageData.cost,
          totalCost: history.totalCost,
          totalRequests: history.totalRequests,
        },
        'Tracked new image generation'
      );
    } else {
      logger.warn('Failed to save usage history after tracking');
    }

    return history;
  } catch (error) {
    logger.error({ error }, 'Error tracking image generation');
    return getDefaultHistory();
  }
}

/**
 * Get usage statistics for a specific time period
 *
 * @param {Object} options - Options for filtering the statistics
 * @param {string} options.userId - Filter by user ID (optional)
 * @param {string} options.startDate - Start date in ISO format (optional)
 * @param {string} options.endDate - End date in ISO format (optional)
 * @returns {Object} Usage statistics for the specified period
 */
async function getUsageStats(options = {}) {
  const history = await loadUsageHistory();

  // Filter entries based on options
  let filteredEntries = history.entries;

  if (options.userId) {
    filteredEntries = filteredEntries.filter(entry => entry.userId === options.userId);
  }

  if (options.startDate) {
    const startDate = new Date(options.startDate);
    filteredEntries = filteredEntries.filter(entry => new Date(entry.timestamp) >= startDate);
  }

  if (options.endDate) {
    const endDate = new Date(options.endDate);
    filteredEntries = filteredEntries.filter(entry => new Date(entry.timestamp) <= endDate);
  }

  // Calculate statistics
  const totalCost = filteredEntries.reduce((sum, entry) => sum + entry.cost, 0);
  const totalRequests = filteredEntries.length;
  const averageCost = totalRequests > 0 ? totalCost / totalRequests : 0;

  // Get the most recent entries (last 10)
  const recentEntries = filteredEntries
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);

  return {
    totalCost,
    totalRequests,
    averageCost,
    recentEntries,
    period: {
      start: options.startDate || history.entries[0]?.timestamp || new Date().toISOString(),
      end: options.endDate || new Date().toISOString(),
    },
  };
}

/**
 * Get a formatted report of image generation usage
 *
 * @param {Object} options - Options for filtering the statistics
 * @returns {string} A formatted report string
 */
async function getUsageReport(options = {}) {
  const stats = await getUsageStats(options);

  let report = '# Image Generation Usage Report\n\n';

  report += `**Period:** ${new Date(stats.period.start).toLocaleDateString()} to ${new Date(stats.period.end).toLocaleDateString()}\n`;
  report += `**Total Requests:** ${stats.totalRequests}\n`;
  report += `**Total Cost:** $${stats.totalCost.toFixed(4)}\n`;
  report += `**Average Cost per Request:** $${stats.averageCost.toFixed(4)}\n\n`;

  if (stats.recentEntries.length > 0) {
    report += '## Recent Requests\n\n';

    stats.recentEntries.forEach((entry, index) => {
      report += `### ${index + 1}. ${new Date(entry.timestamp).toLocaleString()}\n`;
      report += `**Prompt:** "${entry.prompt}"\n`;
      report += `**Size:** ${entry.size} | **Quality:** ${entry.quality}\n`;
      report += `**Cost:** $${entry.cost.toFixed(4)} | **API Time:** ${(entry.apiCallDuration / 1000).toFixed(1)}s\n`;
      report += `**User:** ${entry.username} (${entry.userId})\n\n`;
    });
  }

  return report;
}

module.exports = {
  trackImageGeneration,
  getUsageStats,
  getUsageReport,
};
