/**
 * Reset Data Files Script
 *
 * This script creates clean, valid JSON files for stats and function results.
 * It's useful when the existing files are corrupted or have JSON parsing errors.
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');

// Configure logger
const logger = createLogger('reset-data', { level: 'info' });

// File paths
const DATA_DIR = path.join(__dirname, 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const FUNCTION_RESULTS_FILE = path.join(DATA_DIR, 'function-results.json');

// Default stats structure
const DEFAULT_STATS = {
  startTime: new Date().toISOString(),
  messageCount: 0,
  apiCalls: {
    openai: 0,
    weather: 0,
    time: 0,
    wolfram: 0,
    quake: 0,
    dalle: 0,
    plugins: {},
  },
  errors: {
    openai: 0,
    discord: 0,
    weather: 0,
    time: 0,
    wolfram: 0,
    quake: 0,
    dalle: 0,
    plugins: {},
    other: 0,
  },
  lastRestart: new Date().toISOString(),
  rateLimits: {
    hit: 0,
    users: [],
  },
  plugins: {
    loaded: 0,
    commands: 0,
    functions: 0,
    hooks: 0,
  },
  discord: {
    ping: 0,
    status: 'offline',
    guilds: 0,
    channels: 0,
  },
  lastUpdated: new Date().toISOString(),
};

// Default function results structure
const DEFAULT_FUNCTION_RESULTS = {
  weather: [],
  time: [],
  wolfram: [],
  quake: [],
  dalle: [],
  plugins: {},
  lastUpdated: new Date().toISOString(),
};

/**
 * Ensure the data directory exists
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    try {
      logger.info(`Creating data directory: ${DATA_DIR}`);
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o755 });
    } catch (error) {
      logger.error({ error }, 'Failed to create data directory');
      return false;
    }
  }
  return true;
}

/**
 * Create a clean stats file
 */
function createCleanStatsFile() {
  try {
    const jsonString = JSON.stringify(DEFAULT_STATS, null, 2);
    fs.writeFileSync(STATS_FILE, jsonString, { encoding: 'utf8', flag: 'w' });
    logger.info(`Created clean stats file at ${STATS_FILE}`);
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to create clean stats file');
    return false;
  }
}

/**
 * Create a clean function results file
 */
function createCleanFunctionResultsFile() {
  try {
    const jsonString = JSON.stringify(DEFAULT_FUNCTION_RESULTS, null, 2);
    fs.writeFileSync(FUNCTION_RESULTS_FILE, jsonString, { encoding: 'utf8', flag: 'w' });
    logger.info(`Created clean function results file at ${FUNCTION_RESULTS_FILE}`);
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to create clean function results file');
    return false;
  }
}

/**
 * Backup existing files if they exist
 */
function backupExistingFiles() {
  try {
    // Backup stats file
    if (fs.existsSync(STATS_FILE)) {
      const backupFile = `${STATS_FILE}.bak.${Date.now()}`;
      fs.copyFileSync(STATS_FILE, backupFile);
      logger.info(`Backed up stats file to ${backupFile}`);
    }

    // Backup function results file
    if (fs.existsSync(FUNCTION_RESULTS_FILE)) {
      const backupFile = `${FUNCTION_RESULTS_FILE}.bak.${Date.now()}`;
      fs.copyFileSync(FUNCTION_RESULTS_FILE, backupFile);
      logger.info(`Backed up function results file to ${backupFile}`);
    }

    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to backup existing files');
    return false;
  }
}

/**
 * Main function to reset data files
 */
function resetDataFiles() {
  logger.info('Starting data files reset process');

  // Ensure data directory exists
  if (!ensureDataDir()) {
    logger.error('Failed to ensure data directory exists');
    return false;
  }

  // Backup existing files
  backupExistingFiles();

  // Create clean files
  const statsResult = createCleanStatsFile();
  const functionResultsResult = createCleanFunctionResultsFile();

  if (statsResult && functionResultsResult) {
    logger.info('Successfully reset all data files');
    return true;
  } else {
    logger.error('Failed to reset some data files');
    return false;
  }
}

// Execute the reset
const result = resetDataFiles();
console.log(`Data files reset ${result ? 'successful' : 'failed'}`);
