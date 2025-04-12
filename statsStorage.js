/**
 * Stats Storage Module
 * 
 * This module provides functions to save and load bot statistics to/from a file.
 * It enables sharing statistics between the main bot process and the status server.
 * 
 * @module StatsStorage
 * @author Brett
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const logger = createLogger('stats');

// Path to the stats file
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');

// Ensure the data directory exists
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
 * Default stats object structure
 * @type {Object}
 */
const DEFAULT_STATS = {
  startTime: new Date().toISOString(),
  messageCount: 0,
  apiCalls: {
    openai: 0,
    weather: 0,
    time: 0,
    wolfram: 0,
    quake: 0
  },
  errors: {
    openai: 0,
    discord: 0,
    weather: 0,
    time: 0,
    wolfram: 0,
    quake: 0,
    other: 0
  },
  rateLimits: {
    hit: 0,
    users: [],
    userCounts: {}
  },
  lastRestart: new Date().toISOString(),
  lastUpdated: new Date().toISOString()
};

/**
 * Save stats to the stats file
 * 
 * @param {Object} stats - The stats object to save
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function saveStats(stats) {
  try {
    ensureDataDir();
    
    // Update the lastUpdated timestamp
    stats.lastUpdated = new Date().toISOString();
    
    // Convert Set to Array for JSON serialization
    if (stats.rateLimits && stats.rateLimits.users instanceof Set) {
      stats.rateLimits.users = Array.from(stats.rateLimits.users);
    }
    
    await fs.promises.writeFile(
      STATS_FILE,
      JSON.stringify(stats, null, 2),
      'utf8'
    );
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to save stats');
    return false;
  }
}

/**
 * Load stats from the stats file
 * 
 * @returns {Promise<Object>} The loaded stats object, or the default stats if the file doesn't exist
 */
async function loadStats() {
  try {
    ensureDataDir();
    
    if (!fs.existsSync(STATS_FILE)) {
      // If the file doesn't exist, return the default stats
      return { ...DEFAULT_STATS };
    }
    
    const data = await fs.promises.readFile(STATS_FILE, 'utf8');
    const stats = JSON.parse(data);
    
    // Convert users array back to a Set
    if (stats.rateLimits && Array.isArray(stats.rateLimits.users)) {
      stats.rateLimits.users = new Set(stats.rateLimits.users);
    }
    
    return stats;
  } catch (error) {
    logger.error({ error }, 'Failed to load stats');
    return { ...DEFAULT_STATS };
  }
}

/**
 * Update a specific stat value
 * 
 * @param {string} key - The stat key to update (e.g., 'messageCount', 'apiCalls.openai')
 * @param {*} value - The new value or increment amount
 * @param {boolean} [increment=false] - Whether to increment the existing value
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function updateStat(key, value, increment = false) {
  try {
    const stats = await loadStats();
    
    // Handle nested keys (e.g., 'apiCalls.openai')
    const keys = key.split('.');
    let current = stats;
    
    // Navigate to the nested property
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    // Update the value
    const lastKey = keys[keys.length - 1];
    if (increment) {
      current[lastKey] = (current[lastKey] || 0) + value;
    } else {
      current[lastKey] = value;
    }
    
    // Save the updated stats
    return await saveStats(stats);
  } catch (error) {
    logger.error({ error }, 'Failed to update stat');
    return false;
  }
}

/**
 * Increment a stat value
 * 
 * @param {string} key - The stat key to increment (e.g., 'messageCount', 'apiCalls.openai')
 * @param {number} [amount=1] - The amount to increment by
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function incrementStat(key, amount = 1) {
  return await updateStat(key, amount, true);
}

/**
 * Add a user ID to the rate-limited users set
 * 
 * @param {string} userId - The user ID to add
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function addRateLimitedUser(userId) {
  try {
    const stats = await loadStats();
    
    // Increment the hit counter
    stats.rateLimits.hit = (stats.rateLimits.hit || 0) + 1;
    
    // Add the user ID to the set
    if (!stats.rateLimits.users) {
      stats.rateLimits.users = new Set();
    }
    stats.rateLimits.users.add(userId);
    
    // Initialize userCounts if it doesn't exist
    if (!stats.rateLimits.userCounts) {
      stats.rateLimits.userCounts = {};
    }
    
    // Increment the count for this user
    stats.rateLimits.userCounts[userId] = (stats.rateLimits.userCounts[userId] || 0) + 1;
    
    // Save the updated stats
    return await saveStats(stats);
  } catch (error) {
    logger.error({ error }, 'Failed to add rate-limited user');
    return false;
  }
}

/**
 * Reset all stats to their default values
 * 
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function resetStats() {
  try {
    // Create a fresh default stats object with current timestamps
    const freshStats = {
      ...DEFAULT_STATS,
      startTime: new Date().toISOString(),
      lastRestart: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
    
    // Save the fresh stats
    return await saveStats(freshStats);
  } catch (error) {
    logger.error({ error }, 'Failed to reset stats');
    return false;
  }
}

module.exports = {
  loadStats,
  saveStats,
  updateStat,
  incrementStat,
  addRateLimitedUser,
  resetStats,
  DEFAULT_STATS
};
