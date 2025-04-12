/**
 * ChimpGPT Combined Application
 * 
 * This script runs both the Discord bot and status server in a single process.
 * It provides a unified entry point for the application while maintaining
 * separation of concerns between the bot and status server.
 * 
 * @module CombinedApp
 * @author Brett
 * @version 1.0.0
 */

require('dotenv').config();
const { createLogger } = require('./logger');
const logger = createLogger('combined');

// Import the Discord bot
const bot = require('./chimpGPT');

// Import the status server
const { initStatusServer } = require('./statusServer');

/**
 * Start the combined application
 */
async function startCombinedApp() {
  try {
    // Start the status server first
    logger.info('Starting status server...');
    await initStatusServer();
    logger.info('Status server started successfully');
    
    // Then start the Discord bot
    logger.info('Starting Discord bot...');
    await bot.startBot();
    logger.info('Discord bot started successfully');
    
    logger.info('Combined application started - running both Discord bot and status server');
  } catch (error) {
    logger.error({ error }, 'Failed to start combined application');
    process.exit(1);
  }
}

// Start the combined application
startCombinedApp();
