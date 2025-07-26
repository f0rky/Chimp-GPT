/**
 * @typedef {Object} ApiCalls
 * @property {number} openai
 * @property {number} weather
 * @property {number} time
 * @property {number} wolfram
 * @property {number} quake
 *
 * @typedef {Object} Errors
 * @property {number} openai
 * @property {number} discord
 * @property {number} weather
 * @property {number} time
 * @property {number} wolfram
 * @property {number} quake
 * @property {number} other
 *
 * @typedef {Object} RateLimits
 * @property {number} hit
 * @property {Array<string>|Set<string>} users
 * @property {Object} userCounts
 *
 * @typedef {Object} DiscordStatus
 * @property {string} status - Connection status ('ok', 'offline')
 * @property {number} ping - WebSocket ping in milliseconds
 * @property {number} guilds - Number of guilds connected to
 * @property {number} channels - Number of channels accessible
 *
 * @typedef {Object} StatsData
 * @property {string} startTime
 * @property {number} messageCount
 * @property {ApiCalls} apiCalls
 * @property {Errors} errors
 * @property {RateLimits} rateLimits
 * @property {DiscordStatus} discord
 * @property {string} lastRestart
 * @property {string} lastUpdated
 */
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

// Dangerous keys that could lead to prototype pollution
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validates that a key is safe to use for object property access
 * @param {string} key - The key to validate
 * @returns {boolean} True if the key is safe, false otherwise
 */
function isSafeKey(key) {
  if (typeof key !== 'string') {
    return false;
  }

  // Check if the key is in the dangerous keys list
  if (DANGEROUS_KEYS.has(key.toLowerCase())) {
    return false;
  }

  // Additional checks for variations of dangerous keys
  const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '');
  if (DANGEROUS_KEYS.has(normalizedKey)) {
    return false;
  }

  return true;
}

/**
 * Safely sets a property on an object, preventing prototype pollution
 * @param {Object} obj - The target object
 * @param {string} key - The property key
 * @param {*} value - The value to set
 * @returns {boolean} True if the property was set, false if blocked for security
 */
function _safeSetProperty(obj, key, value) {
  if (!isSafeKey(key)) {
    logger.warn({ key }, 'Blocked potentially dangerous key from being set');
    return false;
  }

  // Use Object.prototype.hasOwnProperty.call for safe property checking
  obj[key] = value;
  return true;
}

// Path to the stats file
const STATS_FILE = path.join(__dirname, '../../data', 'stats.json');

/**
 * Ensures the data directory exists and is writable
 *
 * @returns {boolean} True if the directory exists and is writable, false otherwise
 */
function ensureDataDir() {
  const dataDir = path.join(__dirname, '../../data');
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
    quake: 0,
  },
  errors: {
    openai: 0,
    discord: 0,
    weather: 0,
    time: 0,
    wolfram: 0,
    quake: 0,
    other: 0,
  },
  rateLimits: {
    hit: 0,
    users: [],
    userCounts: Object.create(null), // Use prototype-less object for dynamic keys
  },
  discord: {
    status: 'offline',
    ping: 0,
    guilds: 0,
    channels: 0,
  },
  lastRestart: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
};

/**
 * Save stats to the stats file.
 *
 * @param {StatsData} stats - The stats object to save
 * @returns {Promise<boolean>} True if successful, false otherwise
 * @throws {Error} If an error occurs while saving
 */
async function saveStats(stats) {
  try {
    // Create data directory synchronously to ensure it exists before any async operations
    const dataDir = path.join(__dirname, '../../data');
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

    // Update lastUpdated timestamp
    stats.lastUpdated = new Date().toISOString();

    // Convert Set to Array for JSON serialization
    if (stats.rateLimits && stats.rateLimits.users instanceof Set) {
      stats.rateLimits.users = Array.from(stats.rateLimits.users);
    }

    // Validate that the stats object can be properly serialized
    let jsonString;
    try {
      jsonString = JSON.stringify(stats, null, 2);
      // Verify the JSON is valid by parsing it back
      JSON.parse(jsonString);
    } catch (parseError) {
      logger.error({ error: parseError }, 'Generated invalid JSON for stats file');
      return false;
    }

    // Create a backup of the current stats file before writing
    if (fs.existsSync(STATS_FILE)) {
      try {
        await fs.promises.copyFile(STATS_FILE, STATS_FILE + '.bak');
        logger.debug('Created backup of stats file');
      } catch (backupError) {
        logger.warn({ error: backupError }, 'Failed to create backup of stats file');
        // Continue with the save operation even if backup fails
      }
    }

    // Use a more reliable approach for writing files
    try {
      // Write to a completely new file first
      const tempFile = STATS_FILE + '.new';

      // Use synchronous file writing to ensure the file is completely written
      fs.writeFileSync(tempFile, jsonString, { encoding: 'utf8', flag: 'w' });

      // Verify the file was written correctly by reading it back synchronously
      try {
        const verifyData = fs.readFileSync(tempFile, 'utf8');
        JSON.parse(verifyData); // This will throw if the JSON is invalid

        // If verification passes, create a backup of the current file if it exists
        if (fs.existsSync(STATS_FILE)) {
          try {
            fs.copyFileSync(STATS_FILE, STATS_FILE + '.bak');
            logger.debug('Created backup of stats file');
          } catch (backupError) {
            logger.warn({ error: backupError }, 'Failed to create backup of stats file');
            // Continue with the save operation even if backup fails
          }
        }

        // Move the new file to the real file location
        fs.renameSync(tempFile, STATS_FILE);
        return true;
      } catch (verifyError) {
        logger.error({ error: verifyError }, 'Verification of written stats file failed');

        // Try to clean up the temporary file
        try {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
        } catch (cleanupError) {
          logger.warn({ error: cleanupError }, 'Failed to clean up temporary stats file');
        }

        // Try to restore from backup if verification fails
        if (fs.existsSync(STATS_FILE + '.bak')) {
          try {
            fs.copyFileSync(STATS_FILE + '.bak', STATS_FILE);
            logger.info('Restored stats file from backup after failed verification');
            return true;
          } catch (restoreError) {
            logger.error({ error: restoreError }, 'Failed to restore stats file from backup');
          }
        }
        return false;
      }
    } catch (writeError) {
      logger.error({ error: writeError }, 'Failed to write stats file');
      return false;
    }
  } catch (error) {
    logger.error({ error }, 'Failed to save stats');
    return false;
  }
}

/**
 * Load stats from the stats file.
 *
 * @returns {Promise<StatsData>} The loaded stats object, or the default stats if the file doesn't exist
 * @throws {Error} If an error occurs while loading
 */
async function loadStats() {
  try {
    // Ensure data directory exists and is writable
    const dirReady = ensureDataDir();
    if (!dirReady) {
      logger.error('Cannot load stats: data directory not available or not writable');
      return { ...DEFAULT_STATS };
    }

    if (!fs.existsSync(STATS_FILE)) {
      // If the file doesn't exist, return the default stats
      return { ...DEFAULT_STATS };
    }

    // Try to read the main stats file
    let data;
    try {
      // Use synchronous file reading for more reliability
      data = fs.readFileSync(STATS_FILE, 'utf8');

      // Trim any whitespace or unexpected characters that might be at the end of the file
      data = data.trim();

      // Check if the file starts and ends with valid JSON brackets
      if (!data.startsWith('{') || !data.endsWith('}')) {
        logger.warn('Stats file does not contain valid JSON object format');
        throw new Error('Stats file does not contain valid JSON object format');
      }

      // Check for truncated JSON (which would cause 'Unexpected end of JSON input')
      const openBraces = (data.match(/\{/g) || []).length;
      const closeBraces = (data.match(/\}/g) || []).length;
      if (openBraces !== closeBraces) {
        logger.warn(`Stats file has mismatched braces: ${openBraces} open vs ${closeBraces} close`);
        throw new Error('Stats file has mismatched braces - likely truncated');
      }
    } catch (readError) {
      logger.error({ error: readError }, 'Failed to read stats file');

      // Try to recover from backup immediately
      if (fs.existsSync(STATS_FILE + '.bak')) {
        logger.info('Attempting to recover stats file from backup');
        try {
          data = fs.readFileSync(STATS_FILE + '.bak', 'utf8');
          data = data.trim();

          // Verify the backup file structure
          if (!data.startsWith('{') || !data.endsWith('}')) {
            logger.warn('Backup stats file does not contain valid JSON object format');
            throw new Error('Backup stats file is also invalid');
          }

          // Check for truncated JSON in backup
          const openBraces = (data.match(/\{/g) || []).length;
          const closeBraces = (data.match(/\}/g) || []).length;
          if (openBraces !== closeBraces) {
            logger.warn(
              `Backup stats file has mismatched braces: ${openBraces} open vs ${closeBraces} close`
            );
            throw new Error('Backup stats file has mismatched braces - likely truncated');
          }
        } catch (backupReadError) {
          logger.error({ error: backupReadError }, 'Failed to read backup stats file');
          logger.warn('Creating new stats file with default values');

          // Create a new stats file with default values
          const defaultStats = { ...DEFAULT_STATS };
          defaultStats.lastUpdated = new Date().toISOString();

          try {
            const jsonString = JSON.stringify(defaultStats, null, 2);
            fs.writeFileSync(STATS_FILE, jsonString, { encoding: 'utf8', flag: 'w' });
            logger.info('Created new stats file with default values');
            return defaultStats;
          } catch (writeError) {
            logger.error({ error: writeError }, 'Failed to create new stats file');
            return defaultStats;
          }
        }
      } else {
        logger.warn('No backup stats file found, using default stats');

        // Create a new stats file with default values
        const defaultStats = { ...DEFAULT_STATS };
        defaultStats.lastUpdated = new Date().toISOString();

        try {
          const jsonString = JSON.stringify(defaultStats, null, 2);
          fs.writeFileSync(STATS_FILE, jsonString, { encoding: 'utf8', flag: 'w' });
          logger.info('Created new stats file with default values');
        } catch (writeError) {
          logger.error({ error: writeError }, 'Failed to create new stats file');
        }

        return defaultStats;
      }
    }

    // Validate JSON before parsing
    let stats;
    try {
      // Try to parse the JSON data
      try {
        stats = JSON.parse(data);
      } catch (parseError) {
        logger.error({ error: parseError }, 'JSON parse error in stats file');

        // Handle 'Unexpected end of JSON input' specifically
        if (parseError.message.includes('Unexpected end of JSON input')) {
          logger.warn('Detected truncated JSON file - attempting to repair');

          // Create a new stats file with default values
          const defaultStats = { ...DEFAULT_STATS };
          defaultStats.lastUpdated = new Date().toISOString();

          try {
            const jsonString = JSON.stringify(defaultStats, null, 2);
            fs.writeFileSync(STATS_FILE, jsonString, { encoding: 'utf8', flag: 'w' });
            logger.info('Created new stats file with default values after truncation error');
            return defaultStats;
          } catch (writeError) {
            logger.error(
              { error: writeError },
              'Failed to create new stats file after truncation error'
            );
            return defaultStats;
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
            stats = JSON.parse(cleanedData);
          } else {
            throw new Error('Could not find valid JSON structure');
          }
        } catch (cleanError) {
          // If cleaning fails, try to recover from backup
          logger.info('Attempting to recover stats from backup file');
          if (fs.existsSync(STATS_FILE + '.bak')) {
            try {
              const backupData = fs.readFileSync(STATS_FILE + '.bak', 'utf8');
              stats = JSON.parse(backupData.trim());
              logger.info('Successfully recovered stats from backup');
            } catch (backupError) {
              logger.error({ error: backupError }, 'Failed to recover stats from backup');

              // Create a new stats file with default values as last resort
              const defaultStats = { ...DEFAULT_STATS };
              defaultStats.lastUpdated = new Date().toISOString();

              try {
                const jsonString = JSON.stringify(defaultStats, null, 2);
                fs.writeFileSync(STATS_FILE, jsonString, { encoding: 'utf8', flag: 'w' });
                logger.info('Created new stats file with default values as last resort');
              } catch (writeError) {
                logger.error(
                  { error: writeError },
                  'Failed to create new stats file as last resort'
                );
              }

              return defaultStats;
            }
          } else {
            logger.warn('No backup stats file found, using default stats');

            // Create a new stats file with default values
            const defaultStats = { ...DEFAULT_STATS };
            defaultStats.lastUpdated = new Date().toISOString();

            try {
              const jsonString = JSON.stringify(defaultStats, null, 2);
              fs.writeFileSync(STATS_FILE, jsonString, { encoding: 'utf8', flag: 'w' });
              logger.info('Created new stats file with default values when no backup exists');
            } catch (writeError) {
              logger.error(
                { error: writeError },
                'Failed to create new stats file when no backup exists'
              );
            }

            return defaultStats;
          }
        }
      }

      // Validate that the parsed object has the expected structure
      if (!stats || typeof stats !== 'object') {
        throw new Error('Stats file does not contain a valid object');
      }

      // Validate required fields
      if (!stats.messageCount && stats.messageCount !== 0) {
        logger.warn('Stats file missing messageCount, using default value');
        stats.messageCount = DEFAULT_STATS.messageCount;
      }

      if (!stats.apiCalls) {
        logger.warn('Stats file missing apiCalls, using default value');
        stats.apiCalls = { ...DEFAULT_STATS.apiCalls };
      }

      if (!stats.rateLimits) {
        logger.warn('Stats file missing rateLimits, using default value');
        stats.rateLimits = { ...DEFAULT_STATS.rateLimits };
      }

      // Ensure userCounts is prototype-less for security
      if (
        stats.rateLimits &&
        stats.rateLimits.userCounts &&
        Object.getPrototypeOf(stats.rateLimits.userCounts) !== null
      ) {
        const safeUserCounts = Object.create(null);
        // Only copy safe keys
        for (const key in stats.rateLimits.userCounts) {
          if (
            Object.prototype.hasOwnProperty.call(stats.rateLimits.userCounts, key) &&
            isSafeKey(key)
          ) {
            safeUserCounts[key] = stats.rateLimits.userCounts[key];
          }
        }
        stats.rateLimits.userCounts = safeUserCounts;
      }
    } catch (parseError) {
      logger.error({ error: parseError }, 'JSON parse error in stats file');

      // Try to recover from corruption by loading the backup
      if (fs.existsSync(STATS_FILE + '.bak')) {
        logger.info('Attempting to recover stats from backup file');
        try {
          const backupData = await fs.promises.readFile(STATS_FILE + '.bak', 'utf8');
          stats = JSON.parse(backupData.trim());

          // If successful, restore the backup as the main file
          await fs.promises.copyFile(STATS_FILE + '.bak', STATS_FILE);
          logger.info('Successfully recovered stats from backup');
        } catch (backupError) {
          logger.error({ error: backupError }, 'Failed to recover from backup');
          return { ...DEFAULT_STATS };
        }
      } else {
        // If no backup exists or backup is also corrupted, use default stats
        logger.warn('No valid backup found, using default stats');
        return { ...DEFAULT_STATS };
      }
    }

    // Convert users array back to a Set
    if (stats.rateLimits && Array.isArray(stats.rateLimits.users)) {
      stats.rateLimits.users = new Set(stats.rateLimits.users);
    }

    return stats;
  } catch (error) {
    logger.error({ error }, 'Failed to load stats');

    // Return default stats on error
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

    // Validate the main key for safety
    if (!isSafeKey(key)) {
      logger.warn({ key }, 'Blocked update to potentially dangerous key');
      return false;
    }

    // Handle nested keys (e.g., 'apiCalls.openai')
    const keys = key.split('.');
    let current = stats;

    // Navigate to the nested property with safety checks
    for (let i = 0; i < keys.length - 1; i++) {
      const currentKey = keys[i];

      // Validate each key in the path
      if (!isSafeKey(currentKey)) {
        logger.warn(
          { key: currentKey, fullPath: key },
          'Blocked navigation to potentially dangerous nested key'
        );
        return false;
      }

      // Safe property access using hasOwnProperty check
      if (!Object.prototype.hasOwnProperty.call(current, currentKey)) {
        current[currentKey] = {};
      }
      current = current[currentKey];
    }

    // Update the value with final key validation
    const lastKey = keys[keys.length - 1];
    if (!isSafeKey(lastKey)) {
      logger.warn(
        { key: lastKey, fullPath: key },
        'Blocked update to potentially dangerous final key'
      );
      return false;
    }

    if (increment) {
      // Safe property access for increment
      const currentValue = Object.prototype.hasOwnProperty.call(current, lastKey)
        ? current[lastKey] || 0
        : 0;
      current[lastKey] = currentValue + value;
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
    // Validate userId to prevent prototype pollution
    if (!userId || typeof userId !== 'string' || !isSafeKey(userId)) {
      logger.warn(
        { userId },
        'Blocked potentially dangerous user ID from being added to rate limits'
      );
      return false;
    }

    const stats = await loadStats();

    // Increment the hit counter
    stats.rateLimits.hit = (stats.rateLimits.hit || 0) + 1;

    // Add the user ID to the set
    if (!stats.rateLimits.users) {
      stats.rateLimits.users = new Set();
    }
    stats.rateLimits.users.add(userId);

    // Initialize userCounts if it doesn't exist or ensure it's prototype-less
    if (!stats.rateLimits.userCounts) {
      stats.rateLimits.userCounts = Object.create(null);
    }

    // Safely increment the count for this user
    const currentCount = Object.prototype.hasOwnProperty.call(stats.rateLimits.userCounts, userId)
      ? stats.rateLimits.userCounts[userId] || 0
      : 0;
    stats.rateLimits.userCounts[userId] = currentCount + 1;

    // Save the updated stats
    return await saveStats(stats);
  } catch (error) {
    logger.error({ error }, 'Failed to add rate-limited user');
    return false;
  }
}

/**
 * Reset all stats to default values.
 *
 * @returns {Promise<boolean>} True if successful, false otherwise
 * @throws {Error} If an error occurs while resetting
 */
async function resetStats() {
  try {
    // Create a fresh default stats object with current timestamps
    const freshStats = {
      ...DEFAULT_STATS,
      startTime: new Date().toISOString(),
      lastRestart: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };

    // Save the fresh stats
    return await saveStats(freshStats);
  } catch (error) {
    logger.error({ error }, 'Failed to reset stats');
    return false;
  }
}

/**
 * Repair the stats file if it's corrupted.
 *
 * @returns {Promise<boolean>} True if repair was successful or not needed, false if repair failed
 */
async function repairStatsFile() {
  try {
    logger.info('Starting stats file repair process');

    // Ensure data directory exists and is writable
    const dirReady = ensureDataDir();
    if (!dirReady) {
      logger.error('Cannot repair stats: data directory not available or not writable');

      // Try to create the directory with more aggressive permissions
      try {
        const dataDir = path.join(__dirname, '../../data');
        logger.info(`Attempting to create data directory with full permissions: ${dataDir}`);
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o777 });

        // Check if we succeeded
        if (!fs.existsSync(dataDir)) {
          logger.error('Failed to create data directory even with full permissions');
          return false;
        }

        logger.info('Successfully created data directory with full permissions');
      } catch (dirError) {
        logger.error({ error: dirError }, 'Failed to create data directory with full permissions');
        return false;
      }
    }

    // Check if the stats file exists
    if (!fs.existsSync(STATS_FILE)) {
      logger.info('Stats file does not exist, creating default stats file');
      await saveStats({ ...DEFAULT_STATS });
      return true;
    }

    // Try to read and parse the stats file
    let needsRepair = false;
    let stats = { ...DEFAULT_STATS };

    try {
      const data = await fs.promises.readFile(STATS_FILE, 'utf8');
      stats = JSON.parse(data.trim());
      logger.info('Stats file parsed successfully, checking for integrity');

      // Check for required fields
      if (!stats.messageCount && stats.messageCount !== 0) {
        logger.warn('Stats file missing messageCount, needs repair');
        needsRepair = true;
        stats.messageCount = DEFAULT_STATS.messageCount;
      }

      if (!stats.apiCalls) {
        logger.warn('Stats file missing apiCalls, needs repair');
        needsRepair = true;
        stats.apiCalls = { ...DEFAULT_STATS.apiCalls };
      }

      if (!stats.rateLimits) {
        logger.warn('Stats file missing rateLimits, needs repair');
        needsRepair = true;
        stats.rateLimits = { ...DEFAULT_STATS.rateLimits };
      }

      // Ensure userCounts is prototype-less during repair
      if (
        stats.rateLimits &&
        stats.rateLimits.userCounts &&
        Object.getPrototypeOf(stats.rateLimits.userCounts) !== null
      ) {
        logger.warn('Converting userCounts to prototype-less object for security');
        needsRepair = true;
        const safeUserCounts = Object.create(null);
        // Only copy safe keys
        for (const key in stats.rateLimits.userCounts) {
          if (
            Object.prototype.hasOwnProperty.call(stats.rateLimits.userCounts, key) &&
            isSafeKey(key)
          ) {
            safeUserCounts[key] = stats.rateLimits.userCounts[key];
          }
        }
        stats.rateLimits.userCounts = safeUserCounts;
      }
    } catch (error) {
      logger.error({ error }, 'Stats file is corrupted, attempting repair');
      needsRepair = true;

      // Try to recover from backup
      if (fs.existsSync(STATS_FILE + '.bak')) {
        try {
          const backupData = await fs.promises.readFile(STATS_FILE + '.bak', 'utf8');
          stats = JSON.parse(backupData.trim());
          logger.info('Successfully recovered stats from backup');
        } catch (backupError) {
          logger.error(
            { error: backupError },
            'Backup file is also corrupted, using default stats'
          );
          stats = { ...DEFAULT_STATS };
        }
      } else {
        logger.warn('No backup file found, using default stats');
        stats = { ...DEFAULT_STATS };
      }
    }

    if (needsRepair) {
      logger.info('Repairing stats file');
      // Convert Set to Array for JSON serialization
      if (stats.rateLimits && stats.rateLimits.users instanceof Set) {
        stats.rateLimits.users = Array.from(stats.rateLimits.users);
      }

      // Create a backup of the corrupted file for analysis if needed
      if (fs.existsSync(STATS_FILE)) {
        try {
          await fs.promises.copyFile(STATS_FILE, STATS_FILE + '.corrupted');
          logger.info('Created backup of corrupted stats file');
        } catch (backupError) {
          logger.warn({ error: backupError }, 'Failed to create backup of corrupted stats file');
        }
      }

      // Write the repaired stats to the file
      await fs.promises.writeFile(STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');

      logger.info('Stats file repaired successfully');
      return true;
    }

    logger.info('Stats file is healthy, no repair needed');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to repair stats file');
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
  repairStatsFile,
  DEFAULT_STATS,
};
