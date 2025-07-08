/**
 * Blended Conversation Manager Module
 *
 * This module manages conversations in a blended mode where messages from all users
 * in a channel are combined into a shared context, with a limit on messages per user.
 *
 * @module BlendedConversationManager
 * @author Brett
 * @version 1.0.0
 */

const config = require('../core/configValidator');
const { createLogger } = require('../core/logger');
const logger = createLogger('blendedConversationManager');
const conversationStorage = require('./conversationStorage');
const { sanitizeMessage, validateMessage } = require('../../utils/messageSanitizer');
const conversationIntelligence = require('./conversationIntelligence');

/**
 * Maximum messages to keep per user in blended mode
 * @constant {number}
 */
const MAX_MESSAGES_PER_USER = config.MAX_MESSAGES_PER_USER_BLENDED || 5;

/**
 * Maximum total messages in blended conversation
 * @constant {number}
 */
const MAX_BLENDED_CONVERSATION_LENGTH = 50;

/**
 * Map to store blended conversations by channel ID
 * Each channel has a map of user messages
 * @type {Map<string, Map<string, Array<Object>>>}
 */
const channelConversations = new Map();

/**
 * Map to store DM conversations (not blended)
 * @type {Map<string, Array<Object>>}
 */
const dmConversations = new Map();

/**
 * Get or create a channel conversation map
 * @param {string} channelId - The channel ID
 * @returns {Map<string, Array<Object>>} User messages map for the channel
 */
function getChannelConversation(channelId) {
  if (!channelConversations.has(channelId)) {
    channelConversations.set(channelId, new Map());
  }
  return channelConversations.get(channelId);
}

/**
 * Add a message to the blended conversation
 * @param {string} channelId - The channel ID (or 'DM' for direct messages)
 * @param {string} userId - The user ID
 * @param {Object} message - The message object with role and content
 * @param {boolean} isDM - Whether this is a direct message
 * @param {string} [messageId] - Optional Discord message ID for tracking
 * @returns {Array<Object>} The blended conversation array
 */
function addMessageToBlended(channelId, userId, message, isDM = false, messageId = null) {
  // Sanitize message content
  if (message.content) {
    const validation = validateMessage(message.content);
    if (!validation.valid) {
      logger.warn(
        {
          userId,
          channelId,
          validationError: validation.reason,
        },
        'Message validation failed, sanitizing'
      );
    }
    message.content = sanitizeMessage(message.content, {
      stripNewlines: false,
      trim: true,
    });
  }

  // Handle DMs separately (not blended)
  if (isDM) {
    if (!dmConversations.has(userId)) {
      dmConversations.set(userId, [{ role: 'system', content: config.BOT_PERSONALITY }]);
    }
    const dmConvo = dmConversations.get(userId);
    dmConvo.push(message);

    // Limit DM conversation length
    while (dmConvo.length > MAX_BLENDED_CONVERSATION_LENGTH) {
      if (dmConvo[1]) {
        // Keep system message
        dmConvo.splice(1, 1);
      }
    }

    return dmConvo;
  }

  // Get channel conversation map
  const channelConvo = getChannelConversation(channelId);

  // Get or create user's message array
  if (!channelConvo.has(userId)) {
    channelConvo.set(userId, []);
  }

  const userMessages = channelConvo.get(userId);

  // Add message with enhanced metadata for intelligent processing
  const messageWithMeta = {
    ...message,
    userId,
    timestamp: Date.now(),
    username: message.username || 'User',
    messageId: messageId, // Track Discord message ID if provided
    // Enhanced metadata for conversation intelligence
    relevanceScore: null, // Will be calculated when building context
    isBotDirected: null, // Will be determined by intelligence system
    conversationThread: null, // Thread grouping identifier
    temporalWeight: null, // Time-based decay factor
    semanticWeight: null, // Similarity to recent context
    replyChainDepth: message.replyChainDepth || 0, // Depth in reply chain
    isReply: message.isReply || false, // Whether this is a reply
    replyToBotMessage: message.replyToBotMessage || false, // Reply to bot specifically
    lastUserActivity: Date.now(), // Track user activity patterns
  };

  userMessages.push(messageWithMeta);

  // Limit messages per user
  while (userMessages.length > MAX_MESSAGES_PER_USER) {
    userMessages.shift();
  }

  // Build blended conversation
  return buildBlendedConversation(channelId);
}

/**
 * Build an intelligently weighted blended conversation from all users in a channel
 * @param {string} channelId - The channel ID
 * @param {Object} options - Options for context building
 * @returns {Array<Object>} The intelligently weighted blended conversation array
 */
function buildBlendedConversation(channelId, options = {}) {
  const channelConvo = getChannelConversation(channelId);
  const blended = [{ role: 'system', content: config.BOT_PERSONALITY }];

  // Collect all messages from all users
  const allMessages = [];
  for (const [_userId, userMessages] of channelConvo.entries()) {
    allMessages.push(...userMessages);
  }

  if (allMessages.length === 0) {
    logger.debug({ channelId }, 'No messages found for blended conversation');
    return blended;
  }

  // Get recent bot messages for semantic context (look for assistant role messages)
  const recentBotMessages = allMessages
    .filter(msg => msg.role === 'assistant')
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3);

  // Use simple chronological approach for reliable function calling
  // Take the most recent messages to ensure user input reaches OpenAI
  const weightedMessages = allMessages
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-10) // Last 10 messages
    .map(msg => ({
      ...msg,
      relevanceScore: msg.relevanceScore || 1.0, // Ensure all messages have high relevance
    }));

  // Analyze conversation threads for better organization
  const threadAnalysis = conversationIntelligence.analyzeConversationThreads(weightedMessages);

  // Add weighted messages to blended conversation with user identification
  for (const msg of weightedMessages) {
    // Format message to include username and relevance indicators for debugging
    let content = msg.content;
    if (msg.role === 'user') {
      content = `${msg.username}: ${content}`;

      // Add relevance indicator in debug mode
      if (process.env.ENABLE_CONVERSATION_DEBUG === 'true') {
        const relevanceIcon =
          msg.relevanceScore > 0.8
            ? '🔥'
            : msg.relevanceScore > 0.6
              ? '⭐'
              : msg.relevanceScore > 0.4
                ? '💬'
                : '💭';
        content = `${relevanceIcon} ${content}`;
      }
    }

    const formattedMessage = {
      role: msg.role,
      content: content,
      // Preserve metadata for potential future use
      metadata: {
        relevanceScore: msg.relevanceScore,
        isBotDirected: msg.relevanceMetadata?.botIntent,
        timestamp: msg.timestamp,
        userId: msg.userId,
      },
    };

    blended.push(formattedMessage);
  }

  // Ensure we don't exceed maximum conversation length (fallback safety)
  while (blended.length > MAX_BLENDED_CONVERSATION_LENGTH) {
    if (blended[1]) {
      // Keep system message, remove oldest non-system message
      blended.splice(1, 1);
    }
  }

  logger.info(
    {
      channelId,
      totalAvailableMessages: allMessages.length,
      selectedMessages: weightedMessages.length,
      finalBlendedLength: blended.length,
      userCount: channelConvo.size,
      threadsDetected: threadAnalysis.threads.length,
      avgRelevanceScore:
        weightedMessages.length > 0
          ? (
              weightedMessages.reduce((sum, msg) => sum + (msg.relevanceScore || 0), 0) /
              weightedMessages.length
            ).toFixed(3)
          : 0,
    },
    'Built intelligent blended conversation'
  );

  return blended;
}

/**
 * Clear conversation for a specific channel or user
 * @param {string} id - Channel ID or user ID (for DMs)
 * @param {boolean} isDM - Whether this is a DM conversation
 * @returns {boolean} True if cleared, false if not found
 */
function clearConversation(id, isDM = false) {
  if (isDM) {
    const existed = dmConversations.has(id);
    dmConversations.delete(id);
    return existed;
  }

  const existed = channelConversations.has(id);
  channelConversations.delete(id);
  return existed;
}

/**
 * Get active conversation count
 * @returns {Object} Count of channel and DM conversations
 */
function getActiveConversationCount() {
  return {
    channels: channelConversations.size,
    dms: dmConversations.size,
    total: channelConversations.size + dmConversations.size,
  };
}

/**
 * Save all conversations to storage
 * @returns {Promise<boolean>} Success status
 */
async function saveConversationsToStorage() {
  try {
    // Convert blended conversations to a format suitable for storage
    const conversationsToSave = new Map();

    // Save channel conversations as combined
    for (const [channelId, _userMap] of channelConversations.entries()) {
      const blended = buildBlendedConversation(channelId);
      conversationsToSave.set(`channel_${channelId}`, blended);
    }

    // Save DM conversations
    for (const [userId, messages] of dmConversations.entries()) {
      conversationsToSave.set(userId, messages);
    }

    await conversationStorage.saveConversations(conversationsToSave);
    logger.info('Saved blended conversations to storage');
    return true;
  } catch (error) {
    logger.error({ error }, 'Error saving blended conversations');
    return false;
  }
}

/**
 * Load conversations from storage
 * @returns {Promise<boolean>} Success status
 */
async function loadConversationsFromStorage() {
  try {
    const loaded = await conversationStorage.loadConversations();

    // Separate channel and DM conversations
    for (const [key, messages] of loaded.entries()) {
      if (key.startsWith('channel_')) {
        // For now, we can't properly reconstruct per-user messages from blended
        // So we'll skip loading channel conversations
        logger.debug({ key }, 'Skipping channel conversation load');
      } else {
        // This is a DM conversation
        dmConversations.set(key, messages);
      }
    }

    logger.info(
      {
        loadedDMs: dmConversations.size,
      },
      'Loaded conversations from storage'
    );

    return true;
  } catch (error) {
    logger.error({ error }, 'Error loading conversations');
    return false;
  }
}

/**
 * Get conversation status
 * @returns {Object} Status information
 */
function getConversationStatus() {
  const counts = getActiveConversationCount();

  // Calculate total messages
  let totalChannelMessages = 0;
  for (const userMap of channelConversations.values()) {
    for (const messages of userMap.values()) {
      totalChannelMessages += messages.length;
    }
  }

  let totalDMMessages = 0;
  for (const messages of dmConversations.values()) {
    totalDMMessages += messages.length;
  }

  return {
    mode: 'blended',
    maxMessagesPerUser: MAX_MESSAGES_PER_USER,
    maxBlendedLength: MAX_BLENDED_CONVERSATION_LENGTH,
    activeChannels: counts.channels,
    activeDMs: counts.dms,
    totalChannelMessages,
    totalDMMessages,
  };
}

/**
 * Remove a message from the conversation by Discord message ID
 * @param {string} channelId - The channel ID
 * @param {string} messageId - The Discord message ID to remove
 * @param {boolean} isDM - Whether this is a direct message
 * @returns {boolean} True if message was found and removed
 */
function removeMessageById(channelId, messageId, isDM = false) {
  if (!messageId) return false;

  // Handle DMs
  if (isDM) {
    // For DMs, we need to find which user's conversation contains this message
    for (const [userId, conversation] of dmConversations.entries()) {
      const index = conversation.findIndex(msg => msg.messageId === messageId);
      if (index !== -1) {
        conversation.splice(index, 1);
        logger.info(
          {
            userId,
            messageId,
            remainingMessages: conversation.length,
          },
          'Removed message from DM conversation'
        );
        return true;
      }
    }
    return false;
  }

  // Handle channel conversations
  const channelConvo = channelConversations.get(channelId);
  if (!channelConvo) return false;

  // Search through all users' messages in the channel
  for (const [userId, userMessages] of channelConvo.entries()) {
    const index = userMessages.findIndex(msg => msg.messageId === messageId);
    if (index !== -1) {
      userMessages.splice(index, 1);
      logger.info(
        {
          channelId,
          userId,
          messageId,
          remainingMessages: userMessages.length,
        },
        'Removed message from channel conversation'
      );
      return true;
    }
  }

  return false;
}

/**
 * Update a message in the conversation by Discord message ID
 * @param {string} channelId - The channel ID
 * @param {string} messageId - The Discord message ID to update
 * @param {string} newContent - The new content for the message
 * @param {boolean} isDM - Whether this is a direct message
 * @returns {boolean} True if message was found and updated
 */
function updateMessageById(channelId, messageId, newContent, isDM = false) {
  if (!messageId || !newContent) return false;

  // Sanitize the new content
  const sanitizedContent = sanitizeMessage(newContent, {
    stripNewlines: false,
    trim: true,
  });

  // Handle DMs
  if (isDM) {
    for (const [userId, conversation] of dmConversations.entries()) {
      const message = conversation.find(msg => msg.messageId === messageId);
      if (message) {
        message.content = sanitizedContent;
        message.edited = true;
        message.editedTimestamp = Date.now();
        logger.info(
          {
            userId,
            messageId,
          },
          'Updated message in DM conversation'
        );
        return true;
      }
    }
    return false;
  }

  // Handle channel conversations
  const channelConvo = channelConversations.get(channelId);
  if (!channelConvo) return false;

  // Search through all users' messages in the channel
  for (const [userId, userMessages] of channelConvo.entries()) {
    const message = userMessages.find(msg => msg.messageId === messageId);
    if (message) {
      // Update content preserving username prefix for user messages
      if (message.role === 'user' && message.username) {
        message.content = `${message.username}: ${sanitizedContent}`;
      } else {
        message.content = sanitizedContent;
      }
      message.edited = true;
      message.editedTimestamp = Date.now();
      logger.info(
        {
          channelId,
          userId,
          messageId,
        },
        'Updated message in channel conversation'
      );
      return true;
    }
  }

  return false;
}

module.exports = {
  addMessageToBlended,
  buildBlendedConversation,
  clearConversation,
  getActiveConversationCount,
  saveConversationsToStorage,
  loadConversationsFromStorage,
  getConversationStatus,
  removeMessageById,
  updateMessageById,
  MAX_MESSAGES_PER_USER,
};
