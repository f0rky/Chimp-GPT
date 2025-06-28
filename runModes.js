/**
 * Run Modes Module
 *
 * This module provides support for different run modes via command-line arguments.
 * It allows the bot to be started in different configurations (production, development, test, demo)
 * without modifying the code or environment variables.
 *
 * @module RunModes
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('./src/core/logger');
const logger = createLogger('runModes');

// Available run modes
const RUN_MODES = {
  PRODUCTION: 'production',
  DEVELOPMENT: 'development',
  TEST: 'test',
  DEMO: 'demo',
};

// Default configurations for each run mode
const MODE_CONFIGS = {
  [RUN_MODES.PRODUCTION]: {
    logLevel: 'info',
    enableStatusServer: true,
    enableDiscordBot: true,
    demoMode: false,
    enableTests: false,
  },
  [RUN_MODES.DEVELOPMENT]: {
    logLevel: 'debug',
    enableStatusServer: true,
    enableDiscordBot: true,
    demoMode: false,
    enableTests: false,
  },
  [RUN_MODES.TEST]: {
    logLevel: 'debug',
    enableStatusServer: false,
    enableDiscordBot: false,
    demoMode: false,
    enableTests: true,
  },
  [RUN_MODES.DEMO]: {
    logLevel: 'info',
    enableStatusServer: true,
    enableDiscordBot: false,
    demoMode: true,
    enableTests: false,
  },
};

/**
 * Parse command-line arguments to determine the run mode
 * @returns {Object} The run mode configuration
 */
function parseRunMode() {
  // Get command-line arguments
  const args = process.argv.slice(2);

  // Default run mode based on NODE_ENV or fallback to development
  let runMode = process.env.NODE_ENV || RUN_MODES.DEVELOPMENT;

  // Check for --mode flag
  const modeIndex = args.indexOf('--mode');
  if (modeIndex !== -1 && args.length > modeIndex + 1) {
    const requestedMode = args[modeIndex + 1].toLowerCase();
    if (Object.values(RUN_MODES).includes(requestedMode)) {
      runMode = requestedMode;
    } else {
      logger.warn(`Invalid run mode: ${requestedMode}. Using ${runMode} instead.`);
    }
  }

  // Check for specific flags that override the mode config
  const config = { ...MODE_CONFIGS[runMode] };

  if (args.includes('--status-only')) {
    config.enableDiscordBot = false;
    config.enableStatusServer = true;
  }

  if (args.includes('--bot-only')) {
    config.enableDiscordBot = true;
    config.enableStatusServer = false;
  }

  if (args.includes('--demo')) {
    config.demoMode = true;
  }

  if (args.includes('--debug')) {
    config.logLevel = 'debug';
  }

  if (args.includes('--quiet')) {
    config.logLevel = 'error';
  }

  // Log the selected run mode and configuration
  logger.info(`Starting in ${runMode} mode with configuration:`, config);

  return {
    mode: runMode,
    ...config,
  };
}

module.exports = {
  RUN_MODES,
  parseRunMode,
};
