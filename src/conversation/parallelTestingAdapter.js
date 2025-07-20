/**
 * Parallel Testing Adapter
 *
 * This module provides A/B testing capabilities by running both PocketFlow and legacy
 * conversation systems in parallel, comparing their results, and providing detailed
 * performance metrics.
 *
 * @module ParallelTestingAdapter
 */

const config = require('../core/configValidator');
const { createLogger } = require('../core/logger');
const ParallelConversationTester = require('./flow/ParallelConversationTester');

// Import existing services
const openaiConfig = require('../services/openaiConfig');
const functionCallProcessor = require('../core/processors/functionCallProcessor');

const logger = createLogger('parallelTestingAdapter');

// Initialize the parallel tester
let parallelTester;
let legacyManager;

function initializeParallelTester() {
  if (!parallelTester) {
    // Load the legacy manager based on configuration
    if (config.USE_BLENDED_CONVERSATIONS) {
      legacyManager = require('./useBlendedConversations');
    } else {
      legacyManager = require('./useSimpleOptimizer');
    }

    // Create mock command handler for now
    const mockCommandHandler = {
      executeCommand: async (commandName, _context) => {
        logger.debug(`Mock command execution: ${commandName}`);
        return {
          response: `Command ${commandName} executed (parallel testing mode)`,
        };
      },
    };

    const parallelOptions = {
      enableTesting: true,
      testPercentage: config.POCKETFLOW_TEST_PERCENTAGE,
      logComparisons: config.POCKETFLOW_LOG_COMPARISONS,
      testOnlyForUsers: config.POCKETFLOW_TEST_USERS,
      pocketFlow: {
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
      },
    };

    parallelTester = new ParallelConversationTester(
      legacyManager,
      openaiConfig.client,
      functionCallProcessor,
      mockCommandHandler,
      parallelOptions
    );

    logger.info('Parallel testing adapter initialized', {
      testPercentage: config.POCKETFLOW_TEST_PERCENTAGE,
      testUsers: config.POCKETFLOW_TEST_USERS.length || 'all',
      logComparisons: config.POCKETFLOW_LOG_COMPARISONS,
    });
  }
  return parallelTester;
}

/**
 * Manage a conversation with parallel testing
 * @param {string} userId - The user ID
 * @param {Object|null} newMessage - New message to add
 * @param {import('discord.js').Message} discordMessage - Discord message object
 * @returns {Promise<Array<Object>>} The conversation log
 */
async function manageConversation(userId, newMessage = null, discordMessage = null) {
  try {
    const tester = initializeParallelTester();

    if (!discordMessage) {
      logger.warn('No Discord message provided to parallel testing adapter');
      return await legacyManager.manageConversation(userId, newMessage, discordMessage);
    }

    // Convert Discord message to format expected by parallel tester
    const testMessage = {
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

    // Process through parallel tester (this will decide whether to test or use legacy)
    const result = await tester.processMessage(testMessage, {
      isDM: discordMessage.channel.isDMBased(),
      userId: userId,
      newMessage: newMessage,
    });

    // Convert result back to legacy format
    if (result && result.response) {
      const conversationLog = [];

      // Add the user message
      if (newMessage) {
        conversationLog.push({
          role: 'user',
          content: newMessage.content || discordMessage.content,
          timestamp: discordMessage.createdTimestamp,
          username: discordMessage.author.username,
        });
      }

      // Add the response
      conversationLog.push({
        role: 'assistant',
        content: result.response,
        timestamp: Date.now(),
        system: result.system || 'legacy',
        flowType: result.flowType,
        executionTime: result.executionTime,
        parallelTest: result.parallelTest || false,
      });

      return conversationLog;
    }
    // Fallback to legacy if parallel testing fails
    logger.warn('Parallel testing failed, falling back to legacy');
    return await legacyManager.manageConversation(userId, newMessage, discordMessage);
  } catch (error) {
    logger.error('Error in parallel testing adapter:', error);
    // Always fallback to legacy on error
    return await legacyManager.manageConversation(userId, newMessage, discordMessage);
  }
}

/**
 * Clear a conversation (delegates to legacy manager)
 * @param {string} userId - The user ID
 */
function clearConversation(userId) {
  return legacyManager.clearConversation(userId);
}

/**
 * Remove a message by ID (delegates to legacy manager)
 * @param {string} channelId - The channel ID
 * @param {string} messageId - The Discord message ID
 * @param {boolean} isDM - Whether this is a DM
 * @returns {boolean} True if message was removed
 */
function removeMessageById(channelId, messageId, isDM = false) {
  return legacyManager.removeMessageById(channelId, messageId, isDM);
}

/**
 * Update a message in conversation by Discord message ID (delegates to legacy manager)
 * @param {string} channelId - The channel ID
 * @param {string} messageId - The Discord message ID
 * @param {string} newContent - The new content
 * @param {boolean} isDM - Whether this is a DM
 * @returns {boolean} True if message was updated
 */
function updateMessageById(channelId, messageId, newContent, isDM = false) {
  return legacyManager.updateMessageById(channelId, messageId, newContent, isDM);
}

/**
 * Get active conversation count (includes parallel testing stats)
 * @returns {number} Total active conversations
 */
function getActiveConversationCount() {
  const legacyCount = legacyManager.getActiveConversationCount();

  try {
    const tester = initializeParallelTester();
    const pocketFlowStats = tester.getPocketFlowStats();

    // Return legacy count (as it's the primary system) but log additional info
    logger.debug('Conversation counts', {
      legacy: legacyCount,
      pocketflow: pocketFlowStats.flows?.individual?.totalConversations || 0,
    });

    return legacyCount;
  } catch (error) {
    logger.error('Error getting parallel testing stats:', error);
    return legacyCount;
  }
}

/**
 * Get conversation storage status (includes parallel testing metrics)
 * @returns {Object} Status object
 */
function getConversationStorageStatus() {
  const legacyStatus = legacyManager.getConversationStorageStatus();

  try {
    const tester = initializeParallelTester();
    const testStats = tester.getTestStats();
    const pocketFlowStats = tester.getPocketFlowStats();

    return {
      ...legacyStatus,
      mode: 'parallel_testing',
      info: 'Running parallel tests between PocketFlow and legacy systems',
      parallelTesting: {
        enabled: true,
        testPercentage: config.POCKETFLOW_TEST_PERCENTAGE,
        stats: {
          totalTests: testStats.overview.totalTests,
          successRate: testStats.overview.successRate,
          avgTimeDifference: testStats.performance.avgTimeDifference,
          pocketflowFasterPercentage: testStats.performance.pocketflowFasterPercentage,
          responseMatchPercentage: testStats.functionality.responseMatchPercentage,
        },
      },
      pocketflow: pocketFlowStats,
    };
  } catch (error) {
    logger.error('Error getting parallel testing status:', error);
    return {
      ...legacyStatus,
      mode: 'parallel_testing',
      info: 'Parallel testing enabled (stats unavailable)',
      error: error.message,
    };
  }
}

/**
 * Load conversations from storage (delegates to legacy manager)
 * @returns {Promise<boolean>} Success status
 */
async function loadConversationsFromStorage() {
  return await legacyManager.loadConversationsFromStorage();
}

/**
 * Save conversations to storage (saves both legacy and test data)
 * @returns {Promise<boolean>} Success status
 */
async function saveConversationsToStorage() {
  try {
    const legacyResult = await legacyManager.saveConversationsToStorage();

    const tester = initializeParallelTester();
    await tester.cleanup();

    return legacyResult;
  } catch (error) {
    logger.error('Error saving parallel testing data:', error);
    return false;
  }
}

/**
 * Start periodic saving
 */
function startPeriodicSaving() {
  legacyManager.startPeriodicSaving();
}

/**
 * Stop periodic saving
 */
function stopPeriodicSaving() {
  legacyManager.stopPeriodicSaving();
}

/**
 * Shutdown function for cleanup
 */
async function shutdown() {
  try {
    await legacyManager.shutdown();

    if (parallelTester) {
      logger.info('Shutting down parallel conversation tester');
      await parallelTester.shutdown();
      parallelTester = null;
    }
  } catch (error) {
    logger.error('Error during parallel testing shutdown:', error);
  }
}

/**
 * Get detailed parallel testing statistics
 * @returns {Object} Detailed test statistics
 */
function getParallelTestingStats() {
  try {
    const tester = initializeParallelTester();
    return tester.getTestStats();
  } catch (error) {
    logger.error('Error getting parallel testing stats:', error);
    return null;
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
  getParallelTestingStats, // Additional function for testing stats
  get MAX_MESSAGES_PER_USER() {
    return legacyManager ? legacyManager.MAX_MESSAGES_PER_USER : 5;
  },
};
