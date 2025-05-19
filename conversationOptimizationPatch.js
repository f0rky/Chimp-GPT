/**
 * Conversation Optimization Patch
 *
 * This module integrates the conversation optimizer as a drop-in replacement
 * for the original conversation management system. It intercepts calls to
 * the original modules to make operations more efficient.
 *
 * @module ConversationOptimizationPatch
 * @author Cascade
 * @version 1.0.1
 */

const { createLogger } = require('./logger');
const logger = createLogger('convOptimPatch');

// Use a local variable to prevent multiple initialization attempts
let isInitializing = false;
let isInitialized = false;
let optimizer = null;

// Forward declare original methods to avoid circular dependencies
let originalMethods = {
  manageConversation: null,
  clearConversation: null,
  getActiveConversationCount: null,
  loadConversationsFromStorage: null,
  saveConversationsToStorage: null,
  getConversationStorageStatus: null,
};

/**
 * Initialize the optimizer safely
 * @returns {Promise<boolean>} Success status
 */
async function initializeOptimizer() {
  if (isInitialized || isInitializing) {
    return true;
  }

  isInitializing = true;

  try {
    // Safe import of the optimizer
    optimizer = require('./conversationOptimizer');

    // Initialize optimizer only after successful import
    await optimizer.init();

    isInitialized = true;
    isInitializing = false;
    logger.info('Conversation optimizer initialized successfully');
    return true;
  } catch (err) {
    isInitializing = false;
    logger.error({ error: err }, 'Failed to initialize conversation optimizer');
    return false;
  }
}

/**
 * Apply patches to the original conversation manager
 */
function applyPatches() {
  try {
    // Get a reference to the original module
    const originalConvManager = require('./conversationManager');

    // Store original methods for fallback
    originalMethods = {
      manageConversation: originalConvManager.manageConversation,
      clearConversation: originalConvManager.clearConversation,
      getActiveConversationCount: originalConvManager.getActiveConversationCount,
      loadConversationsFromStorage: originalConvManager.loadConversationsFromStorage,
      saveConversationsToStorage: originalConvManager.saveConversationsToStorage,
      getConversationStorageStatus: originalConvManager.getConversationStorageStatus,
    };

    // Override manageConversation - the most critical function
    originalConvManager.manageConversation = async function (
      userId,
      newMessage = null,
      discordMessage = null
    ) {
      // Ensure optimizer is initialized
      if (!isInitialized) {
        await initializeOptimizer();

        // If initialization fails, use original method
        if (!isInitialized) {
          return await originalMethods.manageConversation(userId, newMessage, discordMessage);
        }
      }

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
              maxDepth: originalConvManager.MAX_REFERENCE_CONTEXT || 3,
              includeNonBot: true,
            });

            logger.debug(
              {
                userId,
                messageId: discordMessage?.id,
                referenceCount: referenceMessages.length,
              },
              'Processed message references'
            );
          } catch (refError) {
            logger.error(
              { error: refError, userId, messageId: discordMessage?.id },
              'Error processing message references'
            );
          }
        }

        // Get the conversation using the optimizer
        const conversation = await optimizer.getConversation(userId);

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
        logger.debug(
          {
            userId,
            durationMs: endTime - startTime,
            originalLength: conversation.length,
            optimizedLength: optimizedConversation.length,
          },
          'Optimized conversation management complete'
        );

        // Return the optimized conversation for API use
        return optimizedConversation;
      } catch (error) {
        logger.error({ error, userId }, 'Error in optimized manageConversation');

        // Fall back to original implementation
        try {
          return await originalMethods.manageConversation(userId, newMessage, discordMessage);
        } catch (fallbackError) {
          logger.error(
            { error: fallbackError },
            'Fallback to original manageConversation also failed'
          );

          // Return a minimal valid conversation as last resort
          return [{ role: 'system', content: require('./configValidator').BOT_PERSONALITY }];
        }
      }
    };

    // Override clearConversation
    originalConvManager.clearConversation = async function (userId) {
      if (!isInitialized) {
        await initializeOptimizer();
        if (!isInitialized) return originalMethods.clearConversation(userId);
      }

      try {
        const result = await optimizer.clearConversation(userId);
        return result;
      } catch (error) {
        logger.error({ error, userId }, 'Error in optimized clearConversation');

        // Fall back to original implementation
        try {
          return await originalMethods.clearConversation(userId);
        } catch (fallbackError) {
          logger.error(
            { error: fallbackError },
            'Fallback to original clearConversation also failed'
          );
          return false;
        }
      }
    };

    // Override getActiveConversationCount
    originalConvManager.getActiveConversationCount = async function () {
      if (!isInitialized) {
        await initializeOptimizer();
        if (!isInitialized) return originalMethods.getActiveConversationCount();
      }

      try {
        return await optimizer.getConversationCount();
      } catch (error) {
        logger.error({ error }, 'Error in optimized getActiveConversationCount');

        // Fall back to original implementation
        try {
          return await originalMethods.getActiveConversationCount();
        } catch (fallbackError) {
          logger.error(
            { error: fallbackError },
            'Fallback to original getActiveConversationCount also failed'
          );
          return 0;
        }
      }
    };

    // Override loadConversationsFromStorage - make it a no-op since optimizer handles this
    originalConvManager.loadConversationsFromStorage = async function () {
      if (!isInitialized) {
        await initializeOptimizer();
        if (!isInitialized) return originalMethods.loadConversationsFromStorage();
      }

      try {
        await optimizer.init(true); // Force reload
        return true;
      } catch (error) {
        logger.error({ error }, 'Error in optimized loadConversationsFromStorage');

        // Fall back to original implementation
        try {
          return await originalMethods.loadConversationsFromStorage();
        } catch (fallbackError) {
          logger.error(
            { error: fallbackError },
            'Fallback to original loadConversationsFromStorage also failed'
          );
          return false;
        }
      }
    };

    // Override saveConversationsToStorage - handled by optimizer's auto-save
    originalConvManager.saveConversationsToStorage = async function () {
      // No-op - optimizer handles periodic saving
      return true;
    };

    // Override getConversationStorageStatus
    originalConvManager.getConversationStorageStatus = async function () {
      if (!isInitialized) {
        await initializeOptimizer();
        if (!isInitialized) return originalMethods.getConversationStorageStatus();
      }

      try {
        const status = await optimizer.getStatus();
        return {
          activeConversations: status.activeConversations,
          fileSize: status.fileSize,
          fileSizeMB: status.fileSizeMB,
          lastSave: status.lastUpdated,
          loadTime: status.loadTimeMs + 'ms',
          optimized: true,
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
          error: error.message,
        };
      }
    };

    // Start initialization asynchronously but don't wait for it
    initializeOptimizer().catch(err => {
      logger.error({ error: err }, 'Async initialization of conversation optimizer failed');
    });

    logger.info('Successfully applied conversation optimization patches');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to apply conversation optimization patches');
    return false;
  }
}

/**
 * Clean up resources when the application is shutting down
 */
async function shutdown() {
  if (!isInitialized) {
    return true;
  }

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
  shutdown,
};
