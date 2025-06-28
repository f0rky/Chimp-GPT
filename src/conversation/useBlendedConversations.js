/**
 * Wrapper module to use blended conversation manager
 *
 * This module provides an interface that matches the existing conversation manager
 * but uses the blended conversation system underneath.
 *
 * @module UseBlendedConversations
 */

const blendedManager = require('./blendedConversationManager');
const { createLogger } = require('./logger');
const logger = createLogger('useBlendedConversations');

/**
 * Manage a conversation - wrapper for blended mode
 * @param {string} userId - The user ID
 * @param {Object|null} newMessage - New message to add
 * @param {import('discord.js').Message} discordMessage - Discord message object
 * @returns {Promise<Array<Object>>} The conversation log
 */
async function manageConversation(userId, newMessage = null, discordMessage = null) {
  try {
    // Determine if this is a DM
    const isDM = discordMessage?.channel?.isDMBased() || false;
    const channelId = isDM ? 'DM' : discordMessage?.channelId || 'unknown';
    const messageId = discordMessage?.id || null;

    // Add username to the message for context
    if (newMessage && discordMessage) {
      newMessage.username = discordMessage.author.username || discordMessage.author.tag || 'User';
    }

    // Use blended conversation manager with message ID
    const conversation = blendedManager.addMessageToBlended(
      channelId,
      userId,
      newMessage,
      isDM,
      messageId
    );

    logger.debug(
      {
        userId,
        channelId,
        isDM,
        conversationLength: conversation.length,
      },
      'Managed blended conversation'
    );

    return conversation;
  } catch (error) {
    logger.error({ error, userId }, 'Error in manageConversation wrapper');
    throw error;
  }
}

/**
 * Clear a conversation
 * @param {string} userId - The user ID or channel ID
 * @param {boolean} isDM - Whether this is a DM conversation
 * @returns {boolean} True if cleared
 */
function clearConversation(userId, isDM = false) {
  return blendedManager.clearConversation(userId, isDM);
}

/**
 * Remove a message from conversation by Discord message ID
 * @param {string} channelId - The channel ID
 * @param {string} messageId - The Discord message ID
 * @param {boolean} isDM - Whether this is a DM
 * @returns {boolean} True if message was removed
 */
function removeMessageById(channelId, messageId, isDM = false) {
  return blendedManager.removeMessageById(channelId, messageId, isDM);
}

/**
 * Update a message in conversation by Discord message ID
 * @param {string} channelId - The channel ID
 * @param {string} messageId - The Discord message ID
 * @param {string} newContent - The new content
 * @param {boolean} isDM - Whether this is a DM
 * @returns {boolean} True if message was updated
 */
function updateMessageById(channelId, messageId, newContent, isDM = false) {
  return blendedManager.updateMessageById(channelId, messageId, newContent, isDM);
}

/**
 * Get active conversation count
 * @returns {number} Total active conversations
 */
function getActiveConversationCount() {
  const counts = blendedManager.getActiveConversationCount();
  return counts.total;
}

/**
 * Get conversation storage status
 * @returns {Object} Status object
 */
function getConversationStorageStatus() {
  const status = blendedManager.getConversationStatus();
  return {
    ...status,
    mode: 'blended',
    info: 'Using blended conversation manager with per-user limits',
  };
}

/**
 * Load conversations from storage
 * @returns {Promise<boolean>} Success status
 */
async function loadConversationsFromStorage() {
  return blendedManager.loadConversationsFromStorage();
}

/**
 * Save conversations to storage
 * @returns {Promise<boolean>} Success status
 */
async function saveConversationsToStorage() {
  return blendedManager.saveConversationsToStorage();
}

/**
 * No-op for compatibility
 */
function startPeriodicSaving() {
  logger.info('Periodic saving managed by blended conversation manager');
}

/**
 * No-op for compatibility
 */
function stopPeriodicSaving() {
  logger.info('Stopping periodic saving');
}

/**
 * Shutdown function for cleanup
 */
async function shutdown() {
  logger.info('Shutting down blended conversation manager');
  await saveConversationsToStorage();
}

module.exports = {
  manageConversation,
  clearConversation,
  removeMessageById,
  updateMessageById,
  getActiveConversationCount,
  getConversationStorageStatus,
  loadConversationsFromStorage,
  saveConversationsToStorage,
  startPeriodicSaving,
  stopPeriodicSaving,
  shutdown,
  MAX_MESSAGES_PER_USER: blendedManager.MAX_MESSAGES_PER_USER,
};
