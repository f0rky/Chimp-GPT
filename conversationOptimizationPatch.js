/**
 * Conversation Optimization Patch
 *
 * This module integrates the conversation optimizer as a drop-in replacement
 * for the original conversation management system. It intercepts calls to
 * the original modules to make operations more efficient.
 *
 * @module ConversationOptimizationPatch
 * @author Cascade
 * @version 1.0.0
 */

const originalConvManager = require('./conversationManager');
const optimizer = require('./conversationOptimizer');
const { createLogger } = require('./logger');
const logger = createLogger('convOptimPatch');

// Initialize the optimizer
optimizer.init().catch(err => {
  logger.error({ error: err }, 'Failed to initialize conversation optimizer');
});

/**
 * Apply patches to the original conversation manager
 */
function applyPatches() {
  // Store original methods for reference
  const original = {
    manageConversation: originalConvManager.manageConversation,
    clearConversation: originalConvManager.clearConversation,
    getActiveConversationCount: originalConvManager.getActiveConversationCount,
    loadConversationsFromStorage: originalConvManager.loadConversationsFromStorage,
    saveConversationsToStorage: originalConvManager.saveConversationsToStorage
  };

  // Override manageConversation - the most critical function
  originalConvManager.manageConversation = async function(userId, newMessage = null, discordMessage = null) {
    try {
      const startTime = Date.now();
      
      // Process references if this is a message from Discord
      let referenceMessages = [];
      const config = require('./configValidator');
      
      if (config.ENABLE_REPLY_CONTEXT && discordMessage?.reference) {
        try {
          const referenceResolver = require('./utils/messageReferenceResolver');
          
          // Extract reference context
          referenceMessages = await referenceResolver.extractReferenceContext(discordMessage, {
            maxDepth: originalConvManager.MAX_REFERENCE_CONTEXT,
            includeNonBot: true
          });
          
          logger.debug({
            userId,
            messageId: discordMessage?.id,
            referenceCount: referenceMessages.length
          }, 'Processed message references');
        } catch (refError) {
          logger.error({ error: refError, userId, messageId: discordMessage?.id }, 
                      'Error processing message references');
        }
      }
      
      // Get the conversation using the optimizer
      let conversation = await optimizer.getConversation(userId);
      
      // Add reference messages if any
      if (referenceMessages.length > 0) {
        for (const refMsg of referenceMessages) {
          await optimizer.addMessage(userId, refMsg);
        }
      }
      
      // Add the new message if provided
      if (newMessage) {
        await optimizer.addMessage(userId, newMessage);
      }
      
      // Get the optimized conversation for API use
      const optimizedConversation = optimizer.optimizeConversationForApi(conversation);
      
      const endTime = Date.now();
      logger.debug({
        userId,
        durationMs: endTime - startTime,
        originalLength: conversation.length,
        optimizedLength: optimizedConversation.length
      }, 'Optimized conversation management complete');
      
      // Return the optimized conversation for API use
      return optimizedConversation;
    } catch (error) {
      logger.error({ error, userId }, 'Error in optimized manageConversation');
      
      // Fall back to original implementation
      try {
        return await original.manageConversation(userId, newMessage, discordMessage);
      } catch (fallbackError) {
        logger.error({ error: fallbackError }, 'Fallback to original manageConversation also failed');
        
        // Return a minimal valid conversation as last resort
        return [{ role: 'system', content: require('./configValidator').BOT_PERSONALITY }];
      }
    }
  };

  // Override clearConversation
  originalConvManager.clearConversation = async function(userId) {
    try {
      const result = await optimizer.clearConversation(userId);
      return result;
    } catch (error) {
      logger.error({ error, userId }, 'Error in optimized clearConversation');
      
      // Fall back to original implementation
      try {
        return await original.clearConversation(userId);
      } catch (fallbackError) {
        logger.error({ error: fallbackError }, 'Fallback to original clearConversation also failed');
        return false;
      }
    }
  };

  // Override getActiveConversationCount
  originalConvManager.getActiveConversationCount = async function() {
    try {
      return await optimizer.getConversationCount();
    } catch (error) {
      logger.error({ error }, 'Error in optimized getActiveConversationCount');
      
      // Fall back to original implementation
      try {
        return await original.getActiveConversationCount();
      } catch (fallbackError) {
        logger.error({ error: fallbackError }, 'Fallback to original getActiveConversationCount also failed');
        return 0;
      }
    }
  };

  // Override loadConversationsFromStorage - make it a no-op since optimizer handles this
  originalConvManager.loadConversationsFromStorage = async function() {
    try {
      await optimizer.init(true); // Force reload
      return true;
    } catch (error) {
      logger.error({ error }, 'Error in optimized loadConversationsFromStorage');
      
      // Fall back to original implementation
      try {
        return await original.loadConversationsFromStorage();
      } catch (fallbackError) {
        logger.error({ error: fallbackError }, 'Fallback to original loadConversationsFromStorage also failed');
        return false;
      }
    }
  };

  // Override saveConversationsToStorage - handled by optimizer's auto-save
  originalConvManager.saveConversationsToStorage = async function() {
    // No-op - optimizer handles periodic saving
    return true;
  };

  // Override getConversationStorageStatus
  originalConvManager.getConversationStorageStatus = async function() {
    try {
      const status = await optimizer.getStatus();
      return {
        activeConversations: status.activeConversations,
        fileSize: status.fileSize,
        fileSizeMB: status.fileSizeMB,
        lastSave: status.lastUpdated,
        loadTime: status.loadTimeMs + 'ms',
        optimized: true
      };
    } catch (error) {
      logger.error({ error }, 'Error getting optimized conversation status');
      
      // Return basic info
      return {
        activeConversations: 'Unknown',
        fileSize: 'Unknown',
        fileSizeMB: 'Unknown',
        lastSave: new Date().toISOString(),
        loadTime: 'Unknown',
        optimized: false,
        error: error.message
      };
    }
  };

  logger.info('Successfully applied conversation optimization patches');
  return true;
}

/**
 * Clean up resources when the application is shutting down
 */
async function shutdown() {
  try {
    await optimizer.shutdown();
    logger.info('Conversation optimization patch shutdown complete');
    return true;
  } catch (error) {
    logger.error({ error }, 'Error during conversation optimization patch shutdown');
    return false;
  }
}

// Apply patches immediately
const success = applyPatches();

// Export the success status and methods
module.exports = {
  success,
  shutdown
};
