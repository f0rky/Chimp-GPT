/**
 * ChimpGPT Combined Application
 *
 * This script runs both the Discord bot and status server in a single process.
 * It provides a unified entry point for the application while maintaining
 * separation of concerns between the bot and status server.
 *
 * Supports different run modes via command-line arguments:
 * - --mode [production|development|test|demo]
 * - --status-only: Run only the status server
 * - --bot-only: Run only the Discord bot
 * - --demo: Enable demo mode (generates mock data)
 * - --debug: Enable debug logging
 * - --quiet: Minimize logging (errors only)
 *
 * @module CombinedApp
 * @author Brett
 * @version 1.1.0
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const { parseRunMode } = require('./runModes');

// Parse run mode from command-line arguments
const runConfig = parseRunMode();

// Configure logger based on run mode
const logger = createLogger('combined', { level: runConfig.logLevel });

// Import the Discord bot
const bot = require('./chimpGPT');

// Import the status server
const { initStatusServer } = require('./statusServer');

/**
 * Ensure required directories exist
 */
function ensureDirectories() {
  const directories = ['logs', 'data', 'data/conversations', 'data/pfp'];

  directories.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info(`Created directory: ${dir}`);
    }
  });
}

/**
 * Start the combined application based on run configuration
 */
async function startCombinedApp() {
  try {
    // Ensure required directories exist
    ensureDirectories();

    logger.info(`Starting ChimpGPT in ${runConfig.mode} mode`);

    // Start components based on configuration
    if (runConfig.enableStatusServer) {
      logger.info('Starting status server...');
      await initStatusServer({
        demoMode: runConfig.demoMode,
      });
      logger.info('Status server started successfully');
    }

    if (runConfig.enableDiscordBot) {
      logger.info('Starting Discord bot...');
      await bot.startBot();
      logger.info('Discord bot started successfully');
    }

    if (runConfig.enableTests) {
      logger.info('Running in test mode - executing test suite');
      const runTests = require('./tests/runTests');
      await runTests();
    }

    logger.info('ChimpGPT startup complete');
  } catch (error) {
    logger.error({ error }, 'Failed to start application');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal, shutting down gracefully...');
  // Add cleanup code here if needed
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal, shutting down gracefully...');
  // Add cleanup code here if needed
  process.exit(0);
});

// Start the application
startCombinedApp();
