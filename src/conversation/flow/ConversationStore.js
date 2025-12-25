const { SharedStore } = require('./PocketFlow');
const config = require('../../core/configValidator');

class ConversationStore extends SharedStore {
  constructor() {
    super();
    this.initializeDefaults();
  }

  initializeDefaults() {
    this.set('conversations', new Map());
    this.set('userContexts', new Map());
    this.set('channelContexts', new Map());
    this.set('botIntentCache', new Map());
    this.set('rateLimits', new Map());
    this.set('activeFlows', new Map());

    // Initialize bot personality from configuration
    this.set(
      'botPersonality',
      config.BOT_PERSONALITY ||
        'You are a helpful AI assistant. Respond naturally and helpfully to user messages.'
    );
  }

  getConversation(userId) {
    const conversations = this.get('conversations');
    if (!conversations.has(userId)) {
      conversations.set(userId, {
        messages: [],
        lastActivity: Date.now(),
        messageCount: 0,
        context: {},
      });
    }
    return conversations.get(userId);
  }

  updateConversation(userId, conversation) {
    const conversations = this.get('conversations');
    conversations.set(userId, {
      ...conversation,
      lastActivity: Date.now(),
    });
    return this;
  }

  getChannelContext(channelId) {
    const channelContexts = this.get('channelContexts');
    if (!channelContexts.has(channelId)) {
      channelContexts.set(channelId, {
        recentMessages: [],
        activeUsers: new Set(),
        conversationMode: 'individual',
        lastActivity: Date.now(),
      });
    }
    return channelContexts.get(channelId);
  }

  updateChannelContext(channelId, context) {
    const channelContexts = this.get('channelContexts');
    channelContexts.set(channelId, {
      ...context,
      lastActivity: Date.now(),
    });
    return this;
  }

  getUserContext(userId) {
    const userContexts = this.get('userContexts');
    if (!userContexts.has(userId)) {
      userContexts.set(userId, {
        preferences: {},
        lastSeen: Date.now(),
        messageHistory: [],
        intentHistory: [],
      });
    }
    return userContexts.get(userId);
  }

  updateUserContext(userId, context) {
    const userContexts = this.get('userContexts');
    userContexts.set(userId, {
      ...context,
      lastSeen: Date.now(),
    });
    return this;
  }

  setBotIntent(messageId, intent) {
    const botIntentCache = this.get('botIntentCache');

    // Check size BEFORE insertion to enforce strict limit of 1000 entries
    if (botIntentCache.size >= 1000) {
      const oldestKey = botIntentCache.keys().next().value;
      botIntentCache.delete(oldestKey);
    }

    botIntentCache.set(messageId, {
      intent,
      timestamp: Date.now(),
      confidence: intent.confidence || 0,
    });

    return this;
  }

  getBotIntent(messageId) {
    const botIntentCache = this.get('botIntentCache');
    return botIntentCache.get(messageId);
  }

  setActiveFlow(userId, flowType, flowData) {
    const activeFlows = this.get('activeFlows');
    activeFlows.set(userId, {
      type: flowType,
      data: flowData,
      startTime: Date.now(),
    });
    return this;
  }

  getActiveFlow(userId) {
    const activeFlows = this.get('activeFlows');
    return activeFlows.get(userId);
  }

  clearActiveFlow(userId) {
    const activeFlows = this.get('activeFlows');
    activeFlows.delete(userId);
    return this;
  }

  cleanup(maxAge = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    const conversations = this.get('conversations');
    const userContexts = this.get('userContexts');
    const channelContexts = this.get('channelContexts');
    const botIntentCache = this.get('botIntentCache');

    // Optimize: Collect keys first, then delete (better than modifying during iteration)
    const expiredConversations = [];
    for (const [userId, conversation] of conversations) {
      if (now - conversation.lastActivity > maxAge) {
        expiredConversations.push(userId);
      }
    }
    expiredConversations.forEach(userId => conversations.delete(userId));

    const expiredUserContexts = [];
    for (const [userId, context] of userContexts) {
      if (now - context.lastSeen > maxAge) {
        expiredUserContexts.push(userId);
      }
    }
    expiredUserContexts.forEach(userId => userContexts.delete(userId));

    const expiredChannelContexts = [];
    for (const [channelId, context] of channelContexts) {
      if (now - context.lastActivity > maxAge) {
        expiredChannelContexts.push(channelId);
      }
    }
    expiredChannelContexts.forEach(channelId => channelContexts.delete(channelId));

    const expiredIntents = [];
    for (const [messageId, intent] of botIntentCache) {
      if (now - intent.timestamp > maxAge) {
        expiredIntents.push(messageId);
      }
    }
    expiredIntents.forEach(messageId => botIntentCache.delete(messageId));

    return this;
  }
}

module.exports = ConversationStore;
