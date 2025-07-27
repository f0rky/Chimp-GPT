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

// Validate environment variables early in the startup process
const { validateEnvironmentVariables } = require('../../utils/securityUtils');

let validatedEnv;
try {
  validatedEnv = validateEnvironmentVariables();
  console.log('✅ Environment variables validated successfully');
} catch (error) {
  console.error('❌ Environment validation failed:', error.message);
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const { parseRunMode } = require('./runModes');
const { sanitizePath } = require('../../utils/inputSanitizer');

// Parse run mode from command-line arguments
const runConfig = parseRunMode();

// Configure logger based on run mode
const logger = createLogger('combined', { level: runConfig.logLevel });

// Import the Discord bot
const bot = require('./chimpGPT');

// Import the status server
const { initStatusServer } = require('../web/statusServer');

/**
 * Ensure required directories exist
 */
function ensureDirectories() {
  const directories = ['assets/logs', 'data', 'data/conversations', 'assets/pfp'];

  directories.forEach(dir => {
    // Sanitize the directory path to prevent path traversal
    const sanitizedDir = sanitizePath(dir);
    const dirPath = path.join(__dirname, '..', '..', sanitizedDir);

    // Validate that the resolved path stays within the project directory
    const resolvedPath = path.resolve(dirPath);
    const projectRoot = path.resolve(__dirname, '..', '..');
    if (!resolvedPath.startsWith(projectRoot)) {
      logger.error(`Path traversal attempt blocked for directory: ${dir}`);
      return;
    }

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info(`Created directory: ${sanitizedDir}`);
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
      const runTests = require('../../tests/unit/testRunner');
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

// Export validated environment for use by other modules
module.exports = {
  validatedEnv,
  startCombinedApp,
};

// Start the application when run directly
if (require.main === module) {
  startCombinedApp();
}
