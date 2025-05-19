/**
 * Message Reference Resolver
 *
 * This module provides utilities for resolving message references (replies)
 * and building context from reply chains.
 *
 * @module MessageReferenceResolver
 * @author Cascade
 * @version 1.0.0
 */

const { createLogger } = require('../logger');
const logger = createLogger('references');

// Get config values from the validator
const config = require('../configValidator');

// Configuration constants from environment or defaults
const MAX_REFERENCE_DEPTH = config.MAX_REFERENCE_DEPTH;

// Check if the feature is enabled (used within the module)
const ENABLE_REPLY_CONTEXT = config.ENABLE_REPLY_CONTEXT;

// Skip processing if the feature is disabled
if (!ENABLE_REPLY_CONTEXT) {
  logger.info('Reply context feature is disabled via configuration');
}

/**
 * Cache for resolved message references to avoid redundant fetches
 * @type {Map<string, Object>}
 */
const referenceCache = new Map();

/**
 * Clear the reference cache
 *
 * @returns {void}
 */
function clearReferenceCache() {
  referenceCache.clear();
  logger.debug('Reference cache cleared');
}

/**
 * Resolve a message reference
 *
 * @param {import('discord.js').Message} message - The message with the reference
 * @returns {Promise<import('discord.js').Message|null>} - The referenced message or null
 */
async function resolveReference(message) {
  // Extensive debug logging about the message we're trying to resolve
  logger.debug(
    {
      functionCall: 'resolveReference',
      hasMessage: !!message,
      hasReference: !!message?.reference,
      referenceDetails: message?.reference
        ? {
            messageId: message.reference.messageId,
            channelId: message.reference.channelId,
            guildId: message.reference.guildId,
          }
        : 'No reference object',
    },
    'Attempting to resolve message reference'
  );

  if (!message?.reference?.messageId) {
    logger.debug('Message has no reference ID, returning null');
    return null;
  }

  const referenceId = message.reference.messageId;
  logger.debug({ referenceId }, 'Resolving reference for message');

  // Check cache first
  if (referenceCache.has(referenceId)) {
    logger.debug({ referenceId, fromCache: true }, 'Found referenced message in cache');
    return referenceCache.get(referenceId);
  }

  try {
    logger.debug(
      { referenceId, channel: message.channel?.id },
      'Fetching referenced message from Discord API'
    );
    // Fetch the referenced message from Discord
    const channel = message.channel;
    const referencedMessage = await channel.messages.fetch(referenceId);

    // Log details about the fetched message
    logger.debug(
      {
        referenceId,
        fetchSuccess: !!referencedMessage,
        referencedContent: referencedMessage?.content?.substring(0, 100), // First 100 chars only
        referencedAuthor: referencedMessage?.author?.username,
        referencedTimestamp: referencedMessage?.createdTimestamp,
      },
      'Successfully fetched referenced message'
    );

    // Cache the result
    referenceCache.set(referenceId, referencedMessage);

    return referencedMessage;
  } catch (error) {
    logger.error(
      { error, messageId: message.reference.messageId },
      'Failed to resolve message reference'
    );
    return null;
  }
}

/**
 * Resolve a chain of message references up to a maximum depth
 *
 * @param {import('discord.js').Message} message - The starting message
 * @param {number} [maxDepth=MAX_REFERENCE_DEPTH] - Maximum depth to resolve
 * @returns {Promise<Array<import('discord.js').Message>>} Array of resolved messages in the chain (from oldest to newest)
 */
async function resolveReferenceChain(message, maxDepth = MAX_REFERENCE_DEPTH) {
  const chain = [];
  let currentMessage = message;
  let depth = 0;

  // Track message IDs to prevent circular references
  const processedIds = new Set();

  while (currentMessage?.reference && depth < maxDepth) {
    // Prevent circular references
    if (processedIds.has(currentMessage.reference.messageId)) {
      logger.warn({ messageId: currentMessage.id }, 'Circular reference detected in message chain');
      break;
    }

    processedIds.add(currentMessage.reference.messageId);

    const referencedMessage = await resolveReference(currentMessage);
    if (!referencedMessage) break;

    chain.unshift(referencedMessage); // Add to the beginning to maintain chronological order
    currentMessage = referencedMessage;
    depth++;
  }

  logger.info(
    {
      messageId: message.id,
      chainLength: chain.length,
    },
    'Reference chain resolved'
  );

  return chain;
}

/**
 * Convert a Discord message to a conversation message format
 *
 * @param {import('discord.js').Message} message - Discord message to convert
 * @returns {Object} Conversation message in the format expected by the conversation manager
 */
function messageToConversationFormat(message) {
  // Determine the role based on whether the message is from the bot
  const role = message.author.bot ? 'assistant' : 'user';

  // Create the conversation message
  return {
    role,
    content: message.content,
    author: message.author.username,
    id: message.id,
    timestamp: message.createdTimestamp,
    isReference: true, // Mark as a referenced message
  };
}

/**
 * Extract reference context from a message
 *
 * @param {import('discord.js').Message} message - The message to extract context from
 * @param {Object} options - Options for extracting context
 * @param {number} [options.maxDepth=MAX_REFERENCE_DEPTH] - Maximum depth to follow references
 * @param {boolean} [options.includeNonBot=true] - Whether to include messages from non-bot users
 * @returns {Promise<Array<ConversationMessage>>} - Array of messages from references
 */
async function extractReferenceContext(message, options = {}) {
  const maxDepth = options.maxDepth || MAX_REFERENCE_DEPTH;
  const includeNonBot = options.includeNonBot !== false;

  // Log very detailed information about the incoming message for debugging
  logger.debug(
    {
      messageId: message.id,
      content: message.content,
      authorId: message.author?.id,
      authorUsername: message.author?.username,
      channelId: message.channel?.id,
      channelName: message.channel?.name,
      referenceInfo: message.reference
        ? {
            messageId: message.reference.messageId,
            channelId: message.reference.channelId,
            guildId: message.reference.guildId,
          }
        : 'No reference',
    },
    'Extracting reference context for message'
  );

  // If the message has no reference, return empty array
  if (!message.reference) {
    logger.debug('Message has no reference, returning empty context');
    return [];
  }

  // Resolve the reference chain
  const referenceChain = await resolveReferenceChain(message, maxDepth);

  // No references found
  if (referenceChain.length === 0) {
    return [];
  }

  // Convert messages to conversation format
  const contextMessages = referenceChain
    .filter(msg => includeNonBot || msg.author.bot) // Optionally filter non-bot messages
    .map(messageToConversationFormat);

  logger.info(
    {
      messageId: message.id,
      referencesFound: referenceChain.length,
      contextSize: contextMessages.length,
    },
    'Reference context extracted'
  );

  return contextMessages;
}

// Expose the API
module.exports = {
  resolveReference,
  resolveReferenceChain,
  extractReferenceContext,
  clearReferenceCache,
  messageToConversationFormat,
  MAX_REFERENCE_DEPTH,
};
