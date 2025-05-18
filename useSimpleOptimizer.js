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
let initPromise = simpleOptimizer.init();

// Export optimized conversation management functions
module.exports = {
  // Main function to manage conversations
  manageConversation: async function(userId, newMessage = null) {
    try {
      await initPromise;
      return await simpleOptimizer.manageConversation(userId, newMessage);
    } catch (error) {
      logger.error({ error, userId }, 'Error in manageConversation');
      // Return a minimal valid conversation as fallback
      return [{ role: 'system', content: require('./configValidator').BOT_PERSONALITY }];
    }
  },
  
  // Clear a user's conversation
  clearConversation: async function(userId) {
    try {
      await initPromise;
      return await simpleOptimizer.clearConversation(userId);
    } catch (error) {
      logger.error({ error, userId }, 'Error in clearConversation');
      return false;
    }
  },
  
  // Get active conversation count
  getActiveConversationCount: async function() {
    try {
      await initPromise;
      return await simpleOptimizer.getConversationCount();
    } catch (error) {
      logger.error({ error }, 'Error in getActiveConversationCount');
      return 0;
    }
  },
  
  // Dummy functions to maintain API compatibility
  loadConversationsFromStorage: async function() {
    return true; // No-op, handled by optimizer
  },
  
  saveConversationsToStorage: async function() {
    return true; // No-op, handled by optimizer
  },
  
  // Get storage status
  getConversationStorageStatus: async function() {
    try {
      await initPromise;
      const status = await simpleOptimizer.getStatus();
      return {
        activeConversations: status.activeConversations,
        fileSize: status.fileSize,
        fileSizeMB: status.fileSizeMB,
        lastSave: status.lastUpdated,
        optimized: true,
        simple: true
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
        error: error.message
      };
    }
  },
  
  // Clean up resources for shutdown
  shutdown: async function() {
    try {
      await initPromise;
      await simpleOptimizer.shutdown();
      logger.info('Simple conversation optimizer shut down successfully');
      return true;
    } catch (error) {
      logger.error({ error }, 'Error shutting down simple conversation optimizer');
      return false;
    }
  }
};
