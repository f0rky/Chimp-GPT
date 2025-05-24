/**
 * Simple Conversation Optimizer
 *
 * This module provides an efficient conversation management system
 * without any dependencies on the existing conversation manager.
 *
 * @module SimpleConversationOptimizer
 * @author Cascade
 * @version 1.0.0
 */

const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('./logger');
const logger = createLogger('simpleConvOpt');

// Path to the conversations file
const CONVERSATIONS_FILE = path.join(__dirname, 'data', 'optimized-conversations.json');

// Configuration
let BOT_PERSONALITY = 'I am ChimpGPT, a helpful AI assistant.';
try {
  BOT_PERSONALITY = require('./configValidator').BOT_PERSONALITY;
} catch (error) {
  logger.warn('Could not load BOT_PERSONALITY from config, using default');
}

const MAX_CONVERSATION_LENGTH = 8; // Maximum messages per conversation
const MAX_CONVERSATION_AGE_DAYS = 7; // Prune conversations older than 7 days
const SAVE_INTERVAL_MS = 5 * 60 * 1000; // Save every 5 minutes
const CONTEXT_REDUCTION_THRESHOLD = 4; // If over this many messages, reduce context for API calls

// In-memory cache
let conversationsCache = new Map();
const metadataCache = {
  lastUpdated: new Date().toISOString(),
  version: '1.0',
};

let isDirty = false;
let isInitialized = false;
let initializationInProgress = false;
let saveTimer = null;

/**
 * Initialize the optimizer
 * @returns {Promise<boolean>} Success status
 */
async function init() {
  // Check if we're already initialized or initializing
  if (isInitialized) {
    return true;
  }

  if (initializationInProgress) {
    logger.debug('Initialization already in progress, skipping duplicate call');
    return false;
  }

  initializationInProgress = true;

  try {
    logger.debug('Starting conversation optimizer initialization');

    // Create data directory if needed
    try {
      await fs.mkdir(path.dirname(CONVERSATIONS_FILE), { recursive: true });
    } catch (err) {
      // Ignore if directory already exists
      if (err.code !== 'EEXIST') {
        logger.warn({ error: err }, 'Error creating data directory');
      }
    }

    // Check if file exists
    try {
      await fs.access(CONVERSATIONS_FILE);

      // File exists, load it
      const data = await fs.readFile(CONVERSATIONS_FILE, 'utf8');

      try {
        const parsed = JSON.parse(data);

        if (parsed && parsed.conversations) {
          // Convert conversations object to Map
          conversationsCache = new Map();

          for (const [userId, conversation] of Object.entries(parsed.conversations)) {
            if (Array.isArray(conversation) && conversation.length > 0) {
              conversationsCache.set(userId, conversation);
            }
          }

          if (parsed.lastUpdated) {
            metadataCache.lastUpdated = parsed.lastUpdated;
          }
        }
      } catch (parseError) {
        logger.warn({ error: parseError }, 'Error parsing conversations file, using empty state');
      }
    } catch (accessError) {
      // File doesn't exist, use empty state
      logger.info('Conversations file does not exist, using empty state');
    }

    // Start periodic saving
    if (!saveTimer) {
      saveTimer = setInterval(async () => {
        if (isDirty) {
          await saveToDisk();
          isDirty = false;
        }
      }, SAVE_INTERVAL_MS);

      // Don't let this timer prevent the process from exiting
      saveTimer.unref();
    }

    isInitialized = true;
    initializationInProgress = false;

    logger.info(
      {
        conversationCount: conversationsCache.size,
      },
      'Conversation optimizer initialized successfully'
    );

    return true;
  } catch (error) {
    logger.error({ error }, 'Error initializing conversation optimizer');
    initializationInProgress = false;
    return false;
  }
}

/**
 * Save conversations to disk
 * @returns {Promise<boolean>} Success status
 */
async function saveToDisk() {
  try {
    // Update metadata
    metadataCache.lastUpdated = new Date().toISOString();

    // Convert Map to object for JSON serialization
    const conversationsObj = {};
    for (const [userId, conversation] of conversationsCache.entries()) {
      conversationsObj[userId] = conversation;
    }

    // Create data structure
    const data = {
      conversations: conversationsObj,
      lastUpdated: metadataCache.lastUpdated,
      version: metadataCache.version,
    };

    // Use atomic write pattern
    const tempFile = `${CONVERSATIONS_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
    await fs.rename(tempFile, CONVERSATIONS_FILE);

    logger.debug({ conversationCount: conversationsCache.size }, 'Saved conversations to disk');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to save conversations to disk');
    return false;
  }
}

/**
 * Manage a conversation - the main interface for using this module
 * @param {string} userId - User ID
 * @param {Object} newMessage - New message to add (optional)
 * @returns {Promise<Array>} Conversation for the user
 */
async function manageConversation(userId, newMessage = null) {
  // Make sure we're initialized
  if (!isInitialized) {
    await init();
  }

  // Get or create conversation for user
  if (!conversationsCache.has(userId)) {
    conversationsCache.set(userId, [{ role: 'system', content: BOT_PERSONALITY }]);
    isDirty = true;
  }

  const conversation = conversationsCache.get(userId);

  // Add the new message if provided
  if (newMessage) {
    // Add timestamp to the message for easier pruning
    const messageWithTimestamp = {
      ...newMessage,
      timestamp: new Date().toISOString(),
    };

    conversation.push(messageWithTimestamp);
    isDirty = true;

    // If exceeding length limit, remove oldest non-system messages
    while (conversation.length > MAX_CONVERSATION_LENGTH) {
      // Find oldest non-system message to remove (keep system message)
      let indexToRemove = 1; // Default to second message (first non-system)
      for (let i = 1; i < conversation.length; i++) {
        if (conversation[i].role !== 'system') {
          indexToRemove = i;
          break;
        }
      }
      conversation.splice(indexToRemove, 1);
    }

    // Ensure system message is always at index 0
    if (conversation[0].role !== 'system') {
      conversation.unshift({ role: 'system', content: BOT_PERSONALITY });
      // Then remove the last message if we're over the limit
      if (conversation.length > MAX_CONVERSATION_LENGTH) {
        conversation.pop();
      }
    }
  }

  // Return optimized conversation
  return optimizeConversationForApi(conversation);
}

/**
 * Optimize a conversation for API calls
 * This creates a smaller version of the conversation with enough context
 * @param {Array} conversation - Full conversation
 * @returns {Array} Optimized conversation
 */
function optimizeConversationForApi(conversation) {
  if (!conversation || !Array.isArray(conversation)) {
    return [{ role: 'system', content: BOT_PERSONALITY }];
  }

  // If conversation is small enough, return as is
  if (conversation.length <= CONTEXT_REDUCTION_THRESHOLD) {
    return conversation;
  }

  // Extract system message
  const systemMessage = conversation.find(msg => msg.role === 'system') || {
    role: 'system',
    content: BOT_PERSONALITY,
  };

  // Get the most recent messages (half of MAX_CONVERSATION_LENGTH)
  const recentMessages = conversation
    .filter(msg => msg.role !== 'system')
    .slice(-Math.floor(MAX_CONVERSATION_LENGTH / 2));

  // Build optimized conversation with system message first
  const optimized = [systemMessage, ...recentMessages];

  logger.debug(
    {
      originalLength: conversation.length,
      optimizedLength: optimized.length,
    },
    'Optimized conversation for API'
  );

  return optimized;
}

/**
 * Clear a user's conversation from both memory and disk
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
async function clearConversation(userId) {
  logger.debug({ userId }, 'clearConversation called');

  try {
    // Make sure we're initialized
    if (!isInitialized) {
      logger.debug('Initializing before clearing conversation');
      await init();
    }

    logger.debug(
      { cacheSize: conversationsCache.size, hasUser: conversationsCache.has(userId) },
      'Current cache state'
    );

    const hadConversation = conversationsCache.has(userId);
    if (hadConversation) {
      logger.debug(
        { userId, conversation: conversationsCache.get(userId) },
        'Found conversation to clear'
      );

      // Completely remove the conversation from the cache
      conversationsCache.delete(userId);
      isDirty = true;

      logger.debug('Conversation deleted from cache, saving to disk...');

      // Force save to disk to persist the removal
      try {
        await saveToDisk();
        logger.info({ userId }, 'Successfully cleared and saved conversation');

        // Verify the conversation was actually removed
        if (conversationsCache.has(userId)) {
          logger.error({ userId }, 'Conversation still exists in cache after deletion!');
        } else {
          logger.debug({ userId }, 'Verified conversation removed from cache');
        }
      } catch (error) {
        logger.error({ error, userId }, 'Failed to save after clearing conversation');
        throw error; // Re-throw to be handled by the caller
      }
    } else {
      logger.warn({ userId }, 'No conversation found to clear');
    }

    return hadConversation;
  } catch (error) {
    logger.error({ error, userId }, 'Unexpected error in clearConversation');
    throw error; // Re-throw to be handled by the caller
  }
}

/**
 * Get count of active conversations
 * @returns {Promise<number>}
 */
async function getConversationCount() {
  // Make sure we're initialized
  if (!isInitialized) {
    await init();
  }

  return conversationsCache.size;
}

/**
 * Shutdown the optimizer
 * @returns {Promise<void>}
 */
async function shutdown() {
  // Clear the save timer
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }

  // Save one last time if dirty
  if (isDirty && isInitialized) {
    await saveToDisk();
  }

  logger.info('Conversation optimizer shut down');
}

// Simple method to get conversation status
async function getStatus() {
  // Make sure we're initialized
  if (!isInitialized) {
    await init();
  }

  let fileSize = 0;
  try {
    const stats = await fs.stat(CONVERSATIONS_FILE);
    fileSize = stats.size;
  } catch (error) {
    // Ignore file access errors
  }

  return {
    activeConversations: conversationsCache.size,
    fileSize: fileSize,
    fileSizeMB: (fileSize / (1024 * 1024)).toFixed(2),
    lastUpdated: metadataCache.lastUpdated,
    isDirty: isDirty,
    version: metadataCache.version,
  };
}

module.exports = {
  init,
  manageConversation,
  clearConversation,
  getConversationCount,
  getStatus,
  shutdown,
};
