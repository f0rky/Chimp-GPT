/**
 * Context Optimizer Module
 *
 * This module provides intelligent token management and context optimization
 * for conversation systems. It handles dynamic context window sizing,
 * intelligent message pruning, and context summarization.
 *
 * @module ContextOptimizer
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../core/logger');
const logger = createLogger('contextOptimizer');

/**
 * Configuration for context optimization
 * @constant {Object}
 */
const CONFIG = {
  // Token estimation (rough approximation)
  CHARS_PER_TOKEN: 4,

  // Context limits
  DEFAULT_MAX_TOKENS: 2000,
  EMERGENCY_MAX_TOKENS: 4000,
  MIN_CONTEXT_TOKENS: 200,

  // Summarization thresholds
  SUMMARIZATION_THRESHOLD: 0.8, // When to start summarizing vs pruning
  OLD_MESSAGE_THRESHOLD_MINUTES: 30, // Messages older than this can be summarized
};

/**
 * Estimate token count for a message or text
 * @param {string|Object} text - Text content or message object
 * @returns {number} Estimated token count
 */
function estimateTokenCount(text) {
  if (!text) return 0;

  const content = typeof text === 'string' ? text : text.content || '';
  return Math.ceil(content.length / CONFIG.CHARS_PER_TOKEN);
}

/**
 * Calculate total token count for an array of messages
 * @param {Array<Object>} messages - Array of message objects
 * @returns {number} Total estimated token count
 */
function calculateTotalTokens(messages) {
  if (!Array.isArray(messages)) return 0;

  return messages.reduce((total, message) => {
    return total + estimateTokenCount(message);
  }, 0);
}

/**
 * Optimize context by intelligently pruning or summarizing messages
 * @param {Array<Object>} messages - Messages to optimize
 * @param {Object} options - Optimization options
 * @returns {Object} Optimized context with metadata
 */
function optimizeContext(messages, options = {}) {
  const {
    maxTokens = CONFIG.DEFAULT_MAX_TOKENS,
    emergencyMaxTokens = CONFIG.EMERGENCY_MAX_TOKENS,
    _minTokens = CONFIG.MIN_CONTEXT_TOKENS,
    _preserveSystemMessage = true,
    preserveRecentMessages = 3,
  } = options;

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      optimizedMessages: [],
      originalTokenCount: 0,
      finalTokenCount: 0,
      messagesRemoved: 0,
      messagesSummarized: 0,
      optimizationStrategy: 'none',
    };
  }

  const originalTokenCount = calculateTotalTokens(messages);

  // If we're already under the limit, no optimization needed
  if (originalTokenCount <= maxTokens) {
    return {
      optimizedMessages: [...messages],
      originalTokenCount,
      finalTokenCount: originalTokenCount,
      messagesRemoved: 0,
      messagesSummarized: 0,
      optimizationStrategy: 'none',
    };
  }

  let optimizedMessages = [...messages];
  let strategy = 'pruning';
  let messagesRemoved = 0;
  const messagesSummarized = 0;

  // Separate system messages and preserve them
  const systemMessages = optimizedMessages.filter(msg => msg.role === 'system');
  const nonSystemMessages = optimizedMessages.filter(msg => msg.role !== 'system');

  // Preserve the most recent messages (high priority)
  const recentMessages = nonSystemMessages.slice(-preserveRecentMessages);
  const olderMessages = nonSystemMessages.slice(0, -preserveRecentMessages);

  // Sort older messages by relevance score (if available) or timestamp
  olderMessages.sort((a, b) => {
    const scoreA = a.relevanceScore || a.metadata?.relevanceScore || 0;
    const scoreB = b.relevanceScore || b.metadata?.relevanceScore || 0;

    if (scoreA !== scoreB) {
      return scoreB - scoreA; // Higher relevance first
    }

    // If relevance is equal, prefer newer messages
    return (b.timestamp || 0) - (a.timestamp || 0);
  });

  // Strategy 1: Intelligent pruning based on relevance
  let currentTokens = calculateTotalTokens([...systemMessages, ...recentMessages]);
  const selectedOlderMessages = [];

  for (const message of olderMessages) {
    const messageTokens = estimateTokenCount(message);
    if (currentTokens + messageTokens <= maxTokens) {
      selectedOlderMessages.push(message);
      currentTokens += messageTokens;
    } else {
      messagesRemoved++;
    }
  }

  // Rebuild optimized messages in chronological order
  const allSelectedMessages = [...selectedOlderMessages, ...recentMessages];
  allSelectedMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  optimizedMessages = [...systemMessages, ...allSelectedMessages];

  const finalTokenCount = calculateTotalTokens(optimizedMessages);

  // Emergency fallback: If still too large, use more aggressive pruning
  if (finalTokenCount > emergencyMaxTokens) {
    logger.warn(
      {
        originalTokens: originalTokenCount,
        currentTokens: finalTokenCount,
        emergencyLimit: emergencyMaxTokens,
      },
      'Applying emergency context pruning'
    );

    // Keep only system messages and the most recent messages
    const emergencyMessages = [
      ...systemMessages,
      ...recentMessages.slice(-Math.floor(preserveRecentMessages / 2)),
    ];

    optimizedMessages = emergencyMessages;
    messagesRemoved = messages.length - optimizedMessages.length;
    strategy = 'emergency_pruning';
  }

  const result = {
    optimizedMessages,
    originalTokenCount,
    finalTokenCount: calculateTotalTokens(optimizedMessages),
    messagesRemoved,
    messagesSummarized,
    optimizationStrategy: strategy,
    compressionRatio:
      originalTokenCount > 0 ? calculateTotalTokens(optimizedMessages) / originalTokenCount : 1,
  };

  logger.info(
    {
      ...result,
      compressionRatio: result.compressionRatio.toFixed(3),
    },
    'Context optimization completed'
  );

  return result;
}

/**
 * Summarize a group of messages into a concise summary
 * Note: This is a placeholder for future AI-powered summarization
 * @param {Array<Object>} messages - Messages to summarize
 * @returns {Object} Summary message object
 */
function summarizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  // Simple summarization strategy (placeholder for AI summarization)
  const userMessages = messages.filter(msg => msg.role === 'user');
  const uniqueUsers = new Set(userMessages.map(msg => msg.username || msg.userId));
  const timeSpan =
    messages.length > 1 ? messages[messages.length - 1].timestamp - messages[0].timestamp : 0;

  const timeSpanMinutes = Math.round(timeSpan / (1000 * 60));

  let summary = `[Summary: ${messages.length} messages from ${uniqueUsers.size} user(s)`;
  if (timeSpanMinutes > 0) {
    summary += ` over ${timeSpanMinutes} minutes`;
  }

  // Add key topics if available
  const topics = extractKeyTopics(messages);
  if (topics.length > 0) {
    summary += ` discussing: ${topics.join(', ')}`;
  }

  summary += ']';

  return {
    role: 'system',
    content: summary,
    timestamp: Date.now(),
    isSummary: true,
    originalMessageCount: messages.length,
    summarizedUsers: Array.from(uniqueUsers),
  };
}

/**
 * Extract key topics from messages (simple keyword extraction)
 * @param {Array<Object>} messages - Messages to analyze
 * @returns {Array<string>} Key topics found
 */
function extractKeyTopics(messages) {
  const topicKeywords = [
    'weather',
    'temperature',
    'forecast',
    'quake',
    'server',
    'game',
    'stats',
    'player',
    'image',
    'generate',
    'create',
    'picture',
    'time',
    'timezone',
    'clock',
    'help',
    'command',
    'how',
    'error',
    'problem',
    'issue',
    'thanks',
    'thank you',
  ];

  const foundTopics = new Set();

  for (const message of messages) {
    if (!message.content) continue;

    const content = message.content.toLowerCase();
    for (const keyword of topicKeywords) {
      if (content.includes(keyword)) {
        foundTopics.add(keyword);
      }
    }
  }

  return Array.from(foundTopics).slice(0, 3); // Limit to 3 key topics
}

/**
 * Check if context optimization is needed
 * @param {Array<Object>} messages - Messages to check
 * @param {number} maxTokens - Maximum allowed tokens
 * @returns {boolean} True if optimization is needed
 */
function needsOptimization(messages, maxTokens = CONFIG.DEFAULT_MAX_TOKENS) {
  const currentTokens = calculateTotalTokens(messages);
  return currentTokens > maxTokens;
}

/**
 * Get context optimization statistics
 * @param {Array<Object>} messages - Messages to analyze
 * @returns {Object} Statistics about the context
 */
function getContextStats(messages) {
  if (!Array.isArray(messages)) {
    return {
      totalMessages: 0,
      totalTokens: 0,
      avgTokensPerMessage: 0,
      systemMessages: 0,
      userMessages: 0,
      assistantMessages: 0,
      oldestMessage: null,
      newestMessage: null,
    };
  }

  const totalTokens = calculateTotalTokens(messages);
  const messagesByRole = messages.reduce((acc, msg) => {
    acc[msg.role] = (acc[msg.role] || 0) + 1;
    return acc;
  }, {});

  const timestamps = messages
    .map(msg => msg.timestamp)
    .filter(ts => ts && typeof ts === 'number')
    .sort((a, b) => a - b);

  return {
    totalMessages: messages.length,
    totalTokens,
    avgTokensPerMessage: messages.length > 0 ? Math.round(totalTokens / messages.length) : 0,
    systemMessages: messagesByRole.system || 0,
    userMessages: messagesByRole.user || 0,
    assistantMessages: messagesByRole.assistant || 0,
    oldestMessage: timestamps.length > 0 ? new Date(timestamps[0]) : null,
    newestMessage: timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]) : null,
    timeSpanMinutes:
      timestamps.length > 1
        ? Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / (1000 * 60))
        : 0,
  };
}

module.exports = {
  estimateTokenCount,
  calculateTotalTokens,
  optimizeContext,
  summarizeMessages,
  extractKeyTopics,
  needsOptimization,
  getContextStats,
  CONFIG,
};
