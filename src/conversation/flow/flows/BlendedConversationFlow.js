const { Flow } = require('../PocketFlow');
const ConversationStore = require('../ConversationStore');
const IntentDetectionNode = require('../nodes/IntentDetectionNode');
const ContextManagerNode = require('../nodes/ContextManagerNode');
const ResponseRouterNode = require('../nodes/ResponseRouterNode');
const FunctionExecutorNode = require('../nodes/FunctionExecutorNode');

class BlendedConversationFlow {
  constructor(openaiClient, functionCallProcessor, options = {}) {
    this.store = new ConversationStore();
    this.options = options;

    this.initializeNodes(openaiClient, functionCallProcessor);
    this.buildFlow();
  }

  initializeNodes(openaiClient, functionCallProcessor) {
    this.intentNode = new IntentDetectionNode({
      ...this.options.intent,
      confidenceThreshold: 0.3, // Lower threshold for blended mode
    });

    this.contextNode = new ContextManagerNode({
      ...this.options.context,
      config: {
        maxConversationLength: 15, // More context for blended conversations
        defaultMaxTokens: 2500, // Larger context window
        ...this.options.context?.config,
      },
    });

    this.routerNode = new ResponseRouterNode({
      ...this.options.router,
      config: {
        defaultConversationMode: 'blended',
        blendedChannelThreshold: 3,
        ...this.options.router?.config,
      },
    });

    this.functionNode = new FunctionExecutorNode(
      openaiClient,
      functionCallProcessor,
      this.options.function
    );

    this.setupConnections();
  }

  setupConnections() {
    this.intentNode
      .onSuccess(this.contextNode)
      .onError(this.createErrorHandler('intent_detection_failed'));

    this.contextNode
      .onSuccess(this.routerNode)
      .onError(this.createErrorHandler('context_management_failed'));

    this.routerNode
      .onCondition(result => result.success && result.routedData, this.functionNode)
      .onError(this.createErrorHandler('routing_failed'));

    this.functionNode
      .onSuccess(this.createSuccessHandler())
      .onError(this.createErrorHandler('function_execution_failed'));
  }

  buildFlow() {
    this.flow = new Flow(this.intentNode, this.store);
  }

  async processMessage(messageData) {
    try {
      const startTime = Date.now();

      const flowData = {
        message: messageData.message,
        context: messageData.context || {},
        flowType: 'blended',
        channelId: messageData.message.channel?.id,
        startTime: startTime,
      };

      const userId = messageData.message.author?.id;
      const channelId = messageData.message.channel?.id;

      this.store.setActiveFlow(userId, 'blended', flowData);

      this.updateChannelActivity(channelId, userId);

      const result = await this.flow.run(flowData);

      this.store.clearActiveFlow(userId);

      return {
        success: true,
        result: result,
        flowType: 'blended',
        executionTime: Date.now() - startTime,
        channelActivity: this.getChannelActivity(channelId),
      };
    } catch (error) {
      this.store.clearActiveFlow(messageData.message.author?.id);
      throw error;
    }
  }

  updateChannelActivity(channelId, userId) {
    if (!channelId || !userId) return;

    const channelContext = this.store.getChannelContext(channelId);

    channelContext.activeUsers = channelContext.activeUsers || new Set();
    channelContext.activeUsers.add(userId);

    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (channelContext.recentMessages) {
      channelContext.recentMessages = channelContext.recentMessages.filter(
        msg => msg.timestamp > fiveMinutesAgo
      );
    }

    this.store.updateChannelContext(channelId, channelContext);
  }

  getChannelActivity(channelId) {
    if (!channelId) return null;

    const channelContext = this.store.getChannelContext(channelId);
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    const recentMessages = channelContext.recentMessages || [];
    const recentMessageCount = recentMessages.filter(msg => msg.timestamp > fiveMinutesAgo).length;

    const activeUsers = channelContext.activeUsers
      ? Array.from(channelContext.activeUsers).filter(userId => {
          const userContext = this.store.getUserContext(userId);
          return userContext && now - userContext.lastSeen < fiveMinutesAgo;
        })
      : [];

    return {
      recentMessageCount,
      activeUserCount: activeUsers.length,
      activeUsers: activeUsers,
      conversationVelocity: this.calculateConversationVelocity(recentMessages),
      lastActivity: channelContext.lastActivity,
    };
  }

  calculateConversationVelocity(recentMessages) {
    if (!recentMessages || recentMessages.length < 2) {
      return 'low';
    }

    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const relevantMessages = recentMessages.filter(msg => msg.timestamp > fiveMinutesAgo);

    if (relevantMessages.length > 15) {
      return 'high';
    }
    if (relevantMessages.length > 8) {
      return 'medium';
    }
    return 'low';
  }

  createSuccessHandler() {
    return {
      id: 'blended_success_handler',
      action: async (store, data) => {
        const userId = data.message?.author?.id;

        if (data.message?.channel?.id) {
          const channelContext = store.getChannelContext(data.message.channel.id);

          if (data.response) {
            const botMessage = {
              role: 'assistant',
              content: data.response,
              timestamp: Date.now(),
              messageId: `bot_${Date.now()}`,
              isBot: true,
              functionCall:
                data.type === 'function_call'
                  ? {
                      name: data.functionName,
                      result: data.functionResult,
                    }
                  : null,
            };

            channelContext.recentMessages = channelContext.recentMessages || [];
            channelContext.recentMessages.push(botMessage);

            if (channelContext.recentMessages.length > 20) {
              channelContext.recentMessages = channelContext.recentMessages.slice(-20);
            }
          }

          channelContext.lastActivity = Date.now();
          store.updateChannelContext(data.message.channel.id, channelContext);
        }

        if (userId) {
          const userContext = store.getUserContext(userId);
          userContext.lastSeen = Date.now();
          userContext.messageHistory = userContext.messageHistory || [];

          if (data.response) {
            userContext.messageHistory.push({
              type: 'bot_response',
              content: data.response,
              timestamp: Date.now(),
              functionCall: data.functionCall,
            });

            if (userContext.messageHistory.length > 10) {
              userContext.messageHistory.shift();
            }
          }

          store.updateUserContext(userId, userContext);
        }

        return {
          success: true,
          response: data.response || 'I processed your message successfully.',
          type: data.type || 'direct_response',
          functionCall: data.functionCall,
          executionTime: data.executionTime,
          conversationMode: 'blended',
        };
      },
      connections: [],
    };
  }

  createErrorHandler(errorType) {
    return {
      id: `blended_error_handler_${errorType}`,
      action: async (store, data) => {
        const error = data.error || 'Unknown error occurred';

        return {
          success: false,
          error: error,
          errorType: errorType,
          response: this.getErrorResponse(errorType, error),
          timestamp: Date.now(),
          conversationMode: 'blended',
        };
      },
      connections: [],
    };
  }

  getErrorResponse(errorType, _error) {
    const errorResponses = {
      intent_detection_failed:
        'I had trouble understanding the message in this conversation. Could someone try rephrasing it?',
      context_management_failed:
        'I encountered an issue managing the conversation context in this channel. Please try again.',
      routing_failed: 'I had trouble determining how to respond in this conversation.',
      function_execution_failed: 'I encountered an error while trying to help. Please try again.',
    };

    return (
      errorResponses[errorType] ||
      'I encountered an unexpected error in this conversation. Please try again.'
    );
  }

  getStore() {
    return this.store;
  }

  getFlowStats() {
    const allChannels = this.store.get('channelContexts');
    const totalChannels = allChannels ? allChannels.size : 0;

    let totalMessages = 0;
    let activeChannels = 0;
    const now = Date.now();
    const activeThreshold = 10 * 60 * 1000; // 10 minutes for channels

    if (allChannels) {
      for (const [_channelId, context] of allChannels) {
        totalMessages += context.recentMessages ? context.recentMessages.length : 0;
        if (now - context.lastActivity < activeThreshold) {
          activeChannels++;
        }
      }
    }

    return {
      totalChannels,
      activeChannels,
      totalMessages,
      avgMessagesPerChannel: totalChannels > 0 ? totalMessages / totalChannels : 0,
      storeSize: this.store.data.size,
    };
  }

  cleanup() {
    this.store.cleanup();

    const now = Date.now();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes

    const channelContexts = this.store.get('channelContexts');
    if (channelContexts) {
      for (const [_channelId, context] of channelContexts) {
        if (context.activeUsers) {
          context.activeUsers = new Set(
            Array.from(context.activeUsers).filter(userId => {
              const userContext = this.store.getUserContext(userId);
              return userContext && now - userContext.lastSeen < inactiveThreshold;
            })
          );
        }
      }
    }
  }
}

module.exports = BlendedConversationFlow;
