require('dotenv').config();
/**
 * ChimpGPT - A Discord bot with AI capabilities
 *
 * This bot integrates OpenAI's GPT model with Discord to provide
 * conversational AI, weather lookups, time zone information,
 * Quake server statistics, and Wolfram Alpha queries.
 *
 * @module ChimpGPT
 * @author Brett
 * @version 1.9.2
 */

const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');
// Service imports moved to respective processors/handlers:
// - lookupWeather, lookupExtendedForecast, simplifiedWeather moved to functionCallProcessor.js
// - lookupTime moved to functionCallProcessor.js
// - lookupWolfram moved to functionCallProcessor.js
// - lookupQuakeServer moved to quakeStatsHandler.js
// generateImage, enhanceImagePrompt moved to imageGenerationHandler.js
const pluginManager = require('../plugins/pluginManager');
const commandHandler = require('../commands/commandHandler');
const ClientEventHandler = require('./eventHandlers/clientEventHandler');
const { initStatusManager } = require('../web/statusManager');
const { handleImageGeneration } = require('../handlers/imageGenerationHandler');
// handleQuakeStats now used directly in functionCallProcessor.js
const { handleDirectMessage } = require('../handlers/directMessageHandler');
const { formatSubtext } = require('../handlers/responseFormatter');
const {
  storeMessageRelationship,
  messageRelationships,
} = require('../handlers/messageRelationships');
const { handleFunctionCall } = require('./processors/functionCallProcessor');
// generateNaturalResponse now used directly in functionCallProcessor.js

// Import loggers
const { logger, discord: discordLogger } = require('./logger');

// Performance monitoring moved to specific handlers

// Import validated configuration
const config = require('./configValidator');

// Import the function results optimization patch
const optimizationPatch = require('../conversation/optimizationPatch');
logger.info(
  `Function results optimization patch applied: ${optimizationPatch.success ? 'SUCCESS' : 'FAILED'}`
);

// Note: We're now using a direct replacement for the conversation manager
// instead of a patch to avoid circular dependency issues
logger.info('Using simple conversation optimizer for better performance');

// Configuration option to disable plugins for better performance
// This can be controlled via environment variable or set directly
const DISABLE_PLUGINS = process.env.DISABLE_PLUGINS !== 'false'; // Default to disabled for better performance

// Rate limiter moved to specific processors

// Health check system moved to specific processors

// Import stats storage for graceful shutdown
const statsStorage = require('./statsStorage');

// Import malicious user manager for tracking suspicious behavior

// Module-level variable for status manager

// Status manager already imported above

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// Log bot version at startup
const { version: botVersion } = require('../../package.json');
logger.info(`ChimpGPT starting up - version ${botVersion}`);
// Initialize Discord client with proper intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages, // Add intent for DMs
    GatewayIntentBits.GuildMessageReactions, // Required for reaction collectors
    GatewayIntentBits.DirectMessageReactions, // Required for DM reaction collectors
  ],
});

// Import conversation manager - dynamically selected based on configuration
// This will use either blended or individual conversation mode based on USE_BLENDED_CONVERSATIONS setting
const {
  // manageConversation, // Now used directly in directMessageHandler.js and messageEventHandler.js
  shutdown: shutdownConversations,
} = require('../conversation/conversationManagerSelector');

const loadingEmoji = config.LOADING_EMOJI || '⏳';
const allowedChannelIDs = config.CHANNEL_ID; // Already an array from configValidator

// Status manager instance (will be initialized when client is ready)
let statusManager = null;

/**
 * Processes a message using OpenAI's GPT model
 *
 * This function sends the conversation context to OpenAI's API and handles the response.
 * It uses the latest user message from the conversation log for processing.
 * It includes function calling capabilities for weather, time, Quake server stats,
 * and Wolfram Alpha queries.
 *
 * @param {string} content - The user's message content (fallback if conversation log is empty)
 * @param {Array<Object>} conversationLog - The conversation history
 * @returns {Promise<Object>} The response from OpenAI
 * @throws {Error} If the API call fails
 */

// generateNaturalResponse function moved to ../processors/responseGenerator.js

// Command handler system already imported at top of file

// Track in-progress operations
const inProgressOperations = new Set();

// messageRelationships moved to ../handlers/messageRelationships.js

// storeMessageRelationship function moved to ../handlers/messageRelationships.js

// Handle message deletion

/**
 * Handles requests for Quake server statistics
 *
 * This function retrieves Quake server statistics and updates the message
 * with the formatted results. It uses the configured ELO display mode.
 *
 * @param {Object} feedbackMessage - The Discord message to update with results
 * @returns {Promise<boolean>} True if successful, false if an error occurred
 */
// handleQuakeStats function moved to ../handlers/quakeStatsHandler.js

/**
 * Handles image generation requests
 *
 * This function processes image generation requests using GPT Image-1,
 * downloads the generated image, and sends it to the Discord channel.
 *
 * @param {Object} parameters - Parameters for image generation
 * @param {Object} message - The Discord message to update
 * @param {Array} [conversationLog=[]] - The conversation history
 * @returns {Promise<void>}
 */
// handleImageGeneration function moved to ../handlers/imageGenerationHandler.js
// Updated to use dependency injection pattern
async function _handleImageGenerationWrapper(
  parameters,
  message,
  conversationLog = [],
  startTime = null,
  usage = {},
  apiCalls = {}
) {
  return await handleImageGeneration(
    parameters,
    message,
    conversationLog,
    startTime,
    usage,
    apiCalls,
    formatSubtext,
    storeMessageRelationship,
    statusManager
  );
}

// Legacy function for compatibility - remove after migration

// handleFunctionCall function moved to ../processors/functionCallProcessor.js

// formatSubtext function moved to ../handlers/responseFormatter.js

// handleDirectMessage function moved to ../handlers/directMessageHandler.js

// Ready event handler removed - functionality has been moved to ClientEventHandler

/**
 * Initialize and start the Discord bot
 *
 * This function initializes the bot and logs in to Discord.
 * It's exposed to allow the bot to be started from other modules.
 *
 * @returns {Promise<void>}
 */
async function startBot() {
  discordLogger.info('Attempting to log in to Discord');
  try {
    // Initialize client event handler before connecting
    const _clientEventHandler = new ClientEventHandler(client, config, {
      openai,
      allowedChannelIDs,
      loadingEmoji,
      DISABLE_PLUGINS,
      inProgressOperations,
      messageRelationships,
      handleFunctionCall,
      handleDirectMessage,
      formatSubtext,
      storeMessageRelationship,
      statusManager: { instance: null }, // Will be set by the handler
    });
    discordLogger.info('Client event handler initialized');

    // Load plugins before connecting to Discord
    discordLogger.info('Loading plugins...');
    const pluginCount = await pluginManager.loadPlugins();
    discordLogger.info({ pluginCount }, 'Plugins loaded successfully');

    // Load commands
    discordLogger.info('Loading commands...');
    const commandCount = await commandHandler.loadCommands();
    discordLogger.info({ commandCount }, 'Commands loaded successfully');

    // Connect to Discord
    await client.login(config.DISCORD_TOKEN);
    discordLogger.info('Successfully logged in to Discord');

    // Initialize status manager for functions in main file
    // Note: ClientEventHandler also initializes its own instance
    statusManager = initStatusManager(client);
    discordLogger.info('Status manager initialized for main file functions');

    // Log conversation mode configuration
    const conversationMode = {
      blended: config.USE_BLENDED_CONVERSATIONS,
      replyContext: config.ENABLE_REPLY_CONTEXT,
      maxPerUser: config.MAX_MESSAGES_PER_USER_BLENDED,
      pocketFlow: config.ENABLE_POCKETFLOW,
      parallelTesting: config.POCKETFLOW_PARALLEL_TESTING,
    };

    let modeDescription;
    if (config.ENABLE_POCKETFLOW) {
      modeDescription = 'PocketFlow (Graph-based Architecture)';
    } else if (config.POCKETFLOW_PARALLEL_TESTING) {
      modeDescription = 'Parallel Testing (PocketFlow + Legacy)';
    } else {
      modeDescription = conversationMode.blended
        ? conversationMode.replyContext
          ? 'Legacy: Blended with Reply Context'
          : 'Legacy: Blended Only'
        : conversationMode.replyContext
          ? 'Legacy: Individual with Reply Context'
          : 'Legacy: Individual Only';
    }

    discordLogger.info(
      {
        conversationMode: modeDescription,
        blendedConversations: conversationMode.blended,
        replyContext: conversationMode.replyContext,
        maxMessagesPerUser: conversationMode.maxPerUser,
      },
      'Conversation mode configuration'
    );

    // Execute onBotStart hooks for plugins
    await pluginManager.executeHook('onBotStart', client);
  } catch (error) {
    discordLogger.fatal({ error }, 'Failed to start bot');
    throw error;
  }
}

/**
 * Gracefully shut down the bot and all related services
 *
 * This function handles the graceful shutdown of the bot, ensuring that
 * all connections are properly closed, pending operations are completed,
 * and resources are released before the process exits.
 *
 * @param {string} signal - The signal that triggered the shutdown
 * @param {Error} [error] - Optional error that caused the shutdown
 * @returns {Promise<void>}
 */
async function shutdownGracefully(signal, error) {
  let exitCode = 0;
  const shutdownStart = Date.now();

  try {
    discordLogger.info({ signal }, 'Graceful shutdown initiated');

    if (error) {
      discordLogger.error({ error }, 'Shutdown triggered by error');
      exitCode = 1;
    }

    // Set a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      discordLogger.fatal('Forced exit due to shutdown timeout');
      process.exit(exitCode || 1);
    }, 10000); // 10 seconds timeout

    // Clear the timeout if we exit normally
    forceExitTimeout.unref();

    // 1. Execute plugin shutdown hooks
    try {
      discordLogger.info('Executing plugin shutdown hooks');
      await pluginManager.executeHook('onBotShutdown');
      discordLogger.info('Plugin shutdown hooks executed successfully');
    } catch (shutdownError) {
      discordLogger.error({ error: shutdownError }, 'Error executing plugin shutdown hooks');
    }

    // 2. Save any pending data
    try {
      discordLogger.info('Saving pending statistics');
      const { stats } = require('./healthCheck');
      await statsStorage.saveStats(stats);
      discordLogger.info('Statistics saved successfully');
    } catch (saveError) {
      discordLogger.error({ error: saveError }, 'Error saving statistics during shutdown');
    }

    // 3. Save conversations using the optimized storage
    try {
      discordLogger.info('Shutting down conversation manager');
      await shutdownConversations();
      discordLogger.info('Conversation manager shut down successfully');
    } catch (saveError) {
      discordLogger.error({ error: saveError }, 'Error shutting down conversation manager');
    }

    // 4. Close Discord connection
    try {
      discordLogger.info('Destroying Discord client');
      client.destroy();
      discordLogger.info('Discord client destroyed successfully');
    } catch (discordError) {
      discordLogger.error({ error: discordError }, 'Error destroying Discord client');
    }

    // 5. Clean up optimization patch resources
    try {
      logger.info('Cleaning up optimization patch resources');
      await optimizationPatch.shutdown();
      logger.info('Optimization resources cleaned up successfully');
    } catch (optimizationError) {
      logger.error({ error: optimizationError }, 'Error cleaning up optimization patch resources');
    }

    // Note: Conversation optimization resources are now cleaned up in step 3

    // 7. Close any open API connections or pending requests
    // This is a placeholder - add specific cleanup for any other services as needed

    // 8. Log successful shutdown
    const shutdownDuration = Date.now() - shutdownStart;
    discordLogger.info({ durationMs: shutdownDuration }, 'Graceful shutdown completed');

    // Exit with appropriate code
    process.exit(exitCode);
  } catch (shutdownError) {
    discordLogger.fatal({ error: shutdownError }, 'Fatal error during shutdown process');
    process.exit(1);
  }
}

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
process.on('SIGINT', () => shutdownGracefully('SIGINT'));
process.on('SIGHUP', () => shutdownGracefully('SIGHUP'));

// Discord connection event listeners removed - functionality has been moved to ClientEventHandler

// Handle uncaught exceptions and unhandled promise rejections
process.on('uncaughtException', error => {
  shutdownGracefully('uncaughtException', error);
});

process.on('unhandledRejection', reason => {
  shutdownGracefully('unhandledRejection', new Error(`Unhandled promise rejection: ${reason}`));
});

// Start the bot if this file is run directly
if (require.main === module) {
  startBot().catch(error => {
    discordLogger.error({ error }, 'Failed to start bot');
    shutdownGracefully('startupError', error);
  });
}

// Export the bot functionality for use in other modules
module.exports = {
  client,
  startBot,
  shutdownGracefully,
  stats: require('./healthCheck').stats,
};
