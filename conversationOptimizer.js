/**
 * Conversation Optimizer Module
 *
 * This module optimizes conversation loading and management by:
 * 1. Using an in-memory cache to reduce disk I/O
 * 2. Implementing lazy loading of conversations
 * 3. Reducing context size by trimming older messages
 * 4. Adding aggressive pruning for inactive conversations
 *
 * @module ConversationOptimizer
 * @author Cascade
 * @version 1.0.0
 */

const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('./logger');
const logger = createLogger('convOptimizer');
const config = require('./configValidator');

// Path to the conversations file
const CONVERSATIONS_FILE = path.join(__dirname, 'data', 'conversations.json');

// Configuration
const MAX_CONVERSATION_LENGTH = config.MAX_CONVERSATION_LENGTH || 8; // Maximum messages per conversation
const MAX_CONVERSATION_AGE_DAYS = 7; // Prune conversations older than 7 days
const SAVE_INTERVAL_MS = 5 * 60 * 1000; // Save every 5 minutes
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit for conversations file
const CONTEXT_REDUCTION_THRESHOLD = 4; // If over this many messages, reduce context for API calls

// In-memory cache
let conversationsCache = new Map();
const metadataCache = {
  lastUpdated: new Date().toISOString(),
  version: '1.0',
  loadTime: null,
  conversationStats: {},
};

let isDirty = false;
let isInitialized = false;
let saveTimer = null;
let isOptimizing = false;

/**
 * Initialize the optimizer
 * @param {boolean} forceReload - Force reload from disk even if already initialized
 * @returns {Promise<boolean>} Success status
 */
async function init(forceReload = false) {
  if (isInitialized && !forceReload) {
    return true;
  }

  try {
    const startTime = Date.now();
    logger.info('Initializing conversation optimizer');

    await ensureDirectory(path.dirname(CONVERSATIONS_FILE));

    // Load conversations from disk
    await loadFromDisk();

    // Start periodic saving if not already started
    if (!saveTimer) {
      saveTimer = setInterval(async () => {
        if (isDirty) {
          await saveToDisk();
          isDirty = false;
        }
      }, SAVE_INTERVAL_MS);

      // Ensure the timer doesn't keep the process alive
      saveTimer.unref();
    }

    // Run initial cleanup
    await pruneOldConversations();

    metadataCache.loadTime = Date.now() - startTime;
    isInitialized = true;

    logger.info(
      { loadTimeMs: metadataCache.loadTime, conversationCount: conversationsCache.size },
      'Conversation optimizer initialized successfully'
    );
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize conversation optimizer');
    return false;
  }
}

/**
 * Ensure a directory exists
 * @param {string} dir - Directory path
 * @returns {Promise<void>}
 */
async function ensureDirectory(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    // Ignore if directory already exists
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Load conversations from disk
 * @returns {Promise<void>}
 */
async function loadFromDisk() {
  try {
    // Check if file exists
    try {
      await fs.access(CONVERSATIONS_FILE);
    } catch (error) {
      // Create default file if it doesn't exist
      logger.info('Conversations file not found, creating default');
      await createDefaultFile();
      return;
    }

    // Read the file
    const data = await fs.readFile(CONVERSATIONS_FILE, 'utf8');

    try {
      const parsedData = JSON.parse(data);

      // Convert object to Map
      conversationsCache = new Map();

      // Check if the data has the expected structure
      if (parsedData && parsedData.conversations) {
        // Copy metadata
        if (parsedData.lastUpdated) {
          metadataCache.lastUpdated = parsedData.lastUpdated;
        }

        if (parsedData.version) {
          metadataCache.version = parsedData.version;
        }

        // Load conversations
        for (const [userId, conversation] of Object.entries(parsedData.conversations)) {
          if (Array.isArray(conversation) && conversation.length > 0) {
            conversationsCache.set(userId, conversation);
          }
        }
      } else {
        logger.warn('Invalid conversations file structure, using default');
        await createDefaultFile();
      }
    } catch (parseError) {
      logger.error({ error: parseError }, 'Failed to parse conversations file, using default');
      await createDefaultFile();
    }
  } catch (error) {
    logger.error({ error }, 'Error loading conversations from disk');
    throw error;
  }
}

/**
 * Create a default conversations file
 * @returns {Promise<void>}
 */
async function createDefaultFile() {
  conversationsCache = new Map();
  metadataCache.lastUpdated = new Date().toISOString();

  // Save the default structure
  await saveToDisk();
}

/**
 * Save conversations to disk
 * @returns {Promise<boolean>} Success status
 */
async function saveToDisk() {
  if (isOptimizing) {
    logger.debug('Skipping save while optimization is in progress');
    return true;
  }

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

    logger.info({ conversationCount: conversationsCache.size }, 'Saved conversations to disk');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to save conversations to disk');
    return false;
  }
}

/**
 * Prune old conversations
 * @param {number} [maxAgeMs] - Maximum age in milliseconds
 * @returns {Promise<number>} Number of pruned conversations
 */
async function pruneOldConversations(maxAgeMs = MAX_CONVERSATION_AGE_DAYS * 24 * 60 * 60 * 1000) {
  if (!isInitialized) {
    await init();
  }

  isOptimizing = true;
  try {
    const now = Date.now();
    let prunedCount = 0;

    // Check if file is too large
    if (await isFileTooLarge()) {
      logger.warn(
        `Conversations file exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB, aggressive pruning`
      );
      // Reduce max age to be more aggressive with pruning
      maxAgeMs = maxAgeMs / 2;
    }

    // Find and remove old conversations
    for (const [userId, conversation] of conversationsCache.entries()) {
      if (!conversation || !Array.isArray(conversation) || conversation.length === 0) {
        conversationsCache.delete(userId);
        prunedCount++;
        continue;
      }

      // Check last message timestamp
      const lastMessage = conversation[conversation.length - 1];
      if (lastMessage && lastMessage.timestamp) {
        const messageTime = new Date(lastMessage.timestamp).getTime();
        if (now - messageTime > maxAgeMs) {
          conversationsCache.delete(userId);
          prunedCount++;
        }
      }
    }

    if (prunedCount > 0) {
      isDirty = true;
      await saveToDisk();
      logger.info({ prunedCount, remaining: conversationsCache.size }, 'Pruned old conversations');
    }

    return prunedCount;
  } catch (error) {
    logger.error({ error }, 'Error pruning old conversations');
    return 0;
  } finally {
    isOptimizing = false;
  }
}

/**
 * Check if the file is too large
 * @returns {Promise<boolean>}
 */
async function isFileTooLarge() {
  try {
    const stats = await fs.stat(CONVERSATIONS_FILE);
    return stats.size > MAX_FILE_SIZE_BYTES;
  } catch (error) {
    // If file doesn't exist, it's not too large
    return false;
  }
}

/**
 * Get a conversation for a user
 * @param {string} userId - User ID
 * @param {boolean} [create=true] - Create if not exists
 * @returns {Promise<Array|null>} Conversation array or null
 */
async function getConversation(userId, create = true) {
  if (!isInitialized) {
    await init();
  }

  // If conversation exists in cache, return it
  if (conversationsCache.has(userId)) {
    return conversationsCache.get(userId);
  }

  // Create new conversation if requested
  if (create) {
    const newConversation = [{ role: 'system', content: config.BOT_PERSONALITY }];
    conversationsCache.set(userId, newConversation);
    isDirty = true;
    return newConversation;
  }

  return null;
}

/**
 * Add a message to a conversation
 * @param {string} userId - User ID
 * @param {Object} message - Message object
 * @returns {Promise<Array>} Updated conversation
 */
async function addMessage(userId, message) {
  const conversation = await getConversation(userId);

  // Add timestamp to the message for easier pruning
  const messageWithTimestamp = {
    ...message,
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
    conversation.unshift({ role: 'system', content: config.BOT_PERSONALITY });
    // Then remove the last message if we're over the limit
    if (conversation.length > MAX_CONVERSATION_LENGTH) {
      conversation.pop();
    }
  }

  return conversation;
}

/**
 * Clear a user's conversation
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
async function clearConversation(userId) {
  if (!isInitialized) {
    await init();
  }

  if (conversationsCache.has(userId)) {
    // Keep system message only
    const systemMessage = [{ role: 'system', content: config.BOT_PERSONALITY }];
    conversationsCache.set(userId, systemMessage);
    isDirty = true;
    return true;
  }

  return false;
}

/**
 * Optimize a conversation for API calls
 * This creates a smaller version of the conversation that contains enough context
 * for the AI to respond properly while reducing token usage
 *
 * @param {Array} conversation - Full conversation
 * @returns {Array} Optimized conversation
 */
function optimizeConversationForApi(conversation) {
  if (!conversation || !Array.isArray(conversation)) {
    return [{ role: 'system', content: config.BOT_PERSONALITY }];
  }

  // If conversation is small enough, return as is
  if (conversation.length <= CONTEXT_REDUCTION_THRESHOLD) {
    return conversation;
  }

  // Extract system message
  const systemMessage = conversation.find(msg => msg.role === 'system') || {
    role: 'system',
    content: config.BOT_PERSONALITY,
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
 * Get count of active conversations
 * @returns {Promise<number>}
 */
async function getConversationCount() {
  if (!isInitialized) {
    await init();
  }

  return conversationsCache.size;
}

/**
 * Get status information about the conversation storage
 * @returns {Promise<Object>} Status object
 */
async function getStatus() {
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
    loadTimeMs: metadataCache.loadTime || 0,
    version: metadataCache.version,
  };
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
  if (isDirty) {
    await saveToDisk();
  }

  logger.info('Conversation optimizer shut down');
}

module.exports = {
  init,
  getConversation,
  addMessage,
  clearConversation,
  optimizeConversationForApi,
  getConversationCount,
  getStatus,
  pruneOldConversations,
  shutdown,
};
