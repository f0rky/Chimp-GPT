const { discord: discordLogger } = require('../core/logger');

// Track relationships between user messages and bot responses
// Map: userMessageId -> { botMessage, userInfo, context }
const messageRelationships = new Map();

/**
 * Store relationship between user message and bot response for context preservation
 *
 * This function maintains a mapping between user messages and bot responses
 * to provide context for future interactions. It includes automatic cleanup
 * to prevent memory leaks.
 *
 * @param {Object} originalMessage - The original user message
 * @param {Object} feedbackMessage - The bot's response message
 * @param {string} contextType - Type of context (image, weather, time, etc.)
 * @param {string} contextContent - The content or context description
 */
function storeMessageRelationship(originalMessage, feedbackMessage, contextType, contextContent) {
  if (!originalMessage || !feedbackMessage) return;

  messageRelationships.set(originalMessage.id, {
    botMessage: feedbackMessage,
    userInfo: {
      username: originalMessage.author.username,
      displayName: originalMessage.author.displayName || originalMessage.author.username,
      id: originalMessage.author.id,
    },
    context: {
      type: contextType,
      content: contextContent || originalMessage.content || 'No content',
    },
    timestamp: Date.now(), // Add timestamp for cleanup
  });

  // Performance optimization: prevent memory leaks by limiting map size
  const MAX_RELATIONSHIPS = 1000;
  if (messageRelationships.size > MAX_RELATIONSHIPS) {
    // Remove oldest 100 entries when limit is reached
    const entries = Array.from(messageRelationships.entries());
    entries.sort(([, a], [, b]) => (a.timestamp || 0) - (b.timestamp || 0));

    for (let i = 0; i < 100 && messageRelationships.size > MAX_RELATIONSHIPS - 100; i++) {
      messageRelationships.delete(entries[i][0]);
    }

    discordLogger.debug(
      {
        removedCount: 100,
        remainingCount: messageRelationships.size,
      },
      'Cleaned up old message relationships to prevent memory leaks'
    );
  }
}

/**
 * Get the relationship data for a specific message ID
 * @param {string} messageId - The message ID to look up
 * @returns {Object|undefined} The relationship data or undefined if not found
 */
function getMessageRelationship(messageId) {
  return messageRelationships.get(messageId);
}

/**
 * Remove a specific message relationship
 * @param {string} messageId - The message ID to remove
 * @returns {boolean} True if the relationship was found and removed
 */
function removeMessageRelationship(messageId) {
  return messageRelationships.delete(messageId);
}

/**
 * Get the current size of the message relationships map
 * @returns {number} The number of stored relationships
 */
function getRelationshipsCount() {
  return messageRelationships.size;
}

/**
 * Clear all message relationships (mainly for testing)
 */
function clearAllRelationships() {
  messageRelationships.clear();
}

module.exports = {
  storeMessageRelationship,
  getMessageRelationship,
  removeMessageRelationship,
  getRelationshipsCount,
  clearAllRelationships,
  // Export the map itself for direct access if needed
  messageRelationships,
};
