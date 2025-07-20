const BaseConversationNode = require('./BaseNode');
const { createLogger } = require('../../../core/logger');

const logger = createLogger('IntentDetectionNode');

class IntentDetectionNode extends BaseConversationNode {
  constructor(options = {}) {
    const action = async (store, data) => {
      return await this.detectIntent(store, data);
    };

    super('intent_detection', action, {
      timeout: 5000,
      logLevel: 'debug',
      ...options,
    });

    this.config = {
      confidenceThreshold: options.confidenceThreshold || 0.4,
      botNames: options.botNames || ['chimp', 'chimpgpt', 'bot'],
      replyChainBoost: options.replyChainBoost || 0.3,
      ...options.config,
    };

    this.initializePatterns();
  }

  initializePatterns() {
    this.botDirectedPatterns = [
      new RegExp(`\\b(?:${this.config.botNames.join('|')})\\b`, 'i'),
      /@\w+/,
      /^(?:hey|hi|hello|yo)\s+(?:bot|chimp)/i,
      /can you\s+/i,
      /please\s+/i,
      /could you\s+/i,
      /would you\s+/i,
      /^[!/]/,
      /\?$/,
      /^(?:what|where|when|how|why|who)(?:\s|'s\s)/i,
    ];

    // High-confidence patterns for specific actions
    this.highConfidencePatterns = [
      // Image generation patterns
      /(?:draw|create|generate|make).*(?:image|picture|photo|artwork|art)/i,
      /(?:can you|could you|please).*(?:draw|create|generate|make)/i,
      /(?:show me|give me).*(?:image|picture|photo)/i,
      // Time and weather patterns
      /(?:what.*time|current time|time.*in)/i,
      /(?:weather|forecast|temperature).*(?:in|for|at)/i,
      // Question patterns
      /(?:what.*server|server.*stats|quake.*stats)/i,
    ];

    this.continuationPatterns = [
      /^(?:and|also|but|however|though|still|yet)\s/i,
      /^(?:no|yes|yeah|nah|yep|sure|ok|okay)\s?$/i,
      /^(?:thanks|thank you|thx)\s?/i,
    ];

    this.generalChatPatterns = [
      /^(?:lol|haha|lmao|rofl)\s?$/i,
      /^(?:nice|cool|wow|awesome)\s?$/i,
      /<a?:.+?:\d+>/g,
      /[\u{1f600}-\u{1f64f}]|[\u{1f300}-\u{1f5ff}]|[\u{1f680}-\u{1f6ff}]|[\u{1f1e0}-\u{1f1ff}]/gu,
    ];
  }

  async detectIntent(store, data) {
    const { message, context = {} } = data;

    if (!message || !message.content) {
      return {
        success: false,
        error: 'Invalid message data',
        intent: null,
      };
    }

    const intent = this.analyzeBotIntent(message.content, {
      ...context,
      messageId: message.id,
      userId: message.author?.id,
      channelId: message.channel?.id,
      isReply: !!message.reference,
      replyToBotMessage: this.isReplyToBotMessage(message, store),
    });

    store.setBotIntent(message.id, intent);

    const userContext = store.getUserContext(message.author?.id);
    userContext.intentHistory = userContext.intentHistory || [];
    userContext.intentHistory.push({
      messageId: message.id,
      intent: intent,
      timestamp: Date.now(),
    });

    if (userContext.intentHistory.length > 10) {
      userContext.intentHistory.shift();
    }

    store.updateUserContext(message.author?.id, userContext);

    return {
      success: true,
      intent: intent,
      confidence: intent.confidence,
      patterns: intent.patterns,
      messageId: message.id,
      userId: message.author?.id,
      message: message,
      originalMessage: message,
    };
  }

  analyzeBotIntent(content, context = {}) {
    if (!content || typeof content !== 'string') {
      return { isBotDirected: false, confidence: 0, patterns: [] };
    }

    const normalizedContent = content.toLowerCase().trim();
    const matchedPatterns = [];
    let confidence = 0;

    // Check for Discord mentions (highest priority)
    if (/<@\d+>/.test(content)) {
      confidence = 1.0;
      matchedPatterns.push('discord_mention');
    }
    // Check for command prefixes (high priority)
    else if (/^[!/]/.test(normalizedContent)) {
      confidence = 0.8;
      matchedPatterns.push('command');
    }
    // Check high-confidence patterns first
    else {
      let hasHighConfidenceMatch = false;

      for (const pattern of this.highConfidencePatterns) {
        if (pattern.test(normalizedContent)) {
          matchedPatterns.push(`high_confidence:${pattern.source}`);
          confidence += 0.7; // High confidence boost
          hasHighConfidenceMatch = true;
        }
      }

      // Then check regular bot-directed patterns
      for (const pattern of this.botDirectedPatterns) {
        if (pattern.test(normalizedContent)) {
          matchedPatterns.push(pattern.source);

          if (pattern.source.includes('?') || pattern.source.includes('what|where|when')) {
            confidence += hasHighConfidenceMatch ? 0.2 : 0.5;
          } else {
            confidence += hasHighConfidenceMatch ? 0.1 : 0.3;
          }
        }
      }
    }

    for (const pattern of this.continuationPatterns) {
      if (pattern.test(normalizedContent)) {
        matchedPatterns.push(`continuation:${pattern.source}`);
        confidence += 0.2;
      }
    }

    for (const pattern of this.generalChatPatterns) {
      if (pattern.test(normalizedContent)) {
        confidence *= 0.5;
        matchedPatterns.push(`general:${pattern.source}`);
      }
    }

    if (context.isReply && context.replyToBotMessage) {
      confidence += this.config.replyChainBoost;
      matchedPatterns.push('reply_to_bot');
    }

    if (normalizedContent.length < 3) {
      confidence *= 0.3;
    }

    confidence = Math.min(confidence, 1.0);
    const isBotDirected = confidence > this.config.confidenceThreshold;

    if (isBotDirected) {
      logger.debug(
        {
          content: content.substring(0, 50),
          confidence,
          patterns: matchedPatterns,
        },
        'Detected bot-directed message'
      );
    }

    return {
      isBotDirected,
      confidence,
      patterns: matchedPatterns,
      timestamp: Date.now(),
    };
  }

  isReplyToBotMessage(message, store) {
    if (!message.reference) return false;

    try {
      const referencedMessageId = message.reference.messageId;
      if (!referencedMessageId) return false;

      const referencedIntent = store.getBotIntent(referencedMessageId);
      if (referencedIntent) {
        return referencedIntent.intent.fromBot === true;
      }

      return false;
    } catch (error) {
      logger.warn('Error checking reply to bot message:', error.message);
      return false;
    }
  }
}

module.exports = IntentDetectionNode;
