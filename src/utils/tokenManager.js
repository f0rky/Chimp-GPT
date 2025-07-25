/**
 * Centralized Token Management Utility
 *
 * Provides consistent token estimation and management across the application.
 * Replaces scattered token calculation logic with a single source of truth.
 *
 * Key features:
 * - Consistent token estimation across all components
 * - Conversation optimization for token limits
 * - Support for different message roles and function definitions
 * - Emergency truncation for extreme cases
 *
 * @module TokenManager
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../core/logger');
const logger = createLogger('TokenManager');

/**
 * Token estimation configuration
 */
const TOKEN_CONFIG = {
  CHARS_PER_TOKEN: 4,
  ROLE_TOKENS: {
    system: 10,
    user: 5,
    assistant: 5,
    function: 8,
  },
  FUNCTION_DEF_TOKENS: 100, // Approximate tokens per function definition
};

/**
 * Token estimation utility class
 */
class TokenManager {
  /**
   * Estimate tokens for a single message
   * @param {Object} message - Message object with content and role
   * @returns {number} Estimated token count
   */
  static estimateMessageTokens(message) {
    if (!message || typeof message !== 'object') {
      return 0;
    }

    const contentLength = message.content ? message.content.length : 0;
    const roleTokens = TOKEN_CONFIG.ROLE_TOKENS[message.role] || TOKEN_CONFIG.ROLE_TOKENS.user;

    return Math.ceil(contentLength / TOKEN_CONFIG.CHARS_PER_TOKEN) + roleTokens;
  }

  /**
   * Estimate tokens for an array of messages (conversation)
   * @param {Array} messages - Array of message objects
   * @returns {number} Total estimated token count
   */
  static estimateConversationTokens(messages) {
    if (!Array.isArray(messages)) {
      logger.warn('Invalid messages array provided to estimateConversationTokens');
      return 0;
    }

    return messages.reduce((total, message) => {
      return total + this.estimateMessageTokens(message);
    }, 0);
  }

  /**
   * Estimate tokens for function definitions
   * @param {Array} functions - Array of function definitions
   * @returns {number} Estimated token count for function definitions
   */
  static estimateFunctionTokens(functions) {
    if (!Array.isArray(functions)) {
      return 0;
    }

    return functions.length * TOKEN_CONFIG.FUNCTION_DEF_TOKENS;
  }

  /**
   * Calculate total prompt tokens including messages and functions
   * @param {Array} messages - Conversation messages
   * @param {Array} functions - Function definitions
   * @returns {number} Total estimated prompt tokens
   */
  static calculatePromptTokens(messages, functions = []) {
    const messageTokens = this.estimateConversationTokens(messages);
    const functionTokens = this.estimateFunctionTokens(functions);

    return messageTokens + functionTokens;
  }

  /**
   * Optimize conversation messages to fit within token limits
   * @param {Array} messages - Original messages
   * @param {Object} options - Optimization options
   * @returns {Object} Optimized messages with metadata
   */
  static optimizeForTokenLimit(messages, options = {}) {
    const { maxTokens = 2000, emergencyMaxTokens = 4000, preserveRecentMessages = 3 } = options;

    if (!Array.isArray(messages)) {
      return {
        optimizedMessages: [],
        originalTokenCount: 0,
        finalTokenCount: 0,
        messagesRemoved: 0,
      };
    }

    const originalTokenCount = this.estimateConversationTokens(messages);

    if (originalTokenCount <= maxTokens) {
      return {
        optimizedMessages: messages,
        originalTokenCount,
        finalTokenCount: originalTokenCount,
        messagesRemoved: 0,
      };
    }

    // Separate system messages and conversation messages
    const systemMessages = messages.filter(msg => msg.role === 'system');
    const conversationMessages = messages.filter(msg => msg.role !== 'system');

    // Always preserve recent messages
    const recentMessages = conversationMessages.slice(-preserveRecentMessages);
    const olderMessages = conversationMessages.slice(0, -preserveRecentMessages);

    // Start with system messages and recent messages
    let optimizedMessages = [...systemMessages, ...recentMessages];
    let currentTokens = this.estimateConversationTokens(optimizedMessages);

    // Add older messages while staying under token limit
    for (let i = olderMessages.length - 1; i >= 0; i--) {
      const message = olderMessages[i];
      const messageTokens = this.estimateMessageTokens(message);

      if (currentTokens + messageTokens <= maxTokens) {
        optimizedMessages.splice(-preserveRecentMessages, 0, message);
        currentTokens += messageTokens;
      } else {
        break;
      }
    }

    const finalTokenCount = this.estimateConversationTokens(optimizedMessages);

    // Emergency truncation if still over emergency limit
    if (finalTokenCount > emergencyMaxTokens) {
      logger.warn('Emergency token truncation required', {
        originalTokens: originalTokenCount,
        currentTokens: finalTokenCount,
        emergencyLimit: emergencyMaxTokens,
      });

      // Keep only system messages and most recent messages
      optimizedMessages = [
        ...systemMessages,
        ...recentMessages.slice(-Math.max(1, preserveRecentMessages - 1)),
      ];
    }

    return {
      optimizedMessages,
      originalTokenCount,
      finalTokenCount: this.estimateConversationTokens(optimizedMessages),
      messagesRemoved: messages.length - optimizedMessages.length,
    };
  }

  /**
   * Get token configuration constants
   * @returns {Object} Token configuration
   */
  static getConfig() {
    return { ...TOKEN_CONFIG };
  }
}

module.exports = TokenManager;
