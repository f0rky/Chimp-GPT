/**
 * @typedef {Object} ConversationMessage
 * @property {string} role - The role of the message sender (e.g., 'system', 'user', 'assistant')
 * @property {string} content - The content of the message
 *
 * @typedef {Array<ConversationMessage>} ConversationLog
 *
 * @typedef {Object} ConversationManagerAPI
 * @property {function(string, (ConversationMessage|null)=): ConversationLog} manageConversation
 * @property {function(string): boolean} clearConversation
 * @property {function(): number} getActiveConversationCount
 * @property {Map<string, ConversationLog>} userConversations
 * @property {number} MAX_CONVERSATION_LENGTH
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

/**
 * Maximum number of messages to keep in a conversation
 * @constant {number}
 */
const MAX_CONVERSATION_LENGTH = 8;

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
 * Timer for periodic saving of conversations
 * @type {NodeJS.Timeout|null}
 */
let saveTimer = null;

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
 * Manages the conversation context for a specific user.
 *
 * Maintains a conversation history for each user, adding new messages and ensuring the conversation doesn't exceed the maximum allowed length by removing oldest messages when necessary.
 *
 * @param {string} userId - The Discord user ID
 * @param {ConversationMessage|null} [newMessage=null] - New message to add to conversation, or null to just retrieve
 * @returns {ConversationLog} The updated conversation log for the user
 */
/**
 * Loads conversations from persistent storage.
 * This should be called when the bot starts up.
 * 
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function loadConversationsFromStorage() {
  try {
    // Only load once
    if (conversationsLoaded) {
      logger.debug('Conversations already loaded, skipping');
      return true;
    }
    
    logger.info('Loading conversations from storage');
    const loadedConversations = await conversationStorage.loadConversations();
    
    // Merge loaded conversations with in-memory ones
    for (const [userId, conversation] of loadedConversations.entries()) {
      if (!userConversations.has(userId)) {
        userConversations.set(userId, conversation);
      }
    }
    
    conversationsLoaded = true;
    conversationsDirty = false;
    
    logger.info({ 
      loadedCount: loadedConversations.size,
      totalCount: userConversations.size 
    }, 'Conversations loaded from storage');
    
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

function manageConversation(userId, newMessage = null) {
  // Ensure conversations are loaded from storage
  if (!conversationsLoaded) {
    // We can't await here since this function isn't async,
    // but we'll load conversations asynchronously
    loadConversationsFromStorage().catch(error => {
      logger.error({ error }, 'Error loading conversations in manageConversation');
    });
    conversationsLoaded = true; // Mark as loaded to prevent multiple attempts
  }
  
  if (!userConversations.has(userId)) {
    userConversations.set(userId, [
      { role: 'system', content: config.BOT_PERSONALITY }
    ]);
    conversationsDirty = true;
  }

  const conversation = userConversations.get(userId);
  
  if (newMessage) {
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
  const hadConversation = userConversations.has(userId);
  if (hadConversation) {
    userConversations.delete(userId);
    conversationsDirty = true;
    logger.info({ userId }, 'Cleared conversation for user');
  }
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
  userConversations,
  MAX_CONVERSATION_LENGTH
};
