const BaseConversationNode = require('./BaseNode');
const { createLogger } = require('../../../core/logger');
const config = require('../../../core/configValidator');

const logger = createLogger('ContextManagerNode');

class ContextManagerNode extends BaseConversationNode {
  constructor(options = {}) {
    const action = async (store, data) => {
      return await this.manageContext(store, data);
    };

    super('context_manager', action, {
      timeout: 10000,
      logLevel: 'debug',
      ...options,
    });

    const TokenManager = require('../../utils/tokenManager');
    this.tokenConfig = TokenManager.getConfig();

    this.config = {
      defaultMaxTokens: 2000,
      emergencyMaxTokens: 4000,
      minContextTokens: 200,
      preserveRecentMessages: 3,
      maxConversationLength: 20,
      ...options.config,
    };
  }

  async manageContext(store, data) {
    const message = data.message || data.originalMessage;
    const conversationType = data.conversationType || 'individual';
    const maxTokens = data.maxTokens;

    if (!message) {
      const error = new Error('No message provided for context management');
      logger.error('Context management failed: missing message', { data });
      return {
        success: false,
        error: error.message,
        originalData: data,
      };
    }

    try {
      let contextMessages = [];

      if (conversationType === 'individual') {
        contextMessages = await this.buildIndividualContext(store, message);
      } else if (conversationType === 'blended') {
        contextMessages = await this.buildBlendedContext(store, message);
      }

      const optimizedContext = this.optimizeContext(contextMessages, {
        maxTokens: maxTokens || this.config.defaultMaxTokens,
        emergencyMaxTokens: this.config.emergencyMaxTokens,
        preserveRecentMessages: this.config.preserveRecentMessages,
      });

      this.updateConversationStore(store, message, optimizedContext);

      return {
        success: true,
        context: optimizedContext.optimizedMessages,
        metadata: {
          originalTokenCount: optimizedContext.originalTokenCount,
          finalTokenCount: optimizedContext.finalTokenCount,
          messagesRemoved: optimizedContext.messagesRemoved,
          optimizationStrategy: optimizedContext.optimizationStrategy,
          conversationType: conversationType,
        },
        message: message,
        originalMessage: message,
        intent: data.intent,
        confidence: data.confidence,
      };
    } catch (error) {
      logger.error('Error managing context:', {
        error: error.message,
        stack: error.stack,
        conversationType,
        messageId: message?.id,
        userId: message?.author?.id,
      });
      return {
        success: false,
        error: `Context management failed: ${error.message}`,
        context: [],
        originalData: data,
      };
    }
  }

  async buildIndividualContext(store, message) {
    const userId = message.author?.id;
    if (!userId) return [];

    const conversation = store.getConversation(userId);

    const systemMessage = {
      role: 'system',
      content: this.getSystemPrompt(),
      timestamp: Date.now(),
    };

    const userMessage = {
      role: 'user',
      content: message.content,
      timestamp: message.createdTimestamp || Date.now(),
      messageId: message.id,
      userId: userId,
    };

    conversation.messages.push(userMessage);

    if (conversation.messages.length > this.config.maxConversationLength) {
      conversation.messages = conversation.messages.slice(-this.config.maxConversationLength);
    }

    store.updateConversation(userId, conversation);

    return [systemMessage, ...conversation.messages];
  }

  async buildBlendedContext(store, message) {
    const channelId = message.channel?.id;
    if (!channelId) return [];

    const channelContext = store.getChannelContext(channelId);
    const systemMessage = {
      role: 'system',
      content: this.getSystemPrompt(),
      timestamp: Date.now(),
    };

    const newMessage = {
      role: 'user',
      content: `${message.author?.displayName || message.author?.username}: ${message.content}`,
      timestamp: message.createdTimestamp || Date.now(),
      messageId: message.id,
      userId: message.author?.id,
      channelId: channelId,
    };

    channelContext.recentMessages = channelContext.recentMessages || [];
    channelContext.recentMessages.push(newMessage);

    if (channelContext.recentMessages.length > this.config.maxConversationLength) {
      channelContext.recentMessages = channelContext.recentMessages.slice(
        -this.config.maxConversationLength
      );
    }

    store.updateChannelContext(channelId, channelContext);

    return [systemMessage, ...channelContext.recentMessages];
  }

  optimizeContext(messages, options = {}) {
    const TokenManager = require('../../utils/tokenManager');
    const {
      maxTokens = this.config.defaultMaxTokens,
      emergencyMaxTokens = this.config.emergencyMaxTokens,
      preserveRecentMessages = this.config.preserveRecentMessages,
    } = options;

    const result = TokenManager.optimizeForTokenLimit(messages, {
      maxTokens,
      emergencyMaxTokens,
      preserveRecentMessages,
    });

    return {
      ...result,
      optimizationStrategy: result.messagesRemoved > 0 ? 'token_optimization' : 'none',
    };
  }

  estimateTokenCount(message) {
    const TokenManager = require('../../utils/tokenManager');
    return TokenManager.estimateMessageTokens(message);
  }

  calculateTotalTokens(messages) {
    const TokenManager = require('../../utils/tokenManager');
    return TokenManager.estimateConversationTokens(messages);
  }

  updateConversationStore(store, message, optimizedContext) {
    const userId = message.author?.id;
    if (!userId) return;

    const conversation = store.getConversation(userId);
    conversation.lastActivity = Date.now();
    conversation.messageCount = (conversation.messageCount || 0) + 1;
    conversation.context = {
      tokenCount: optimizedContext.finalTokenCount,
      messageCount: optimizedContext.optimizedMessages.length,
      lastOptimization: Date.now(),
      strategy: optimizedContext.optimizationStrategy,
    };

    store.updateConversation(userId, conversation);
  }

  getSystemPrompt() {
    // Use the bot's personality from configuration
    const personality =
      config.BOT_PERSONALITY ||
      'You are a helpful AI assistant. Respond naturally and helpfully to user messages.';
    return personality;
  }
}

module.exports = ContextManagerNode;
