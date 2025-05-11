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
 * @module ConversationManager
 * @author Brett
 * @version 1.0.0
 */

const config = require('./configValidator');

/**
 * Maximum number of messages to keep in a conversation
 * @constant {number}
 */
const MAX_CONVERSATION_LENGTH = 8;

/**
 * Map to store conversation logs by user ID
 * @type {Map<string, Array<Object>>}
 */
const userConversations = new Map();

/**
 * Manages the conversation context for a specific user.
 *
 * Maintains a conversation history for each user, adding new messages and ensuring the conversation doesn't exceed the maximum allowed length by removing oldest messages when necessary.
 *
 * @param {string} userId - The Discord user ID
 * @param {ConversationMessage|null} [newMessage=null] - New message to add to conversation, or null to just retrieve
 * @returns {ConversationLog} The updated conversation log for the user
 */
function manageConversation(userId, newMessage = null) {
  if (!userConversations.has(userId)) {
    userConversations.set(userId, [
      { role: 'system', content: config.BOT_PERSONALITY }
    ]);
  }

  const conversation = userConversations.get(userId);
  
  if (newMessage) {
    conversation.push(newMessage);
    
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
  userConversations.delete(userId);
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
  userConversations,
  MAX_CONVERSATION_LENGTH
};
