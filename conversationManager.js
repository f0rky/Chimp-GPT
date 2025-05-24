/**
 * @typedef {Object} ConversationMessage
 * @property {string} role - The role of the message sender (e.g., 'system', 'user', 'assistant')
 * @property {string} content - The content of the message
 * @property {string} [author] - The author's username (optional, for reference messages)
 * @property {string} [id] - The message ID (optional, for reference messages)
 * @property {number} [timestamp] - The message timestamp (optional, for reference messages)
 * @property {boolean} [isReference] - Whether this message is from a reference (optional)
 *
 * @typedef {Array<ConversationMessage>} ConversationLog
 *
 * @typedef {Object} ConversationManagerAPI
 * @property {function(string, (ConversationMessage|null)=, import('discord.js').Message=): Promise<ConversationLog>} manageConversation
 * @property {function(string): boolean} clearConversation
 * @property {function(): number} getActiveConversationCount
 * @property {function(string, Array<ConversationMessage>): void} addReferenceContext
 * @property {Map<string, ConversationLog>} userConversations
 * @property {number} MAX_CONVERSATION_LENGTH
 * @property {number} MAX_REFERENCE_CONTEXT
 */
/**
 * Conversation Manager Module
 *
 * This module manages conversation context for users interacting with the bot.
 * It maintains a conversation history for each user, adding new messages and
 * ensuring the conversation doesn't exceed the maximum allowed length.
 *
 * It also provides persistent storage for conversations across bot restarts.
 *
 * @module ConversationManager
 * @author Brett
 * @version 1.1.0
 */

const config = require('./configValidator');
const { createLogger } = require('./logger');
const logger = createLogger('conversationManager');
const conversationStorage = require('./conversationStorage');
const referenceResolver = require('./utils/messageReferenceResolver');
const { sanitizeMessage, validateMessage } = require('./utils/messageSanitizer');

/**
 * Maximum number of messages to keep in a conversation
 * @constant {number}
 */
const MAX_CONVERSATION_LENGTH = config.MAX_CONVERSATION_LENGTH;

/**
 * Maximum number of reference messages to include as context
 * @constant {number}
 */
const MAX_REFERENCE_CONTEXT = config.MAX_REFERENCE_CONTEXT;

/**
 * Interval for saving conversations to disk (in milliseconds)
 * @constant {number}
 */
const SAVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Map to store conversation logs by user ID
 * @type {Map<string, Array<Object>>}
 */
const userConversations = new Map();

/**
 * Flag to track if conversations have been loaded from storage
 * @type {boolean}
 */
let conversationsLoaded = false;

/**
 * Flag to track if conversations have been modified since last save
 * @type {boolean}
 */
let conversationsDirty = false;

/**
 * Timer for periodic saving of conversations
 * @type {NodeJS.Timeout|null}
 */
let saveTimer = null;

// Immediately load conversations when the module is required
(async () => {
  try {
    await loadConversationsFromStorage();
    conversationsLoaded = true;
    logger.info('Conversations loaded from storage on startup');
  } catch (error) {
    logger.error({ error }, 'Failed to load conversations on startup');
  }

  // Start periodic saving
  startPeriodicSaving();
})();

/**
 * Timestamp of the last successful save
 * @type {number|null}
 */
let lastSaveTime = null;



/**
 * Loads conversations from persistent storage.
 * This should be called when the bot starts up.
 *
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function loadConversationsFromStorage() {
  try {
    // Force reload if explicitly called
    if (conversationsLoaded) {
      logger.debug('Conversations already loaded, but reloading on explicit call');
    }

    logger.info('Loading conversations from storage');
    const loadedConversations = await conversationStorage.loadConversations();

    // Prune old conversations (default: keep conversations from last 7 days)
    const MAX_CONVERSATION_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    logger.info('Pruning old conversations');
    const prunedConversations = await conversationStorage.pruneOldConversations(
      loadedConversations,
      MAX_CONVERSATION_AGE_MS
    );

    // Log pruning results
    logger.info(
      {
        originalCount: loadedConversations.size,
        prunedCount: prunedConversations.size,
        removedCount: loadedConversations.size - prunedConversations.size,
      },
      'Pruned old conversations'
    );

    // Replace in-memory conversations with loaded ones
    // First, clear existing conversations
    userConversations.clear();

    // Then add all pruned conversations
    for (const [userId, conversation] of prunedConversations.entries()) {
      userConversations.set(userId, conversation);
    }

    conversationsLoaded = true;
    conversationsDirty = false; // We just loaded, so not dirty yet

    logger.info(
      {
        loadedCount: prunedConversations.size,
        totalCount: userConversations.size,
      },
      'Conversations loaded from storage'
    );

    return true;
  } catch (error) {
    logger.error({ error }, 'Error loading conversations from storage');
    return false;
  }
}

/**
 * Saves conversations to persistent storage.
 * This should be called periodically and before the bot shuts down.
 *
 * @param {boolean} [force=false] - Whether to force save even if not dirty
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function saveConversationsToStorage(force = false) {
  try {
    // Only save if there are changes or forced
    if (!conversationsDirty && !force) {
      logger.debug('No changes to conversations, skipping save');
      return true;
    }

    logger.info({ conversationCount: userConversations.size }, 'Saving conversations to storage');
    await conversationStorage.saveConversations(userConversations);

    conversationsDirty = false;
    lastSaveTime = Date.now();

    logger.debug(
      { lastSaveTime: new Date(lastSaveTime).toISOString() },
      'Updated last save timestamp'
    );

    return true;
  } catch (error) {
    logger.error({ error }, 'Error saving conversations to storage');
    return false;
  }
}

/**
 * Starts the periodic saving of conversations.
 *
 * @returns {void}
 */
function startPeriodicSaving() {
  // Clear any existing timer
  if (saveTimer) {
    clearInterval(saveTimer);
  }

  // Set up new timer
  saveTimer = setInterval(async () => {
    await saveConversationsToStorage();
  }, SAVE_INTERVAL_MS);

  logger.info({ intervalMs: SAVE_INTERVAL_MS }, 'Started periodic conversation saving');
}

/**
 * Stops the periodic saving of conversations.
 *
 * @returns {void}
 */
function stopPeriodicSaving() {
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
    logger.info('Stopped periodic conversation saving');
  }
}

/**
 * Add reference context to a user's conversation
 *
 * @param {string} userId - The Discord user ID
 * @param {Array<ConversationMessage>} referenceMessages - Array of messages from references
 * @returns {void}
 */
function addReferenceContext(userId, referenceMessages) {
  if (!referenceMessages || referenceMessages.length === 0) {
    return;
  }

  // Ensure the user has a conversation
  if (!userConversations.has(userId)) {
    userConversations.set(userId, [{ role: 'system', content: config.BOT_PERSONALITY }]);
    conversationsDirty = true;
  }

  const conversation = userConversations.get(userId);

  // Limit the number of reference messages to add
  const messagesToAdd = referenceMessages.slice(0, MAX_REFERENCE_CONTEXT);

  // Add reference messages to the conversation
  for (const refMsg of messagesToAdd) {
    // Skip if we've already added this reference message
    if (conversation.find((msg) => msg.id === refMsg.id)) {
      continue;
    }

    // Sanitize the reference message content
    if (refMsg.content) {
      refMsg.content = sanitizeMessage(refMsg.content, { stripNewlines: false, trim: true });
    }

    // Add the reference message
    conversation.push(refMsg);
    conversationsDirty = true;
  }

  // If we exceed the maximum length, remove oldest non-system, non-reference messages
  // This ensures we keep the most recent context
  while (conversation.length > MAX_CONVERSATION_LENGTH) {
    // Find the oldest non-system, non-reference message to remove
    let indexToRemove = -1;
    for (let i = 1; i < conversation.length; i++) {
      // Start at 1 to skip system message
      if (!conversation[i].isReference) {
        indexToRemove = i;
        break;
      }
    }

    // If we didn't find a non-reference message, remove the oldest reference
    if (indexToRemove === -1) {
      indexToRemove = 1; // Remove the oldest reference message
    }

    // Remove the identified message
    conversation.splice(indexToRemove, 1);
  }

  logger.info(
    {
      userId,
      referencesAdded: messagesToAdd.length,
      totalConversationLength: conversation.length,
    },
    'Added reference context to conversation'
  );
}

/**
 * Manage a user's conversation, optionally adding a new message and reference context
 *
 * @param {string} userId - The Discord user ID
 * @param {ConversationMessage|null} newMessage - New message to add (optional)
 * @param {import('discord.js').Message} discordMessage - Original Discord message with potential references
 * @returns {Promise<ConversationLog>} The updated conversation log
 */
async function manageConversation(userId, newMessage = null, discordMessage = null) {
  // Ensure conversations are loaded from storage
  if (!conversationsLoaded) {
    try {
      await loadConversationsFromStorage();
    } catch (error) {
      logger.error({ error }, 'Error loading conversations in manageConversation');
    }
    conversationsLoaded = true; // Mark as loaded to prevent multiple attempts
  }

  if (!userConversations.has(userId)) {
    userConversations.set(userId, [{ role: 'system', content: config.BOT_PERSONALITY }]);
    conversationsDirty = true;
  }

  const conversation = userConversations.get(userId);

  // Process message references if this is a message from Discord and the feature is enabled
  if (config.ENABLE_REPLY_CONTEXT && discordMessage?.reference) {
    try {
      logger.debug({ userId, messageId: discordMessage.id }, 'Processing message references');

      // Extract reference context
      const referenceContext = await referenceResolver.extractReferenceContext(discordMessage, {
        maxDepth: MAX_REFERENCE_CONTEXT,
        includeNonBot: true, // Include messages from all users
      });

      // Add references to the conversation
      if (referenceContext.length > 0) {
        logger.info(
          {
            userId,
            messageId: discordMessage.id,
            referenceCount: referenceContext.length,
          },
          'Adding reference context to conversation'
        );

        addReferenceContext(userId, referenceContext);
      }
    } catch (error) {
      logger.error(
        { error, userId, messageId: discordMessage.id },
        'Error processing message references'
      );
    }
  } else if (discordMessage?.reference && !config.ENABLE_REPLY_CONTEXT) {
    logger.debug('Reply context feature is disabled, skipping reference processing');
  }

  // Add the new message if provided
  if (newMessage) {
    // Sanitize and validate the message content
    if (newMessage.content) {
      const validation = validateMessage(newMessage.content);
      if (!validation.valid) {
        logger.warn(
          { userId, validationError: validation.reason, contentPreview: String(newMessage.content).substring(0, 50) + '...' },
          'Message validation failed'
        );
        // Instead of failing, we'll sanitize the message and continue
        newMessage.content = sanitizeMessage(newMessage.content, { stripNewlines: false, trim: true });
      } else {
        // Still sanitize even if validation passed (defense in depth)
        newMessage.content = sanitizeMessage(newMessage.content, { stripNewlines: false, trim: true });
      }
    }

    conversation.push(newMessage);
    conversationsDirty = true;

    // If we exceed the maximum length, remove oldest non-system messages
    while (conversation.length > MAX_CONVERSATION_LENGTH) {
      // Always keep the system message at index 0
      if (conversation.length > 1) {
        conversation.splice(1, 1); // Remove the second message (oldest non-system)
      } else {
        break; // Should never happen, but just in case
      }
    }

    // Ensure system message is always preserved at index 0
    if (conversation[0].role !== 'system') {
      // If system message was somehow removed, add it back
      conversation.unshift({ role: 'system', content: config.BOT_PERSONALITY });
      // Then remove the last message if we're over the limit
      if (conversation.length > MAX_CONVERSATION_LENGTH) {
        conversation.pop();
      }
    }
  }

  return conversation;
}

/**
 * Clears the conversation history for a specific user.
 *
 * @param {string} userId - The Discord user ID
 * @returns {boolean} True if a conversation was cleared, false if none existed
 */
function clearConversation(userId) {
  logger.debug('clearConversation called', { 
    userId, 
    hasConversation: userConversations.has(userId),
    userConversationsSize: userConversations.size,
    userConversationsKeys: Array.from(userConversations.keys())
  });
  
  const hadConversation = userConversations.has(userId);
  if (hadConversation) {
    userConversations.delete(userId);
    conversationsDirty = true;
    logger.info({ userId }, 'Cleared conversation for user');
  } else {
    logger.debug({ userId }, 'No conversation found to clear for user');
  }
  
  logger.debug('After clear attempt', { 
    hasConversation: userConversations.has(userId),
    userConversationsSize: userConversations.size,
    conversationsDirty
  });
  
  return hadConversation;
}

/**
 * Gets the current number of active conversations.
 *
 * @returns {number} The number of active conversations
 */
function getActiveConversationCount() {
  return userConversations.size;
}

/**
 * Gets the status of the conversation storage system.
 *
 * @returns {Object} Status object with information about the conversation storage
 */
function getConversationStorageStatus() {
  return {
    activeConversations: userConversations.size,
    loaded: conversationsLoaded,
    dirty: conversationsDirty,
    saveIntervalMs: SAVE_INTERVAL_MS,
    maxConversationLength: MAX_CONVERSATION_LENGTH,
    lastSaved: lastSaveTime ? new Date(lastSaveTime).toISOString() : null,
    storageFile: conversationStorage.getStorageFilePath(),
  };
}

/**
 * Conversation Manager API exports.
 *
 * @type {ConversationManagerAPI}
 */
module.exports = {
  manageConversation,
  clearConversation,
  getActiveConversationCount,
  loadConversationsFromStorage,
  saveConversationsToStorage,
  startPeriodicSaving,
  stopPeriodicSaving,
  getConversationStorageStatus,
  addReferenceContext,
  userConversations,
  MAX_CONVERSATION_LENGTH,
  MAX_REFERENCE_CONTEXT,
};
