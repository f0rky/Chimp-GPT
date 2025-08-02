/**
 * Deletion Testing Administrative Interface
 *
 * Provides administrative commands and utilities for testing the enhanced
 * message deletion system, including reprocessing, simulation, and analysis.
 *
 * @module DeletionTestingInterface
 */

const { createLogger } = require('../core/logger');
const maliciousUserManager = require('./maliciousUserManager');
const { enhancedMessageManager } = require('./enhancedMessageManager');

const logger = createLogger('deletionTestingInterface');

/**
 * Administrative Interface for Deletion Testing
 * Owner-only commands for testing and debugging the enhanced deletion system
 */
class DeletionTestingInterface {
  constructor() {
    this.commands = new Map();
    this.setupCommands();
  }

  /**
   * Setup available administrative commands
   */
  setupCommands() {
    // Review management commands
    this.commands.set('list-pending', {
      description: 'List messages pending review',
      usage: '!admin deletion list-pending [limit]',
      handler: this.listPendingReviews.bind(this),
    });

    this.commands.set('review', {
      description: 'Review a specific message',
      usage: '!admin deletion review <messageId> <status> [notes]',
      handler: this.reviewMessage.bind(this),
    });

    this.commands.set('bulk-review', {
      description: 'Bulk review messages with filters',
      usage: '!admin deletion bulk-review <status> [filters]',
      handler: this.bulkReviewMessages.bind(this),
    });

    // Reprocessing commands
    this.commands.set('reprocess', {
      description: 'Reprocess a message to test deletion behavior',
      usage: '!admin deletion reprocess <messageId> [options]',
      handler: this.reprocessMessage.bind(this),
    });

    this.commands.set('bulk-reprocess', {
      description: 'Bulk reprocess messages for testing',
      usage: '!admin deletion bulk-reprocess [filters] [options]',
      handler: this.bulkReprocessMessages.bind(this),
    });

    this.commands.set('simulate', {
      description: 'Simulate deletion scenarios for testing',
      usage: '!admin deletion simulate <scenario> [options]',
      handler: this.simulateDeletionScenario.bind(this),
    });

    // Analysis commands
    this.commands.set('stats', {
      description: 'Get deletion system statistics',
      usage: '!admin deletion stats',
      handler: this.getSystemStats.bind(this),
    });

    this.commands.set('analyze', {
      description: 'Analyze deletion patterns',
      usage: '!admin deletion analyze [userId] [timeframe]',
      handler: this.analyzeDeletionPatterns.bind(this),
    });

    this.commands.set('export', {
      description: 'Export deletion data for analysis',
      usage: '!admin deletion export [format] [filters]',
      handler: this.exportDeletionData.bind(this),
    });

    // Help command
    this.commands.set('help', {
      description: 'Show available commands',
      usage: '!admin deletion help',
      handler: this.showHelp.bind(this),
    });
  }

  /**
   * Process administrative command
   * @param {string} requestingUserId - User requesting the command
   * @param {string} command - Command name
   * @param {Array} args - Command arguments
   * @param {Object} discordClient - Discord client for message operations (optional)
   * @returns {Object} Command result
   */
  async processCommand(requestingUserId, command, args = [], discordClient = null) {
    // Only allow owner access
    if (!maliciousUserManager.isOwner(requestingUserId)) {
      return {
        success: false,
        error: 'Access denied: Owner privileges required',
        isError: true,
      };
    }

    const cmdInfo = this.commands.get(command.toLowerCase());
    if (!cmdInfo) {
      return {
        success: false,
        error: `Unknown command: ${command}. Use 'help' to see available commands.`,
        isError: true,
      };
    }

    try {
      const result = await cmdInfo.handler(args, requestingUserId, discordClient);
      return {
        success: true,
        command,
        result,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error({ error, command, args, requestingUserId }, 'Error processing admin command');
      return {
        success: false,
        error: error.message,
        isError: true,
        command,
      };
    }
  }

  /**
   * List messages pending review
   */
  async listPendingReviews(args, requestingUserId) {
    const limit = parseInt(args[0], 10) || 20;
    const messages = maliciousUserManager.getDeletedMessagesForWebUI(requestingUserId, {
      status: 'pending_review',
    });

    const limited = messages.slice(0, limit);

    return {
      total: messages.length,
      showing: limited.length,
      messages: limited.map(msg => ({
        messageId: msg.messageId,
        userId: msg.userId,
        username: msg.username,
        content: msg.content.substring(0, 100),
        timestamp: new Date(msg.timestamp).toISOString(),
        isRapidDeletion: msg.isRapidDeletion,
        deletionCount: msg.deletionCount,
        channelName: msg.channelName,
      })),
    };
  }

  /**
   * Review a specific message
   */
  async reviewMessage(args, requestingUserId, discordClient) {
    if (args.length < 2) {
      throw new Error('Usage: review <messageId> <status> [notes]');
    }

    const [messageId, status] = args;
    const notes = args.slice(2).join(' ') || '';

    const result = await maliciousUserManager.updateDeletedMessageStatus(
      requestingUserId,
      messageId,
      status,
      notes,
      true, // allowReprocessing
      discordClient
    );

    return {
      messageId,
      status,
      notes,
      actionResult: result.actionResult,
      reviewHistory: result.reviewHistory.slice(-1)[0], // Latest review entry
    };
  }

  /**
   * Bulk review messages
   */
  async bulkReviewMessages(args, requestingUserId, discordClient) {
    if (args.length < 1) {
      throw new Error('Usage: bulk-review <status> [userId] [rapid_only]');
    }

    const [status] = args;
    const filters = {};

    if (args[1]) filters.userId = args[1];
    if (args[2] === 'rapid_only') filters.isRapidDeletion = true;

    const messages = maliciousUserManager.getDeletedMessagesForWebUI(requestingUserId, {
      status: 'pending_review',
      ...filters,
    });

    const results = [];
    for (const message of messages.slice(0, 10)) {
      // Limit to 10 for safety
      try {
        const result = await maliciousUserManager.updateDeletedMessageStatus(
          requestingUserId,
          message.messageId,
          status,
          `Bulk review: ${status}`,
          true, // allowReprocessing
          discordClient
        );
        results.push({ messageId: message.messageId, success: true, action: result.actionResult });
      } catch (error) {
        results.push({ messageId: message.messageId, success: false, error: error.message });
      }
    }

    const successful = results.filter(r => r.success).length;
    return {
      processed: results.length,
      successful,
      failed: results.length - successful,
      status,
      filters,
      results,
    };
  }

  /**
   * Reprocess a message for testing
   */
  async reprocessMessage(args, requestingUserId) {
    if (args.length < 1) {
      throw new Error('Usage: reprocess <messageId> [forceBulk] [forceRapid]');
    }

    const [messageId] = args;
    const options = {};

    if (args.includes('forceBulk')) options.forceBulkDeletion = true;
    if (args.includes('forceRapid')) options.forceRapidDeletion = true;

    const result = await maliciousUserManager.reprocessDeletedMessage(
      requestingUserId,
      messageId,
      options
    );

    return {
      messageId,
      reprocessingOptions: options,
      originalStatus: result.originalMessage.status,
      reprocessingResult: {
        action: result.reprocessingResult.action,
        success: result.reprocessingResult.success,
        reason: result.reprocessingResult.reason,
      },
      reprocessCount: result.originalMessage.reprocessCount,
    };
  }

  /**
   * Bulk reprocess messages
   */
  async bulkReprocessMessages(args, requestingUserId) {
    const filters = {};
    const options = {};

    // Parse arguments for filters and options
    args.forEach(arg => {
      if (arg === 'rapid_only') filters.isRapidDeletion = true;
      if (arg === 'forceBulk') options.forceBulkDeletion = true;
      if (arg === 'forceRapid') options.forceRapidDeletion = true;
      if (arg.startsWith('user=')) filters.userId = arg.split('=')[1];
      if (arg.startsWith('max=')) options.maxCount = parseInt(arg.split('=')[1], 10);
    });

    const result = await maliciousUserManager.bulkReprocessMessages(
      requestingUserId,
      filters,
      options
    );

    return result;
  }

  /**
   * Simulate deletion scenarios
   */
  async simulateDeletionScenario(args, _requestingUserId) {
    if (args.length < 1) {
      throw new Error('Usage: simulate <scenario> [userId]');
    }

    const [scenario] = args;
    const userId = args[1] || 'test_user_123';

    const scenarios = {
      'single-delete': () => this.simulateSingleDeletion(userId),
      'bulk-delete': () => this.simulateBulkDeletion(userId),
      'rapid-delete': () => this.simulateRapidDeletion(userId),
      'frequent-deleter': () => this.simulateFrequentDeleter(userId),
      'owner-delete': () => this.simulateOwnerDeletion(),
    };

    const simulator = scenarios[scenario];
    if (!simulator) {
      throw new Error(
        `Unknown scenario: ${scenario}. Available: ${Object.keys(scenarios).join(', ')}`
      );
    }

    return await simulator();
  }

  /**
   * Get system statistics
   */
  async getSystemStats(args, requestingUserId) {
    const reprocessingStats = maliciousUserManager.getReprocessingStats(requestingUserId);
    const enhancedStats = enhancedMessageManager.getStatistics();

    const allMessages = maliciousUserManager.getDeletedMessagesForWebUI(requestingUserId);
    const recentMessages = allMessages.filter(
      msg => Date.now() - msg.timestamp < 24 * 60 * 60 * 1000 // Last 24 hours
    );

    return {
      reprocessingStats,
      enhancedStats,
      messageStats: {
        total: allMessages.length,
        recent24h: recentMessages.length,
        byStatus: this.groupBy(allMessages, 'status'),
        byChannel: this.groupBy(allMessages, 'channelName'),
        rapidDeletions: allMessages.filter(msg => msg.isRapidDeletion).length,
      },
      systemHealth: {
        cacheSize: enhancedStats.totalRelationships,
        userDeletionWindows: enhancedStats.userDeletionWindows,
        bulkOperationQueue: enhancedStats.bulkOperationQueueSize,
      },
    };
  }

  /**
   * Analyze deletion patterns
   */
  async analyzeDeletionPatterns(args, requestingUserId) {
    const userId = args[0];
    const timeframe = args[1] || '7d'; // 7 days default

    const timeframeDays = {
      '1d': 1,
      '3d': 3,
      '7d': 7,
      '30d': 30,
    };
    const days = timeframeDays[timeframe] || 7;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    let messages = maliciousUserManager.getDeletedMessagesForWebUI(requestingUserId);
    messages = messages.filter(msg => msg.timestamp >= cutoff);

    if (userId) {
      messages = messages.filter(msg => msg.userId === userId);
    }

    // Analyze patterns
    const analysis = {
      timeframe: `${days} days`,
      totalMessages: messages.length,
      uniqueUsers: new Set(messages.map(msg => msg.userId)).size,
      patterns: {
        rapidDeletions: messages.filter(msg => msg.isRapidDeletion).length,
        bulkDeletions: this.identifyBulkDeletions(messages),
        frequentDeleters: this.identifyFrequentDeleters(messages),
        peakHours: this.analyzePeakHours(messages),
        channelDistribution: this.groupBy(messages, 'channelName'),
        statusDistribution: this.groupBy(messages, 'status'),
      },
    };

    if (userId) {
      const userMessages = messages.filter(msg => msg.userId === userId);
      analysis.userSpecific = {
        totalDeletions: userMessages.length,
        averageTimeToDelete: this.calculateAverageTimeToDelete(userMessages),
        deletionFrequency: this.calculateDeletionFrequency(userMessages),
        contentPatterns: this.analyzeContentPatterns(userMessages),
      };
    }

    return analysis;
  }

  /**
   * Export deletion data
   */
  async exportDeletionData(args, requestingUserId) {
    const format = args[0] || 'json';
    const filters = {};

    // Parse filter arguments
    args.slice(1).forEach(arg => {
      if (arg.startsWith('status=')) filters.status = arg.split('=')[1];
      if (arg.startsWith('user=')) filters.userId = arg.split('=')[1];
      if (arg.startsWith('days=')) {
        const days = parseInt(arg.split('=')[1], 10);
        filters.startDate = Date.now() - days * 24 * 60 * 60 * 1000;
      }
    });

    const messages = maliciousUserManager.getDeletedMessagesForWebUI(requestingUserId, filters);

    const exportData = {
      exportInfo: {
        timestamp: new Date().toISOString(),
        format,
        filters,
        totalRecords: messages.length,
        exportedBy: requestingUserId,
      },
      messages: messages.map(msg => ({
        messageId: msg.messageId,
        userId: msg.userId,
        username: msg.username,
        content: msg.content,
        timestamp: new Date(msg.timestamp).toISOString(),
        status: msg.status,
        isRapidDeletion: msg.isRapidDeletion,
        deletionCount: msg.deletionCount,
        channelName: msg.channelName,
        reviewHistory: msg.reviewHistory || [],
        reprocessCount: msg.reprocessCount || 0,
        enhancedContext: msg.enhancedContext,
      })),
    };

    if (format === 'csv') {
      return this.convertToCSV(exportData.messages);
    }

    return exportData;
  }

  /**
   * Show available commands
   */
  async showHelp() {
    const commandList = Array.from(this.commands.entries()).map(([name, info]) => ({
      command: name,
      description: info.description,
      usage: info.usage,
    }));

    return {
      title: 'Deletion Testing Administrative Interface',
      description: 'Commands for testing and managing the enhanced message deletion system',
      commands: commandList,
      examples: [
        '!admin deletion list-pending 10',
        '!admin deletion review msg123 approved "Legitimate deletion"',
        '!admin deletion reprocess msg123 forceBulk',
        '!admin deletion simulate bulk-delete user123',
        '!admin deletion stats',
        '!admin deletion analyze user123 7d',
      ],
    };
  }

  // Helper methods for simulations and analysis

  async simulateSingleDeletion(userId) {
    const mockMessage = this.createMockDeletedMessage(userId, 'How do I use React hooks?');
    return await enhancedMessageManager.processDeletion(mockMessage);
  }

  async simulateBulkDeletion(userId) {
    // Simulate 3 deletions in quick succession
    const results = [];
    for (let i = 0; i < 3; i++) {
      const mockMessage = this.createMockDeletedMessage(userId, `Test message ${i + 1}`);
      const result = await enhancedMessageManager.processDeletion(mockMessage);
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
    }
    return { simulationType: 'bulk-deletion', results };
  }

  async simulateRapidDeletion(userId) {
    const mockMessage = this.createMockDeletedMessage(userId, 'Quick message', Date.now() - 10000); // 10s ago
    return await enhancedMessageManager.processDeletion(mockMessage);
  }

  async simulateFrequentDeleter(userId) {
    // Add to deletion history to simulate frequent deleter
    for (let i = 0; i < 6; i++) {
      await maliciousUserManager.recordDeletion(
        userId,
        `sim_msg_${i}`,
        'test_channel',
        `Simulated message ${i}`,
        30000 + i * 1000
      );
    }

    const mockMessage = this.createMockDeletedMessage(userId, 'Another deleted message');
    return await enhancedMessageManager.processDeletion(mockMessage);
  }

  async simulateOwnerDeletion() {
    const ownerId = process.env.OWNER_ID;
    const mockMessage = this.createMockDeletedMessage(ownerId, 'Owner test message');
    return await enhancedMessageManager.processDeletion(mockMessage);
  }

  createMockDeletedMessage(userId, content, createdTime = Date.now() - 60000) {
    return {
      id: `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      author: {
        id: userId,
        username: `user_${userId.substr(-4)}`,
      },
      content,
      createdAt: new Date(createdTime),
      channelId: 'test_channel_123',
    };
  }

  // Analysis helper methods

  groupBy(array, key) {
    return array.reduce((groups, item) => {
      const value = item[key];
      groups[value] = (groups[value] || 0) + 1;
      return groups;
    }, {});
  }

  identifyBulkDeletions(messages) {
    const userGroups = this.groupBy(messages, 'userId');
    let bulkCount = 0;

    Object.values(userGroups).forEach(count => {
      if (count >= 3) bulkCount++;
    });

    return bulkCount;
  }

  identifyFrequentDeleters(messages) {
    const userCounts = this.groupBy(messages, 'userId');
    return Object.entries(userCounts).filter(([, count]) => count >= 5).length;
  }

  analyzePeakHours(messages) {
    const hours = messages.map(msg => new Date(msg.timestamp).getHours());
    const hourCounts = this.groupBy(hours, h => h);

    return Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour, count]) => ({ hour: parseInt(hour, 10), count }));
  }

  calculateAverageTimeToDelete(messages) {
    const times = messages
      .filter(msg => msg.messageCreatedAt && msg.timestamp)
      .map(msg => msg.timestamp - msg.messageCreatedAt);

    return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  }

  calculateDeletionFrequency(messages) {
    if (messages.length < 2) return 0;

    const timestamps = messages.map(msg => msg.timestamp).sort();
    const intervals = [];

    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    return intervals.reduce((a, b) => a + b, 0) / intervals.length;
  }

  analyzeContentPatterns(messages) {
    const lengths = messages.map(msg => msg.content.length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;

    const commonWords = messages
      .map(msg => msg.content.toLowerCase().split(/\s+/))
      .flat()
      .reduce((counts, word) => {
        counts[word] = (counts[word] || 0) + 1;
        return counts;
      }, {});

    const topWords = Object.entries(commonWords)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      averageLength: Math.round(avgLength),
      topWords,
    };
  }

  convertToCSV(data) {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]).filter(
      key => !['reviewHistory', 'enhancedContext'].includes(key)
    );

    const csvRows = [
      headers.join(','),
      ...data.map(row =>
        headers
          .map(header => {
            const value = row[header];
            return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
          })
          .join(',')
      ),
    ];

    return csvRows.join('\n');
  }
}

// Export singleton instance
const deletionTestingInterface = new DeletionTestingInterface();

module.exports = {
  deletionTestingInterface,
  DeletionTestingInterface,
};
