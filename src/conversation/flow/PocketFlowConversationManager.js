const { createLogger } = require('../../core/logger');
const IndividualConversationFlow = require('./flows/IndividualConversationFlow');
const BlendedConversationFlow = require('./flows/BlendedConversationFlow');
const CommandFlow = require('./flows/CommandFlow');

const logger = createLogger('PocketFlowConversationManager');

class PocketFlowConversationManager {
  constructor(openaiClient, functionCallProcessor, commandHandler, options = {}) {
    this.openaiClient = openaiClient;
    this.functionCallProcessor = functionCallProcessor;
    this.commandHandler = commandHandler;

    this.options = {
      enableParallelTesting: false,
      cleanupInterval: 5 * 60 * 1000, // 5 minutes
      maxConcurrentFlows: 10,
      ...options,
    };

    this.flows = {
      individual: new IndividualConversationFlow(
        openaiClient,
        functionCallProcessor,
        options.flows?.individual
      ),
      blended: new BlendedConversationFlow(
        openaiClient,
        functionCallProcessor,
        options.flows?.blended
      ),
      command: new CommandFlow(commandHandler, options.flows?.command),
    };

    this.activeFlows = new Map();
    this.stats = {
      totalProcessed: 0,
      successfulResponses: 0,
      errors: 0,
      flowUsage: {
        individual: 0,
        blended: 0,
        command: 0,
      },
      avgResponseTime: 0,
      responseTimes: [],
    };

    this.setupCleanupInterval();
  }

  async processMessage(message, context = {}) {
    const startTime = Date.now();
    const messageId = message.id;
    const userId = message.author?.id;

    try {
      if (this.activeFlows.size >= this.options.maxConcurrentFlows) {
        throw new Error('Maximum concurrent flows exceeded');
      }

      const flowType = this.determineFlowType(message, context);
      const messageData = {
        message,
        context,
        timestamp: startTime,
      };

      this.activeFlows.set(messageId, {
        type: flowType,
        userId,
        startTime,
        messageId,
      });

      logger.debug(`Processing message with ${flowType} flow`, {
        messageId,
        userId,
        content: message.content?.substring(0, 50),
      });

      let result;
      switch (flowType) {
        case 'command':
          result = await this.flows.command.processCommand(messageData);
          break;
        case 'blended':
          result = await this.flows.blended.processMessage(messageData);
          break;
        case 'individual':
        default:
          result = await this.flows.individual.processMessage(messageData);
          break;
      }

      const executionTime = Date.now() - startTime;
      this.updateStats(flowType, executionTime, true);

      logger.info(`Message processed successfully`, {
        messageId,
        flowType,
        executionTime,
        success: result.success,
      });

      return {
        ...result,
        flowType,
        messageId,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.updateStats('error', executionTime, false);

      logger.error('Error processing message', {
        messageId,
        userId,
        error: error.message,
        executionTime,
      });

      return {
        success: false,
        error: error.message,
        messageId,
        executionTime,
        flowType: 'error',
      };
    } finally {
      this.activeFlows.delete(messageId);
    }
  }

  determineFlowType(message, _context) {
    const content = message.content?.trim();

    if (!content) {
      return 'individual';
    }

    if (this.flows.command.isCommand(content)) {
      return 'command';
    }

    const isDM = message.channel?.type === 'DM';
    if (isDM) {
      return 'individual';
    }

    const channelId = message.channel?.id;
    if (channelId && this.shouldUseBlendedMode(channelId, message)) {
      return 'blended';
    }

    return 'individual';
  }

  shouldUseBlendedMode(channelId, message) {
    const blendedFlow = this.flows.blended;
    const channelActivity = blendedFlow.getChannelActivity(channelId);

    if (!channelActivity) {
      return false;
    }

    if (channelActivity.activeUserCount >= 3) {
      return true;
    }

    if (channelActivity.conversationVelocity === 'high') {
      return true;
    }

    if (message.content && message.content.length < 50 && channelActivity.recentMessageCount > 5) {
      return true;
    }

    return false;
  }

  updateStats(flowType, executionTime, success) {
    this.stats.totalProcessed++;

    if (success) {
      this.stats.successfulResponses++;
      if (this.stats.flowUsage[flowType] !== undefined) {
        this.stats.flowUsage[flowType]++;
      }
    } else {
      this.stats.errors++;
    }

    this.stats.responseTimes.push(executionTime);
    if (this.stats.responseTimes.length > 100) {
      this.stats.responseTimes.shift();
    }

    this.stats.avgResponseTime =
      this.stats.responseTimes.reduce((a, b) => a + b, 0) / this.stats.responseTimes.length;
  }

  getStats() {
    const individualStats = this.flows.individual.getFlowStats();
    const blendedStats = this.flows.blended.getFlowStats();

    return {
      manager: {
        ...this.stats,
        activeFlows: this.activeFlows.size,
        uptime: process.uptime(),
      },
      flows: {
        individual: individualStats,
        blended: blendedStats,
      },
    };
  }

  getDetailedStats() {
    const stats = this.getStats();

    return {
      ...stats,
      performance: {
        avgResponseTime: this.stats.avgResponseTime,
        minResponseTime: Math.min(...this.stats.responseTimes),
        maxResponseTime: Math.max(...this.stats.responseTimes),
        successRate:
          this.stats.totalProcessed > 0
            ? (this.stats.successfulResponses / this.stats.totalProcessed) * 100
            : 0,
      },
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024),
      },
      stores: {
        individual: this.flows.individual.getStore().getAll(),
        blended: this.flows.blended.getStore().getAll(),
      },
    };
  }

  async cleanup() {
    logger.info('Running PocketFlow cleanup');

    try {
      await Promise.all([
        this.flows.individual.cleanup(),
        this.flows.blended.cleanup(),
        this.flows.command.cleanup(),
      ]);

      const now = Date.now();
      const staleFlowThreshold = 60000; // 1 minute

      for (const [messageId, flowInfo] of this.activeFlows) {
        if (now - flowInfo.startTime > staleFlowThreshold) {
          logger.warn(`Removing stale flow`, { messageId, flowInfo });
          this.activeFlows.delete(messageId);
        }
      }

      logger.info('PocketFlow cleanup completed');
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }

  setupCleanupInterval() {
    setInterval(() => {
      this.cleanup().catch(error => {
        logger.error('Scheduled cleanup failed:', error);
      });
    }, this.options.cleanupInterval);
  }

  async shutdown() {
    logger.info('Shutting down PocketFlow conversation manager');

    try {
      await this.cleanup();

      this.activeFlows.clear();

      logger.info('PocketFlow conversation manager shutdown complete');
    } catch (error) {
      logger.error('Error during shutdown:', error);
    }
  }

  getActiveFlows() {
    return Array.from(this.activeFlows.entries()).map(([messageId, flowInfo]) => ({
      messageId,
      ...flowInfo,
      duration: Date.now() - flowInfo.startTime,
    }));
  }

  isProcessing(messageId) {
    return this.activeFlows.has(messageId);
  }

  getFlowInfo(messageId) {
    return this.activeFlows.get(messageId);
  }
}

module.exports = PocketFlowConversationManager;
