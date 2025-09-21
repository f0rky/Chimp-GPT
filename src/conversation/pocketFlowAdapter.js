/**
 * PocketFlow Adapter
 *
 * This module provides a compatibility layer that wraps the PocketFlow conversation system
 * to match the existing conversation manager interface used throughout the codebase.
 *
 * @module PocketFlowAdapter
 */

const config = require('../core/configValidator');
const { createLogger } = require('../core/logger');
const PocketFlowConversationManager = require('./flow/PocketFlowConversationManager');

// Import existing services that PocketFlow needs
const openaiConfig = require('../services/openaiConfig');
const PocketFlowFunctionProcessor = require('../core/processors/pocketFlowFunctionProcessor');

const logger = createLogger('pocketFlowAdapter');

// Initialize PocketFlow manager
let pocketFlowManager;

function initializePocketFlow(pfpManager = null) {
  if (!pocketFlowManager) {
    const pocketFlowOptions = {
      enableParallelTesting: false,
      cleanupInterval: config.POCKETFLOW_CLEANUP_INTERVAL,
      maxConcurrentFlows: config.POCKETFLOW_MAX_CONCURRENT_FLOWS,
      flows: {
        individual: {
          timeout: 15000,
          config: {
            charsPerToken: 4,
            defaultMaxTokens: config.POCKETFLOW_CONTEXT_MAX_TOKENS,
            maxConversationLength: 20,
          },
        },
        blended: {
          confidenceThreshold: config.POCKETFLOW_INTENT_CONFIDENCE_THRESHOLD,
          config: {
            maxConversationLength: 15,
            defaultMaxTokens: config.POCKETFLOW_CONTEXT_MAX_TOKENS * 1.25,
            blendedChannelThreshold: 3,
            blendedModeTimeout: 300000,
          },
        },
        command: {
          enableBuiltins: true,
        },
      },
    };

    // Create mock command handler for now (will integrate with real one later)
    const mockCommandHandler = {
      executeCommand: async (commandName, _context) => {
        logger.debug(`Mock command execution: ${commandName}`);
        return {
          response: `Command ${commandName} executed (PocketFlow mode)`,
        };
      },
    };

    // Create PocketFlow function processor instance
    const pocketFlowFunctionProcessor = new PocketFlowFunctionProcessor(pfpManager);

    pocketFlowManager = new PocketFlowConversationManager(
      openaiConfig.client,
      pocketFlowFunctionProcessor,
      mockCommandHandler,
      pocketFlowOptions
    );

    logger.info('PocketFlow conversation manager initialized');
  }
  return pocketFlowManager;
}

/**
 * Manage a conversation using PocketFlow
 * @param {string} userId - The user ID
 * @param {Object|null} newMessage - New message to add
 * @param {import('discord.js').Message} discordMessage - Discord message object
 * @returns {Promise<Array<Object>>} The conversation log
 */
async function manageConversation(
  userId,
  newMessage = null,
  discordMessage = null,
  pfpManager = null
) {
  try {
    const manager = initializePocketFlow(pfpManager);

    if (!discordMessage) {
      logger.warn('No Discord message provided to PocketFlow adapter');
      return [];
    }

    // Convert Discord message to PocketFlow format
    const pocketFlowMessage = {
      id: discordMessage.id,
      content: discordMessage.content,
      createdTimestamp: discordMessage.createdTimestamp,
      author: {
        id: discordMessage.author.id,
        username: discordMessage.author.username,
        displayName: discordMessage.author.displayName || discordMessage.author.username,
      },
      channel: {
        id: discordMessage.channel.id,
        type: discordMessage.channel.isDMBased() ? 'DM' : 'GUILD_TEXT',
      },
      guild: discordMessage.guild
        ? {
            id: discordMessage.guild.id,
          }
        : null,
      reference: discordMessage.reference,
    };

    // Process message through PocketFlow
    const result = await manager.processMessage(pocketFlowMessage, {
      isDM: discordMessage.channel.isDMBased(),
      userId: userId,
    });

    if (result.success && result.result && result.result.response) {
      // Return PocketFlow result directly with special flag
      logger.debug(
        `PocketFlow processed message successfully: ${result.flowType} in ${result.executionTime}ms`
      );

      return {
        isPocketFlowResponse: true,
        response: result.result.response,
        flowType: result.flowType,
        executionTime: result.executionTime,
        functionCall: result.result.functionCall,
        type: result.result.type || 'direct_response',
      };
    }

    logger.warn(
      'PocketFlow processing failed, providing basic conversation context for fallback:',
      result.error
    );

    // Provide basic conversation context for legacy fallback processing
    const fallbackConversationLog = [];

    // Add system message for context using bot personality
    const configValidator = require('../core/configValidator');
    fallbackConversationLog.push({
      role: 'system',
      content: configValidator.BOT_PERSONALITY || 'You are a helpful AI assistant.',
      timestamp: Date.now(),
    });

    // Add the current user message
    if (newMessage) {
      fallbackConversationLog.push({
        role: 'user',
        content: newMessage.content || discordMessage.content,
        timestamp: discordMessage.createdTimestamp,
        username: discordMessage.author.username,
      });
    }

    return fallbackConversationLog;
  } catch (error) {
    logger.error('Error in PocketFlow adapter, providing minimal conversation context:', error);

    // Provide minimal conversation context for error fallback
    const errorFallbackLog = [];

    // Add system message using bot personality
    const configValidator2 = require('../core/configValidator');
    errorFallbackLog.push({
      role: 'system',
      content: configValidator2.BOT_PERSONALITY || 'You are a helpful AI assistant.',
      timestamp: Date.now(),
    });

    // Add user message if available
    if (discordMessage && discordMessage.content) {
      errorFallbackLog.push({
        role: 'user',
        content: discordMessage.content,
        timestamp: discordMessage.createdTimestamp || Date.now(),
        username: discordMessage.author?.username || 'Unknown',
      });
    }

    return errorFallbackLog;
  }
}

/**
 * Clear a conversation
 * @param {string} userId - The user ID
 */
function clearConversation(userId) {
  try {
    const manager = initializePocketFlow();
    const store = manager.flows.individual.getStore();
    const conversations = store.get('conversations');
    if (conversations && conversations.has(userId)) {
      conversations.delete(userId);
      logger.info(`Cleared PocketFlow conversation for user ${userId}`);
    }
  } catch (error) {
    logger.error('Error clearing PocketFlow conversation:', error);
  }
}

/**
 * Remove a message by ID (compatibility function)
 * @param {string} channelId - The channel ID
 * @param {string} messageId - The Discord message ID
 * @param {boolean} isDM - Whether this is a DM
 * @returns {boolean} True if message was removed
 */
function removeMessageById(channelId, messageId, _isDM = false) {
  logger.debug(`PocketFlow removeMessageById called for ${messageId} (compatibility mode)`);
  // PocketFlow doesn't need manual message removal as it manages context automatically
  return true;
}

/**
 * Update a message in conversation by Discord message ID (compatibility function)
 * @param {string} channelId - The channel ID
 * @param {string} messageId - The Discord message ID
 * @param {string} newContent - The new content
 * @param {boolean} isDM - Whether this is a DM
 * @returns {boolean} True if message was updated
 */
function updateMessageById(channelId, messageId, newContent, _isDM = false) {
  logger.debug(`PocketFlow updateMessageById called for ${messageId} (compatibility mode)`);
  // PocketFlow doesn't need manual message updates as it manages context automatically
  return true;
}

/**
 * Get active conversation count
 * @returns {number} Total active conversations
 */
function getActiveConversationCount() {
  try {
    const manager = initializePocketFlow();
    const stats = manager.getStats();
    return stats.flows.individual.totalConversations + stats.flows.blended.totalChannels;
  } catch (error) {
    logger.error('Error getting PocketFlow conversation count:', error);
    return 0;
  }
}

/**
 * Get conversation storage status
 * @returns {Object} Status object
 */
function getConversationStorageStatus() {
  try {
    const manager = initializePocketFlow();
    const stats = manager.getStats();

    return {
      mode: 'pocketflow',
      info: 'Using PocketFlow conversation system with graph-based architecture',
      individual: {
        conversations: stats.flows.individual.totalConversations,
        active: stats.flows.individual.activeConversations,
        messages: stats.flows.individual.totalMessages,
      },
      blended: {
        channels: stats.flows.blended.totalChannels,
        active: stats.flows.blended.activeChannels,
        messages: stats.flows.blended.totalMessages,
      },
      performance: {
        totalProcessed: stats.manager.totalProcessed,
        successRate:
          stats.manager.totalProcessed > 0
            ? (stats.manager.successfulResponses / stats.manager.totalProcessed) * 100
            : 0,
        avgResponseTime: stats.manager.avgResponseTime,
        activeFlows: stats.manager.activeFlows,
      },
    };
  } catch (error) {
    logger.error('Error getting PocketFlow status:', error);
    return {
      mode: 'pocketflow',
      info: 'PocketFlow conversation system (status unavailable)',
      error: error.message,
    };
  }
}

/**
 * Load conversations from storage
 * @returns {Promise<boolean>} Success status
 */
async function loadConversationsFromStorage() {
  logger.info('PocketFlow manages its own state - no explicit loading needed');
  return true;
}

/**
 * Save conversations to storage
 * @returns {Promise<boolean>} Success status
 */
async function saveConversationsToStorage() {
  try {
    const manager = initializePocketFlow();
    await manager.cleanup();
    logger.info('PocketFlow state cleanup completed');
    return true;
  } catch (error) {
    logger.error('Error saving PocketFlow state:', error);
    return false;
  }
}

/**
 * Start periodic saving (PocketFlow handles this automatically)
 */
function startPeriodicSaving() {
  logger.info('PocketFlow manages periodic cleanup automatically');
}

/**
 * Stop periodic saving
 */
function stopPeriodicSaving() {
  logger.info('PocketFlow periodic cleanup continues automatically');
}

/**
 * Shutdown function for cleanup
 */
async function shutdown() {
  try {
    if (pocketFlowManager) {
      logger.info('Shutting down PocketFlow conversation manager');
      await pocketFlowManager.shutdown();
      pocketFlowManager = null;
    }
  } catch (error) {
    logger.error('Error during PocketFlow shutdown:', error);
  }
}

module.exports = {
  manageConversation,
  clearConversation,
  removeMessageById,
  updateMessageById,
  getActiveConversationCount,
  getConversationStorageStatus,
  loadConversationsFromStorage,
  saveConversationsToStorage,
  startPeriodicSaving,
  stopPeriodicSaving,
  shutdown,
  MAX_MESSAGES_PER_USER: 20, // PocketFlow manages this dynamically
};
