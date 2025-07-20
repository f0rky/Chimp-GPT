const BaseConversationNode = require('./BaseNode');
const { createLogger } = require('../../../core/logger');

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

    this.config = {
      charsPerToken: 4,
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
      return {
        success: false,
        error: 'No message provided for context management',
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
      logger.error('Error managing context:', error);
      return {
        success: false,
        error: error.message,
        context: [],
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
    const {
      maxTokens = this.config.defaultMaxTokens,
      emergencyMaxTokens = this.config.emergencyMaxTokens,
      preserveRecentMessages = this.config.preserveRecentMessages,
    } = options;

    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        optimizedMessages: [],
        originalTokenCount: 0,
        finalTokenCount: 0,
        messagesRemoved: 0,
        optimizationStrategy: 'none',
      };
    }

    const originalTokenCount = this.calculateTotalTokens(messages);

    if (originalTokenCount <= maxTokens) {
      return {
        optimizedMessages: [...messages],
        originalTokenCount,
        finalTokenCount: originalTokenCount,
        messagesRemoved: 0,
        optimizationStrategy: 'none',
      };
    }

    let optimizedMessages = [...messages];
    let strategy = 'pruning';
    let messagesRemoved = 0;

    const systemMessages = optimizedMessages.filter(msg => msg.role === 'system');
    const nonSystemMessages = optimizedMessages.filter(msg => msg.role !== 'system');

    const recentMessages = nonSystemMessages.slice(-preserveRecentMessages);
    const olderMessages = nonSystemMessages.slice(0, -preserveRecentMessages);

    olderMessages.sort((a, b) => {
      const scoreA = a.relevanceScore || a.metadata?.relevanceScore || 0;
      const scoreB = b.relevanceScore || b.metadata?.relevanceScore || 0;

      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }

      return (b.timestamp || 0) - (a.timestamp || 0);
    });

    let currentTokens = this.calculateTotalTokens([...systemMessages, ...recentMessages]);
    const selectedOlderMessages = [];

    for (const message of olderMessages) {
      const messageTokens = this.estimateTokenCount(message);
      if (currentTokens + messageTokens <= maxTokens) {
        selectedOlderMessages.push(message);
        currentTokens += messageTokens;
      } else {
        messagesRemoved++;
      }
    }

    const allSelectedMessages = [...selectedOlderMessages, ...recentMessages];
    allSelectedMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    optimizedMessages = [...systemMessages, ...allSelectedMessages];

    const finalTokenCount = this.calculateTotalTokens(optimizedMessages);

    if (finalTokenCount > emergencyMaxTokens) {
      logger.warn(
        {
          originalTokens: originalTokenCount,
          currentTokens: finalTokenCount,
          emergencyLimit: emergencyMaxTokens,
        },
        'Applying emergency context pruning'
      );

      const emergencyMessages = [
        ...systemMessages,
        ...recentMessages.slice(-Math.max(1, Math.floor(preserveRecentMessages / 2))),
      ];

      optimizedMessages = emergencyMessages;
      strategy = 'emergency_pruning';
      messagesRemoved = messages.length - emergencyMessages.length;
    }

    return {
      optimizedMessages,
      originalTokenCount,
      finalTokenCount: this.calculateTotalTokens(optimizedMessages),
      messagesRemoved,
      optimizationStrategy: strategy,
    };
  }

  estimateTokenCount(text) {
    if (!text) return 0;
    const content = typeof text === 'string' ? text : text.content || '';
    return Math.ceil(content.length / this.config.charsPerToken);
  }

  calculateTotalTokens(messages) {
    if (!Array.isArray(messages)) return 0;
    return messages.reduce((total, message) => {
      return total + this.estimateTokenCount(message);
    }, 0);
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
    return `You are a helpful AI assistant. Respond naturally and helpfully to user messages.`;
  }
}

module.exports = ContextManagerNode;
