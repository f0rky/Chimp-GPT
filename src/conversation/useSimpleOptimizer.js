/**
 * Simple Conversation Optimizer Integration
 *
 * This module provides a direct replacement for the conversation manager
 * that doesn't use patching, avoiding the circular dependency issues.
 *
 * @module UseSimpleOptimizer
 * @author Cascade
 * @version 1.0.0
 */

const simpleOptimizer = require('./simpleConversationOptimizer');
const { createLogger } = require('./logger');
const logger = createLogger('useSimpleOpt');

// Initialize the optimizer once
const initPromise = simpleOptimizer.init();

// Export optimized conversation management functions
module.exports = {
  // Main function to manage conversations
  manageConversation: async function (userId, newMessage = null, discordMessage = null) {
    try {
      await initPromise;
      return await simpleOptimizer.manageConversation(userId, newMessage, discordMessage);
    } catch (error) {
      logger.error({ error, userId }, 'Error in manageConversation');
      // Return a minimal valid conversation as fallback
      return [{ role: 'system', content: require('./configValidator').BOT_PERSONALITY }];
    }
  },

  // Clear a user's conversation
  clearConversation: async function (userId) {
    try {
      await initPromise;
      return await simpleOptimizer.clearConversation(userId);
    } catch (error) {
      logger.error({ error, userId }, 'Error in clearConversation');
      return false;
    }
  },

  // Get active conversation count
  getActiveConversationCount: async function () {
    try {
      await initPromise;
      return await simpleOptimizer.getConversationCount();
    } catch (error) {
      logger.error({ error }, 'Error in getActiveConversationCount');
      return 0;
    }
  },

  // Dummy functions to maintain API compatibility
  loadConversationsFromStorage: async function () {
    return true; // No-op, handled by optimizer
  },

  saveConversationsToStorage: async function () {
    return true; // No-op, handled by optimizer
  },

  // Get storage status
  getConversationStorageStatus: async function () {
    try {
      await initPromise;
      const status = await simpleOptimizer.getStatus();
      return {
        activeConversations: status.activeConversations,
        fileSize: status.fileSize,
        fileSizeMB: status.fileSizeMB,
        lastSave: status.lastUpdated,
        optimized: true,
        simple: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in getConversationStorageStatus');
      return {
        activeConversations: 'Unknown',
        fileSize: 'Unknown',
        fileSizeMB: 'Unknown',
        lastSave: new Date().toISOString(),
        optimized: false,
        simple: true,
        error: error.message,
      };
    }
  },

  // Remove message by ID
  removeMessageById: async function (userId, messageId) {
    try {
      await initPromise;
      return await simpleOptimizer.removeMessageById(userId, messageId);
    } catch (error) {
      logger.error({ error, userId, messageId }, 'Error in removeMessageById');
      return false;
    }
  },

  // Update message by ID
  updateMessageById: async function (userId, messageId, newContent) {
    try {
      await initPromise;
      return await simpleOptimizer.updateMessageById(userId, messageId, newContent);
    } catch (error) {
      logger.error({ error, userId, messageId }, 'Error in updateMessageById');
      return false;
    }
  },

  // Clean up resources for shutdown
  shutdown: async function () {
    try {
      await initPromise;
      await simpleOptimizer.shutdown();
      logger.info('Simple conversation optimizer shut down successfully');
      return true;
    } catch (error) {
      logger.error({ error }, 'Error shutting down simple conversation optimizer');
      return false;
    }
  },
};
