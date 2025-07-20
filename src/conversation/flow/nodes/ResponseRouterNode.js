const BaseConversationNode = require('./BaseNode');
const { createLogger } = require('../../../core/logger');

const logger = createLogger('ResponseRouterNode');

class ResponseRouterNode extends BaseConversationNode {
  constructor(options = {}) {
    const action = async (store, data) => {
      return await this.routeResponse(store, data);
    };

    super('response_router', action, {
      timeout: 5000,
      logLevel: 'debug',
      ...options,
    });

    this.config = {
      defaultConversationMode: 'individual',
      blendedChannelThreshold: 5, // Number of active users before switching to blended mode
      blendedModeTimeout: 300000, // 5 minutes of inactivity before switching back
      ...options.config,
    };
  }

  async routeResponse(store, data) {
    const { message, intent } = data;

    if (!message || !intent) {
      return {
        success: false,
        error: 'Missing required message or intent data',
      };
    }

    try {
      const routingDecision = this.determineConversationMode(store, message, intent);

      const routedData = {
        ...data,
        conversationType: routingDecision.mode,
        routingReason: routingDecision.reason,
        shouldUseBlended: routingDecision.mode === 'blended',
        channelContext: routingDecision.channelContext,
        userContext: routingDecision.userContext,
      };

      this.updateRoutingMetrics(store, message, routingDecision);

      return {
        success: true,
        routedData,
        conversationType: routingDecision.mode,
        routingDecision: routingDecision,
        message: message,
        intent: intent,
        context: data.context,
      };
    } catch (error) {
      logger.error('Error routing response:', error);
      return {
        success: false,
        error: error.message,
        routedData: {
          ...data,
          conversationType: this.config.defaultConversationMode,
        },
      };
    }
  }

  determineConversationMode(store, message, intent) {
    const channelId = message.channel?.id;
    const userId = message.author?.id;
    const isDM = message.channel?.type === 'DM';

    if (isDM) {
      return {
        mode: 'individual',
        reason: 'direct_message',
        confidence: 1.0,
        userContext: store.getUserContext(userId),
        channelContext: null,
      };
    }

    const channelContext = store.getChannelContext(channelId);
    const userContext = store.getUserContext(userId);

    if (intent.confidence >= 0.8) {
      return {
        mode: 'individual',
        reason: 'high_confidence_intent',
        confidence: intent.confidence,
        userContext,
        channelContext,
      };
    }

    if (this.isCommandMessage(message)) {
      return {
        mode: 'individual',
        reason: 'command_message',
        confidence: 1.0,
        userContext,
        channelContext,
      };
    }

    const channelActivity = this.analyzeChannelActivity(store, channelId);

    if (channelActivity.activeUsers >= this.config.blendedChannelThreshold) {
      return {
        mode: 'blended',
        reason: 'high_channel_activity',
        confidence: 0.7,
        userContext,
        channelContext: {
          ...channelContext,
          activity: channelActivity,
        },
      };
    }

    if (this.hasRecentChannelConversation(store, channelId)) {
      return {
        mode: 'blended',
        reason: 'ongoing_channel_conversation',
        confidence: 0.6,
        userContext,
        channelContext,
      };
    }

    if (intent.confidence >= 0.5) {
      return {
        mode: 'individual',
        reason: 'moderate_confidence_intent',
        confidence: intent.confidence,
        userContext,
        channelContext,
      };
    }

    return {
      mode: this.config.defaultConversationMode,
      reason: 'default_fallback',
      confidence: 0.3,
      userContext,
      channelContext,
    };
  }

  analyzeChannelActivity(store, channelId) {
    const channelContext = store.getChannelContext(channelId);
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    if (!channelContext.recentMessages) {
      return {
        activeUsers: 0,
        messageCount: 0,
        avgTimeBetweenMessages: 0,
        conversationVelocity: 'low',
      };
    }

    const recentMessages = channelContext.recentMessages.filter(
      msg => msg.timestamp > fiveMinutesAgo
    );

    const uniqueUsers = new Set(recentMessages.map(msg => msg.userId));
    const messageCount = recentMessages.length;

    let avgTimeBetweenMessages = 0;
    if (messageCount > 1) {
      const timeSpan =
        recentMessages[recentMessages.length - 1].timestamp - recentMessages[0].timestamp;
      avgTimeBetweenMessages = timeSpan / (messageCount - 1);
    }

    let conversationVelocity = 'low';
    if (messageCount > 10) {
      conversationVelocity = 'high';
    } else if (messageCount > 5) {
      conversationVelocity = 'medium';
    }

    return {
      activeUsers: uniqueUsers.size,
      messageCount,
      avgTimeBetweenMessages,
      conversationVelocity,
      recentMessageWindow: 5,
    };
  }

  hasRecentChannelConversation(store, channelId) {
    const channelContext = store.getChannelContext(channelId);
    const now = Date.now();
    const conversationThreshold = this.config.blendedModeTimeout;

    if (!channelContext.lastActivity) {
      return false;
    }

    return now - channelContext.lastActivity < conversationThreshold;
  }

  isCommandMessage(message) {
    const content = message.content?.trim();
    if (!content) return false;

    return /^[!/]/.test(content);
  }

  updateRoutingMetrics(store, message, routingDecision) {
    const channelId = message.channel?.id;
    const userId = message.author?.id;

    if (channelId) {
      const channelContext = store.getChannelContext(channelId);
      channelContext.routingHistory = channelContext.routingHistory || [];

      channelContext.routingHistory.push({
        timestamp: Date.now(),
        mode: routingDecision.mode,
        reason: routingDecision.reason,
        confidence: routingDecision.confidence,
        messageId: message.id,
      });

      if (channelContext.routingHistory.length > 20) {
        channelContext.routingHistory.shift();
      }

      store.updateChannelContext(channelId, channelContext);
    }

    if (userId) {
      const userContext = store.getUserContext(userId);
      userContext.routingHistory = userContext.routingHistory || [];

      userContext.routingHistory.push({
        timestamp: Date.now(),
        mode: routingDecision.mode,
        reason: routingDecision.reason,
        confidence: routingDecision.confidence,
        channelId: channelId,
        messageId: message.id,
      });

      if (userContext.routingHistory.length > 10) {
        userContext.routingHistory.shift();
      }

      store.updateUserContext(userId, userContext);
    }
  }

  getRoutingStats(store, channelId) {
    const channelContext = store.getChannelContext(channelId);
    if (!channelContext.routingHistory) {
      return {
        totalDecisions: 0,
        modeDistribution: {},
        reasonDistribution: {},
        avgConfidence: 0,
      };
    }

    const history = channelContext.routingHistory;
    const modeDistribution = {};
    const reasonDistribution = {};
    let totalConfidence = 0;

    for (const decision of history) {
      modeDistribution[decision.mode] = (modeDistribution[decision.mode] || 0) + 1;
      reasonDistribution[decision.reason] = (reasonDistribution[decision.reason] || 0) + 1;
      totalConfidence += decision.confidence || 0;
    }

    return {
      totalDecisions: history.length,
      modeDistribution,
      reasonDistribution,
      avgConfidence: history.length > 0 ? totalConfidence / history.length : 0,
    };
  }
}

module.exports = ResponseRouterNode;
