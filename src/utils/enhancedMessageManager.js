/**
 * Enhanced Message Deletion Management System
 *
 * Provides intelligent handling of message deletions with context preservation,
 * bulk cleanup capabilities, and sophisticated response strategies.
 *
 * @module EnhancedMessageManager
 */

const { createLogger } = require('../core/logger');
const maliciousUserManager = require('./maliciousUserManager');

const logger = createLogger('enhancedMessageManager');

// Enhanced configuration
const ENHANCED_CONFIG = {
  // Bulk operation thresholds
  BULK_DELETION_THRESHOLD: 2,
  BULK_DELETION_WINDOW_MS: 10 * 60 * 1000, // 10 minutes
  RAPID_DELETION_THRESHOLD_MS: 30 * 1000, // 30 seconds

  // Rate limiting for Discord API
  MAX_BULK_DELETE_SIZE: 100,
  DELETE_RATE_LIMIT_MS: 1000, // 1 second between bulk operations

  // Context analysis
  MAX_CONTEXT_SUMMARY_LENGTH: 50,
  MAX_CONVERSATION_HISTORY: 5,

  // Response strategies
  STRATEGIES: {
    UPDATE: 'update_with_context',
    DELETE: 'cleanup_all_related',
    ESCALATE: 'log_and_cleanup',
    IGNORE: 'no_action',
  },
};

// Enhanced response templates
const ENHANCED_TEMPLATES = {
  contextual_single: {
    answer:
      '💭 **{username}** asked about something but removed their question.\n*Context: {summary}*',
    image:
      '🎨 **{username}** requested an image but removed their request.\n*Theme: {imageContext}*',
    function:
      '🔧 **{username}** used a function but removed their command.\n*Function: {functionType}*',
    conversation:
      '💬 **{username}** was chatting but removed their message.\n*Topic: {conversationTheme}*',
    default: '💨 **{username}** removed their message.\n*Context: {summary}*',
  },

  multiple_cleanup: {
    notification:
      '🧹 Cleaned up conversation thread after **{username}** removed {count} messages.\n*Last topic: {lastContext}*',
    silent: true,
  },

  frequent_deleter: {
    warning: '⚠️ **{username}** frequently removes messages ({count} total deletions).',
    action: 'cleanup_and_log',
  },

  owner_privilege: {
    respectful: '👑 **{username}** (Owner) removed their message.\n*Context preserved: {context}*',
    tone: 'informative_not_punitive',
  },

  rapid_deletion: {
    cleanup: '🗑️ Rapid deletion detected - cleaning up conversation thread.',
    reason: 'likely_accidental_or_spam',
  },
};

/**
 * Enhanced Message Relationship Manager
 * Tracks relationships between user messages and bot responses with deletion history
 */
class EnhancedMessageRelationshipManager {
  constructor() {
    // Enhanced relationship storage
    this.relationships = new Map(); // messageId -> relationship object
    this.userDeletionWindows = new Map(); // userId -> deletion timestamps
    this.bulkOperationQueue = [];
    this.rateLimitTimer = null;
  }

  /**
   * Store relationship between user message and bot response
   * @param {string} userMessageId - User message ID
   * @param {Object} botMessage - Bot message object
   * @param {Object} userInfo - User information
   * @param {Object} context - Message context
   */
  storeRelationship(userMessageId, botMessage, userInfo, context) {
    const relationship = {
      userMessageId,
      botMessageId: botMessage.id,
      botMessage,
      userId: userInfo.id,
      channelId: botMessage.channelId,
      userInfo: {
        username: userInfo.username,
        displayName: userInfo.displayName || userInfo.username,
        isOwner: maliciousUserManager.isOwner(userInfo.id),
      },
      context: {
        originalContent: context.content || '',
        responseType: context.type || 'unknown',
        timestamp: Date.now(),
        conversationLength: context.conversationLength || 0,
        summary: this.generateContextSummary(context.content || ''),
        functionType: context.functionType,
        imageContext: context.imageContext,
        conversationTheme: context.conversationTheme,
      },
      deletionHistory: [],
      createdAt: Date.now(),
    };

    this.relationships.set(userMessageId, relationship);

    logger.debug(
      {
        userMessageId,
        botMessageId: botMessage.id,
        userId: userInfo.id,
        responseType: context.type,
      },
      'Stored enhanced message relationship'
    );
  }

  /**
   * Generate context summary from message content
   * @param {string} content - Message content
   * @returns {string} Summarized context
   */
  generateContextSummary(content) {
    if (!content) return 'No content';

    const cleaned = content.replace(/[<@#&!>]/g, '').trim();
    if (cleaned.length <= ENHANCED_CONFIG.MAX_CONTEXT_SUMMARY_LENGTH) {
      return cleaned;
    }

    return cleaned.substring(0, ENHANCED_CONFIG.MAX_CONTEXT_SUMMARY_LENGTH - 3) + '...';
  }

  /**
   * Process message deletion with enhanced logic
   * @param {Object} deletedMessage - Deleted message object
   * @returns {Object} Processing result
   */
  async processDeletion(deletedMessage) {
    const userId = deletedMessage.author?.id;
    const messageId = deletedMessage.id;

    if (!userId || !messageId) {
      return { action: 'ignore', reason: 'invalid_message_data' };
    }

    // Get relationship if exists
    const relationship = this.relationships.get(messageId);
    if (!relationship) {
      logger.debug({ messageId }, 'No relationship found for deleted message');
      return { action: 'ignore', reason: 'no_relationship' };
    }

    // Update deletion history
    const deletionRecord = {
      deletedAt: Date.now(),
      timeSinceCreation: Date.now() - (deletedMessage.createdAt?.getTime() || Date.now()),
      messageContent: deletedMessage.content?.substring(0, 100) || '',
    };

    relationship.deletionHistory.push(deletionRecord);

    // Analyze deletion context
    const deletionContext = await this.analyzeDeletionContext(deletedMessage, relationship);

    // Determine response strategy
    const strategy = this.determineResponseStrategy(deletionContext);

    // Execute strategy
    const result = await this.executeStrategy(strategy, relationship, deletionContext);

    logger.info(
      {
        messageId,
        userId,
        strategy: strategy.action,
        result: result.success,
      },
      'Processed message deletion'
    );

    return result;
  }

  /**
   * Analyze deletion context to inform response strategy
   * @param {Object} deletedMessage - Deleted message
   * @param {Object} relationship - Message relationship
   * @returns {Object} Deletion context analysis
   */
  async analyzeDeletionContext(deletedMessage, relationship) {
    const userId = deletedMessage.author.id;
    const now = Date.now();

    // Get user deletion history
    const userStats = maliciousUserManager.getUserStats(userId);

    // Check for bulk deletions in time window
    if (!this.userDeletionWindows.has(userId)) {
      this.userDeletionWindows.set(userId, []);
    }

    const userDeletions = this.userDeletionWindows.get(userId);
    userDeletions.push(now);

    // Clean old entries
    const windowStart = now - ENHANCED_CONFIG.BULK_DELETION_WINDOW_MS;
    const recentDeletions = userDeletions.filter(timestamp => timestamp > windowStart);
    this.userDeletionWindows.set(userId, recentDeletions);

    const isRapidDeletion =
      relationship.deletionHistory[0]?.timeSinceCreation <
      ENHANCED_CONFIG.RAPID_DELETION_THRESHOLD_MS;
    const isBulkDeletion = recentDeletions.length >= ENHANCED_CONFIG.BULK_DELETION_THRESHOLD;
    const isFrequentDeleter = userStats.totalDeletions >= 5;
    const isOwner = maliciousUserManager.isOwner(userId);

    return {
      userId,
      messageId: deletedMessage.id,
      isOwner,
      isRapidDeletion,
      isBulkDeletion,
      isFrequentDeleter,
      totalDeletions: userStats.totalDeletions,
      recentDeletionCount: recentDeletions.length,
      relationship,
      userStats,
    };
  }

  /**
   * Determine appropriate response strategy based on context
   * @param {Object} deletionContext - Deletion context analysis
   * @returns {Object} Response strategy
   */
  determineResponseStrategy(deletionContext) {
    const {
      isOwner,
      isRapidDeletion,
      isBulkDeletion,
      isFrequentDeleter,
      totalDeletions,
      // recentDeletionCount is available but not used in current logic
    } = deletionContext;

    // Owner gets special treatment
    if (isOwner) {
      return {
        action: ENHANCED_CONFIG.STRATEGIES.UPDATE,
        template: 'owner_privilege',
        reason: 'owner_deletion',
      };
    }

    // Rapid deletion - likely accidental or spam
    if (isRapidDeletion) {
      return {
        action: ENHANCED_CONFIG.STRATEGIES.DELETE,
        template: 'rapid_deletion',
        reason: 'rapid_deletion_cleanup',
      };
    }

    // Bulk deletion - clean up conversation
    if (isBulkDeletion) {
      return {
        action: ENHANCED_CONFIG.STRATEGIES.DELETE,
        template: 'multiple_cleanup',
        createSummary: true,
        reason: 'bulk_deletion_cleanup',
      };
    }

    // Frequent deleter - escalate
    if (isFrequentDeleter) {
      return {
        action: ENHANCED_CONFIG.STRATEGIES.ESCALATE,
        template: 'frequent_deleter',
        reason: 'frequent_deletion_pattern',
      };
    }

    // Single deletion - update with context
    if (totalDeletions <= 3) {
      return {
        action: ENHANCED_CONFIG.STRATEGIES.UPDATE,
        template: 'contextual_single',
        reason: 'single_deletion_with_context',
      };
    }

    // Default - update with warning
    return {
      action: ENHANCED_CONFIG.STRATEGIES.UPDATE,
      template: 'contextual_single',
      reason: 'default_context_update',
    };
  }

  /**
   * Execute the determined response strategy
   * @param {Object} strategy - Response strategy
   * @param {Object} relationship - Message relationship
   * @param {Object} deletionContext - Deletion context
   * @returns {Object} Execution result
   */
  async executeStrategy(strategy, relationship, deletionContext) {
    try {
      switch (strategy.action) {
        case ENHANCED_CONFIG.STRATEGIES.UPDATE:
          return await this.updateBotMessage(strategy, relationship, deletionContext);

        case ENHANCED_CONFIG.STRATEGIES.DELETE:
          return await this.deleteBotMessage(strategy, relationship, deletionContext);

        case ENHANCED_CONFIG.STRATEGIES.ESCALATE:
          return await this.escalateAndCleanup(strategy, relationship, deletionContext);

        default:
          return { success: false, reason: 'unknown_strategy' };
      }
    } catch (error) {
      logger.error(
        {
          error,
          strategy: strategy.action,
          messageId: relationship.userMessageId,
        },
        'Error executing deletion strategy'
      );

      return { success: false, error: error.message };
    }
  }

  /**
   * Update bot message with contextual information
   * @param {Object} strategy - Response strategy
   * @param {Object} relationship - Message relationship
   * @param {Object} deletionContext - Deletion context
   * @returns {Object} Update result
   */
  async updateBotMessage(strategy, relationship, deletionContext) {
    const template = this.getTemplate(strategy.template, relationship.context.responseType);
    const updatedContent = this.formatTemplate(template, relationship, deletionContext);

    try {
      await relationship.botMessage.edit(updatedContent);

      // Link to WebUI tracking
      await maliciousUserManager.linkDeletedMessageToBotResponse(
        relationship.userMessageId,
        relationship.botMessageId
      );

      // Clean up relationship
      this.relationships.delete(relationship.userMessageId);

      return { success: true, action: 'updated', content: updatedContent };
    } catch (error) {
      logger.error(
        {
          error,
          botMessageId: relationship.botMessageId,
        },
        'Failed to update bot message'
      );

      return { success: false, error: error.message };
    }
  }

  /**
   * Delete bot message and optionally create summary
   * @param {Object} strategy - Response strategy
   * @param {Object} relationship - Message relationship
   * @param {Object} deletionContext - Deletion context
   * @returns {Object} Deletion result
   */
  async deleteBotMessage(strategy, relationship, deletionContext) {
    try {
      // Delete the bot message
      await relationship.botMessage.delete();

      // Create summary notification if requested
      if (strategy.createSummary) {
        const summaryContent = this.createCleanupSummary(relationship, deletionContext);
        await relationship.botMessage.channel.send(summaryContent);
      }

      // Clean up relationship
      this.relationships.delete(relationship.userMessageId);

      return {
        success: true,
        action: 'deleted',
        summaryCreated: !!strategy.createSummary,
      };
    } catch (error) {
      logger.error(
        {
          error,
          botMessageId: relationship.botMessageId,
        },
        'Failed to delete bot message'
      );

      return { success: false, error: error.message };
    }
  }

  /**
   * Escalate to logging and clean up
   * @param {Object} strategy - Response strategy
   * @param {Object} relationship - Message relationship
   * @param {Object} deletionContext - Deletion context
   * @returns {Object} Escalation result
   */
  async escalateAndCleanup(strategy, relationship, deletionContext) {
    // Log for manual review
    logger.warn(
      {
        userId: deletionContext.userId,
        totalDeletions: deletionContext.totalDeletions,
        messageId: relationship.userMessageId,
        botMessageId: relationship.botMessageId,
        context: relationship.context.summary,
      },
      'Escalated frequent deleter - cleaning up silently'
    );

    try {
      // Delete bot message silently
      await relationship.botMessage.delete();

      // Clean up relationship
      this.relationships.delete(relationship.userMessageId);

      return { success: true, action: 'escalated_and_cleaned' };
    } catch (error) {
      logger.error(
        {
          error,
          botMessageId: relationship.botMessageId,
        },
        'Failed to cleanup after escalation'
      );

      return { success: false, error: error.message };
    }
  }

  /**
   * Get appropriate template for response type
   * @param {string} templateCategory - Template category
   * @param {string} responseType - Response type
   * @returns {string} Template string
   */
  getTemplate(templateCategory, responseType) {
    const templates = ENHANCED_TEMPLATES[templateCategory];
    if (!templates) return ENHANCED_TEMPLATES.contextual_single.default;

    return (
      templates[responseType] || templates.default || templates.respectful || templates.warning
    );
  }

  /**
   * Format template with relationship and context data
   * @param {string} template - Template string
   * @param {Object} relationship - Message relationship
   * @param {Object} deletionContext - Deletion context
   * @returns {string} Formatted content
   */
  formatTemplate(template, relationship, deletionContext) {
    return template
      .replace('{username}', relationship.userInfo.username)
      .replace('{summary}', relationship.context.summary)
      .replace('{context}', relationship.context.summary)
      .replace('{imageContext}', relationship.context.imageContext || 'image request')
      .replace('{functionType}', relationship.context.functionType || 'function call')
      .replace('{conversationTheme}', relationship.context.conversationTheme || 'conversation')
      .replace('{count}', deletionContext.totalDeletions)
      .replace('{deleteCount}', deletionContext.totalDeletions);
  }

  /**
   * Create cleanup summary for bulk deletions
   * @param {Object} relationship - Message relationship
   * @param {Object} deletionContext - Deletion context
   * @returns {string} Summary content
   */
  createCleanupSummary(relationship, deletionContext) {
    const template = ENHANCED_TEMPLATES.multiple_cleanup.notification;
    return this.formatTemplate(template, relationship, {
      ...deletionContext,
      lastContext: relationship.context.summary,
    });
  }

  /**
   * Get relationship by message ID
   * @param {string} messageId - Message ID
   * @returns {Object|null} Relationship object or null
   */
  getRelationship(messageId) {
    return this.relationships.get(messageId) || null;
  }

  /**
   * Clean up old relationships (called periodically)
   * @param {number} maxAge - Maximum age in milliseconds
   */
  cleanupOldRelationships(maxAge = 24 * 60 * 60 * 1000) {
    // 24 hours default
    const cutoff = Date.now() - maxAge;
    let cleanedCount = 0;

    for (const [messageId, relationship] of this.relationships.entries()) {
      if (relationship.createdAt < cutoff) {
        this.relationships.delete(messageId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info({ cleanedCount }, 'Cleaned up old message relationships');
    }
  }

  /**
   * Get statistics about current relationships
   * @returns {Object} Statistics
   */
  getStatistics() {
    return {
      totalRelationships: this.relationships.size,
      userDeletionWindows: this.userDeletionWindows.size,
      bulkOperationQueueSize: this.bulkOperationQueue.length,
    };
  }
}

// Export singleton instance
const enhancedMessageManager = new EnhancedMessageRelationshipManager();

module.exports = {
  enhancedMessageManager,
  ENHANCED_CONFIG,
  ENHANCED_TEMPLATES,
};
