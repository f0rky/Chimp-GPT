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
 * @version 1.2.1
 */

const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('../core/logger');
const logger = createLogger('convOptimizer');
const config = require('../core/configValidator');

// Path to the conversations file
const CONVERSATIONS_FILE = path.join(__dirname, 'data', 'conversations.json');

// Configuration
const MAX_CONVERSATION_LENGTH = config.MAX_CONVERSATION_LENGTH || 12; // Increased from 8 to 12 to provide more context
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
let isInitializing = false;

async function init(forceReload = false) {
  // Prevent re-entrancy
  if (isInitializing) {
    return isInitialized;
  }

  if (isInitialized && !forceReload) {
    return true;
  }

  // Set initializing flag
  isInitializing = true;

  try {
    const startTime = Date.now();

    // Only log if not already initialized
    if (!isInitialized) {
      logger.info('Initializing conversation optimizer');
    } else {
      logger.info('Reinitializing conversation optimizer');
    }

    await ensureDirectory(path.dirname(CONVERSATIONS_FILE));

    // Load conversations from disk
    await loadFromDisk();

    // Clear existing timer if forcing a reload
    if (forceReload && saveTimer) {
      clearInterval(saveTimer);
      saveTimer = null;
    }

    // Start periodic saving if not already started
    if (!saveTimer) {
      saveTimer = setInterval(async () => {
        try {
          if (isDirty) {
            await saveToDisk();
            isDirty = false;
          }
        } catch (error) {
          logger.error({ error }, 'Error in save interval');
        }
      }, SAVE_INTERVAL_MS);

      // Ensure the timer doesn't keep the process alive
      saveTimer.unref();
    }

    // Run initial cleanup
    if (!isInitialized || forceReload) {
      await pruneOldConversations();
    }

    metadataCache.loadTime = Date.now() - startTime;
    isInitialized = true;

    logger.info(
      { loadTimeMs: metadataCache.loadTime, conversationCount: conversationsCache.size },
      'Conversation optimizer initialized successfully'
    );
    return true;
  } catch (error) {
    isInitialized = false;
    logger.error({ error }, 'Failed to initialize conversation optimizer');
    return false;
  } finally {
    isInitializing = false;
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
    let effectiveMaxAgeMs = maxAgeMs;
    if (await isFileTooLarge()) {
      logger.warn(
        `Conversations file exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB, aggressive pruning`
      );
      // Reduce max age to be more aggressive with pruning
      effectiveMaxAgeMs = maxAgeMs / 2;
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
        if (now - messageTime > effectiveMaxAgeMs) {
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
 * Enhanced message structure with metadata
 * @typedef {Object} EnhancedMessage
 * @property {string} role - Message role (user, assistant, system, function)
 * @property {string} content - Message content
 * @property {string} [name] - Username or function name
 * @property {string} timestamp - ISO timestamp
 * @property {string} [messageId] - Unique message ID
 * @property {string} [inReplyTo] - Message ID this is in reply to
 * @property {Object} [metadata] - Additional metadata
 * @property {string} [metadata.type] - Message type (text, image, command, etc.)
 * @property {Object} [metadata.image] - Image generation details (if applicable)
 * @property {string} [metadata.image.prompt] - Original image prompt
 * @property {string} [metadata.image.url] - Generated image URL
 * @property {Object} [metadata.references] - Message references
 */

/**
 * Add a message to a conversation with enhanced context
 * @param {string} userId - User ID
 * @param {Object} message - Base message object
 * @param {Object} [options] - Additional options
 * @param {string} [options.username] - Username of the message sender
 * @param {string} [options.messageId] - Unique message ID
 * @param {string} [options.inReplyTo] - Message ID this is in reply to
 * @param {Object} [metadata] - Additional metadata
 * @returns {Promise<Array>} Updated conversation
 */
async function addMessage(userId, message, { username, messageId, inReplyTo, ...metadata } = {}) {
  const conversation = await getConversation(userId);
  const timestamp = new Date().toISOString();

  // Create enhanced message with metadata
  const enhancedMessage = {
    ...message,
    timestamp,
    ...(username && { name: username }),
    ...(messageId && { messageId }),
    ...(inReplyTo && { inReplyTo }),
    ...(Object.keys(metadata).length > 0 && { metadata }),
  };

  // If this is an image generation result, store the prompt in metadata
  if (message.role === 'function' && message.name === 'generate_image') {
    const imagePrompt = message.content;
    enhancedMessage.metadata = {
      ...enhancedMessage.metadata,
      type: 'image',
      image: {
        prompt: imagePrompt,
        url: message.result?.url || null,
      },
    };
  }

  // Add to conversation
  conversation.push(enhancedMessage);
  isDirty = true;

  // If exceeding length limit, remove oldest non-system and non-function messages
  while (conversation.length > MAX_CONVERSATION_LENGTH) {
    // Find oldest non-system, non-function message to remove
    let indexToRemove = -1;
    for (let i = 0; i < conversation.length; i++) {
      if (conversation[i].role !== 'system' && conversation[i].role !== 'function') {
        indexToRemove = i;
        break;
      }
    }

    // If no non-system, non-function messages found, remove the oldest message after system
    if (indexToRemove === -1 && conversation.length > 1) {
      indexToRemove = 1;
    }

    if (indexToRemove !== -1) {
      conversation.splice(indexToRemove, 1);
    } else {
      break; // Shouldn't happen, but just in case
    }
  }

  // Ensure system message is always at index 0
  if (conversation[0].role !== 'system') {
    const systemMessage = conversation.find(m => m.role === 'system') || {
      role: 'system',
      content: config.BOT_PERSONALITY,
    };
    conversation.unshift(systemMessage);

    // Remove duplicate system messages
    for (let i = conversation.length - 1; i > 0; i--) {
      if (conversation[i].role === 'system') {
        conversation.splice(i, 1);
      }
    }
  }

  logger.debug(
    {
      userId,
      messageId,
      role: message.role,
      contentLength: message.content?.length || 0,
      hasMetadata: !!enhancedMessage.metadata,
    },
    'Added message to conversation'
  );

  return conversation;
}

/**
 * Get image context for a user
 * @param {string} userId - User ID
 * @param {number} [maxImages=3] - Maximum number of recent images to return
 * @returns {Promise<Array>} Array of recent image contexts
 */
async function getImageContext(userId, maxImages = 3) {
  const conversation = await getConversation(userId, false);
  if (!conversation) return [];

  return conversation
    .filter(msg => msg.metadata?.type === 'image' && msg.metadata?.image?.prompt)
    .slice(-maxImages)
    .map(msg => ({
      prompt: msg.metadata.image.prompt,
      url: msg.metadata.image.url,
      timestamp: msg.timestamp,
    }));
}

/**
 * Get message context for a specific message
 * @param {string} userId - User ID
 * @param {string} messageId - Message ID to get context for
 * @param {number} [contextWindow=3] - Number of messages to include as context
 * @returns {Promise<Array>} Array of messages with context
 */
async function getMessageContext(userId, messageId, contextWindow = 3) {
  const conversation = await getConversation(userId, false);
  if (!conversation) return [];

  const messageIndex = conversation.findIndex(msg => msg.messageId === messageId);
  if (messageIndex === -1) return [];

  const startIndex = Math.max(0, messageIndex - contextWindow);
  return conversation.slice(startIndex, messageIndex + 1);
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

  // If conversation is small enough, return as is
  if (conversation.length <= MAX_CONVERSATION_LENGTH) {
    return conversation;
  }

  // Keep all function-related messages (both requests and results)
  const functionMessages = conversation.filter(msg => msg.role === 'function' || msg.function_call);

  // Get the most recent non-function messages (up to 3/4 of MAX_CONVERSATION_LENGTH)
  const recentNonFunctionMessages = conversation
    .filter(msg => msg.role !== 'system' && msg.role !== 'function' && !msg.function_call)
    .slice(-Math.floor((MAX_CONVERSATION_LENGTH * 3) / 4));

  // Combine system message, function messages, and recent non-function messages
  const optimized = [systemMessage, ...functionMessages, ...recentNonFunctionMessages];

  // If we still have too many messages, trim from the middle while keeping the most recent
  if (optimized.length > MAX_CONVERSATION_LENGTH) {
    const toRemove = optimized.length - MAX_CONVERSATION_LENGTH;
    // Keep the first (system) and last (most recent) messages
    // Remove from the middle (after system message but before the most recent messages)
    optimized.splice(1, toRemove);
  }

  logger.debug(
    {
      originalLength: conversation.length,
      optimizedLength: optimized.length,
      functionMessages: functionMessages.length,
      recentNonFunctionMessages: recentNonFunctionMessages.length,
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
  // Don't proceed if already shutting down or not initialized
  if (isInitializing) {
    logger.warn('Shutdown requested while initializing');
    return;
  }

  logger.info('Shutting down conversation optimizer');

  // Clear the save timer
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }

  // Save one last time if dirty
  if (isDirty) {
    try {
      await saveToDisk();
      isDirty = false;
      logger.info('Successfully saved conversations before shutdown');
    } catch (error) {
      logger.error({ error }, 'Failed to save conversations during shutdown');
    }
  }

  // Clear caches
  conversationsCache.clear();
  isInitialized = false;

  logger.info('Conversation optimizer shut down successfully');
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
  getImageContext,
  getMessageContext,
};
