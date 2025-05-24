/**
 * Image Usage Tracker
 *
 * Tracks and stores information about image generation requests
 * to help monitor costs and usage patterns over time.
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');

// Create a dedicated logger for the image usage tracker
const logger = createLogger('imageUsage');

// Path to the usage history file
const USAGE_HISTORY_FILE = path.join(__dirname, 'data', 'image_usage_history.json');

// Ensure the data directory exists
function ensureDataDirectory() {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.info(`Created data directory at ${dataDir}`);
    } catch (error) {
      logger.error({ error }, 'Failed to create data directory');
    }
  }
}

// Load the usage history from file
function loadUsageHistory() {
  ensureDataDirectory();

  try {
    if (fs.existsSync(USAGE_HISTORY_FILE)) {
      const data = fs.readFileSync(USAGE_HISTORY_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error({ error }, 'Error loading usage history');
  }

  // Return empty history if file doesn't exist or there's an error
  return {
    entries: [],
    totalCost: 0,
    totalRequests: 0,
    lastUpdated: new Date().toISOString(),
  };
}

// Save the usage history to file
function saveUsageHistory(history) {
  ensureDataDirectory();

  try {
    // Update the lastUpdated timestamp
    history.lastUpdated = new Date().toISOString();

    // Write to file
    fs.writeFileSync(USAGE_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    logger.debug('Saved image usage history');
  } catch (error) {
    logger.error({ error }, 'Error saving usage history');
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
function trackImageGeneration(usageData) {
  // Load the current history
  const history = loadUsageHistory();

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
  saveUsageHistory(history);

  // Log the tracking
  logger.info(
    {
      cost: usageData.cost,
      totalCost: history.totalCost,
      totalRequests: history.totalRequests,
    },
    'Tracked new image generation'
  );

  return history;
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
function getUsageStats(options = {}) {
  const history = loadUsageHistory();

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
function getUsageReport(options = {}) {
  const stats = getUsageStats(options);

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
