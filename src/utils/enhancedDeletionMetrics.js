/**
 * Enhanced Deletion System Metrics and Performance Monitoring
 *
 * Provides comprehensive metrics collection, performance monitoring,
 * and analytics for the Enhanced Message Deletion Management System.
 *
 * @module EnhancedDeletionMetrics
 */

const { createLogger } = require('../core/logger');
const { EventEmitter } = require('events');

const logger = createLogger('enhancedDeletionMetrics');

/**
 * Metrics collection and performance monitoring for Enhanced Deletion System
 */
class EnhancedDeletionMetrics extends EventEmitter {
  constructor() {
    super();
    this.metrics = {
      // System metrics
      system: {
        startTime: Date.now(),
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        averageResponseTime: 0,
        lastResetTime: Date.now(),
      },

      // Deletion processing metrics
      deletions: {
        total: 0,
        byStrategy: {
          UPDATE: 0,
          DELETE: 0,
          ESCALATE: 0,
          IGNORE: 0,
        },
        byType: {
          single: 0,
          bulk: 0,
          rapid: 0,
          frequent: 0,
          owner: 0,
        },
        responseTimeMs: {
          min: Infinity,
          max: 0,
          avg: 0,
          total: 0,
          count: 0,
        },
      },

      // Context extraction metrics
      contextExtraction: {
        total: 0,
        successful: 0,
        failed: 0,
        cacheHits: 0,
        cacheMisses: 0,
        byType: {
          question: 0,
          image_request: 0,
          function_call: 0,
          conversation: 0,
          unknown: 0,
        },
        processingTimeMs: {
          min: Infinity,
          max: 0,
          avg: 0,
          total: 0,
          count: 0,
        },
      },

      // Review system metrics
      reviews: {
        total: 0,
        byStatus: {
          pending_review: 0,
          approved: 0,
          flagged: 0,
          ignored: 0,
          banned: 0,
        },
        reprocessed: 0,
        discordActionsExecuted: 0,
        discordActionsFailed: 0,
      },

      // Admin interface metrics
      adminInterface: {
        commandsExecuted: 0,
        successfulCommands: 0,
        failedCommands: 0,
        byCommand: {},
        byUser: {},
        responseTimeMs: {
          min: Infinity,
          max: 0,
          avg: 0,
          total: 0,
          count: 0,
        },
      },

      // Performance metrics
      performance: {
        memoryUsage: {
          current: 0,
          peak: 0,
          average: 0,
          samples: [],
        },
        relationships: {
          active: 0,
          peak: 0,
          cleanedUp: 0,
        },
        userDeletionWindows: {
          active: 0,
          peak: 0,
        },
      },

      // Error tracking
      errors: {
        total: 0,
        byType: {},
        byComponent: {},
        recent: [],
      },
    };

    // Performance sampling
    this.performanceSampleInterval = null;
    this.startPerformanceSampling();

    // Emit initial metrics event
    this.emit('metricsUpdated', this.metrics);
  }

  /**
   * Record a deletion processing operation
   * @param {Object} operation - Operation details
   */
  recordDeletionProcessing(operation) {
    try {
      this.metrics.deletions.total++;
      this.metrics.system.totalOperations++;

      // Record by strategy
      if (
        operation.strategy &&
        this.metrics.deletions.byStrategy[operation.strategy] !== undefined
      ) {
        this.metrics.deletions.byStrategy[operation.strategy]++;
      }

      // Record by type
      if (operation.type && this.metrics.deletions.byType[operation.type] !== undefined) {
        this.metrics.deletions.byType[operation.type]++;
      }

      // Record timing if provided
      if (operation.responseTimeMs) {
        this.updateResponseTimeMetrics(
          this.metrics.deletions.responseTimeMs,
          operation.responseTimeMs
        );
      }

      if (operation.success) {
        this.metrics.system.successfulOperations++;
      } else {
        this.metrics.system.failedOperations++;
      }

      this.emit('deletionProcessed', {
        operation,
        metrics: this.metrics.deletions,
      });
    } catch (error) {
      this.recordError('metrics', 'recordDeletionProcessing', error);
    }
  }

  /**
   * Record context extraction operation
   * @param {Object} operation - Operation details
   */
  recordContextExtraction(operation) {
    try {
      this.metrics.contextExtraction.total++;

      if (operation.success) {
        this.metrics.contextExtraction.successful++;
      } else {
        this.metrics.contextExtraction.failed++;
      }

      // Record cache performance
      if (operation.cacheHit) {
        this.metrics.contextExtraction.cacheHits++;
      } else {
        this.metrics.contextExtraction.cacheMisses++;
      }

      // Record by type
      if (operation.type && this.metrics.contextExtraction.byType[operation.type] !== undefined) {
        this.metrics.contextExtraction.byType[operation.type]++;
      }

      // Record timing
      if (operation.processingTimeMs) {
        this.updateResponseTimeMetrics(
          this.metrics.contextExtraction.processingTimeMs,
          operation.processingTimeMs
        );
      }

      this.emit('contextExtractionRecorded', {
        operation,
        metrics: this.metrics.contextExtraction,
      });
    } catch (error) {
      this.recordError('metrics', 'recordContextExtraction', error);
    }
  }

  /**
   * Record review system operation
   * @param {Object} operation - Operation details
   */
  recordReviewOperation(operation) {
    try {
      this.metrics.reviews.total++;

      // Record by status
      if (operation.status && this.metrics.reviews.byStatus[operation.status] !== undefined) {
        this.metrics.reviews.byStatus[operation.status]++;
      }

      // Record special operations
      if (operation.reprocessed) {
        this.metrics.reviews.reprocessed++;
      }

      if (operation.discordActionExecuted) {
        this.metrics.reviews.discordActionsExecuted++;
      }

      if (operation.discordActionFailed) {
        this.metrics.reviews.discordActionsFailed++;
      }

      this.emit('reviewRecorded', {
        operation,
        metrics: this.metrics.reviews,
      });
    } catch (error) {
      this.recordError('metrics', 'recordReviewOperation', error);
    }
  }

  /**
   * Record admin interface command execution
   * @param {Object} command - Command details
   */
  recordAdminCommand(command) {
    try {
      this.metrics.adminInterface.commandsExecuted++;

      if (command.success) {
        this.metrics.adminInterface.successfulCommands++;
      } else {
        this.metrics.adminInterface.failedCommands++;
      }

      // Record by command type
      if (command.name) {
        if (!this.metrics.adminInterface.byCommand[command.name]) {
          this.metrics.adminInterface.byCommand[command.name] = 0;
        }
        this.metrics.adminInterface.byCommand[command.name]++;
      }

      // Record by user
      if (command.userId) {
        if (!this.metrics.adminInterface.byUser[command.userId]) {
          this.metrics.adminInterface.byUser[command.userId] = 0;
        }
        this.metrics.adminInterface.byUser[command.userId]++;
      }

      // Record timing
      if (command.responseTimeMs) {
        this.updateResponseTimeMetrics(
          this.metrics.adminInterface.responseTimeMs,
          command.responseTimeMs
        );
      }

      this.emit('adminCommandRecorded', {
        command,
        metrics: this.metrics.adminInterface,
      });
    } catch (error) {
      this.recordError('metrics', 'recordAdminCommand', error);
    }
  }

  /**
   * Update performance metrics
   * @param {Object} performance - Performance data
   */
  updatePerformanceMetrics(performance) {
    try {
      // Update memory usage
      if (performance.memoryUsage) {
        const memMetrics = this.metrics.performance.memoryUsage;
        memMetrics.current = performance.memoryUsage;
        memMetrics.peak = Math.max(memMetrics.peak, performance.memoryUsage);

        // Keep sliding window of samples for average calculation
        memMetrics.samples.push(performance.memoryUsage);
        if (memMetrics.samples.length > 100) {
          memMetrics.samples.shift();
        }
        memMetrics.average =
          memMetrics.samples.reduce((a, b) => a + b, 0) / memMetrics.samples.length;
      }

      // Update relationship metrics
      if (performance.relationships) {
        const relMetrics = this.metrics.performance.relationships;
        relMetrics.active = performance.relationships.active || 0;
        relMetrics.peak = Math.max(relMetrics.peak, relMetrics.active);
        if (performance.relationships.cleanedUp) {
          relMetrics.cleanedUp += performance.relationships.cleanedUp;
        }
      }

      // Update user deletion windows
      if (performance.userDeletionWindows) {
        const windowMetrics = this.metrics.performance.userDeletionWindows;
        windowMetrics.active = performance.userDeletionWindows.active || 0;
        windowMetrics.peak = Math.max(windowMetrics.peak, windowMetrics.active);
      }

      this.emit('performanceUpdated', {
        performance,
        metrics: this.metrics.performance,
      });
    } catch (error) {
      this.recordError('metrics', 'updatePerformanceMetrics', error);
    }
  }

  /**
   * Record an error
   * @param {string} component - Component where error occurred
   * @param {string} operation - Operation that failed
   * @param {Error} error - Error object
   */
  recordError(component, operation, error) {
    try {
      this.metrics.errors.total++;

      // Record by type
      const errorType = error.name || 'Unknown';
      if (!this.metrics.errors.byType[errorType]) {
        this.metrics.errors.byType[errorType] = 0;
      }
      this.metrics.errors.byType[errorType]++;

      // Record by component
      if (!this.metrics.errors.byComponent[component]) {
        this.metrics.errors.byComponent[component] = 0;
      }
      this.metrics.errors.byComponent[component]++;

      // Keep recent errors (last 50)
      const errorRecord = {
        timestamp: Date.now(),
        component,
        operation,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      };

      this.metrics.errors.recent.push(errorRecord);
      if (this.metrics.errors.recent.length > 50) {
        this.metrics.errors.recent.shift();
      }

      this.emit('errorRecorded', errorRecord);

      logger.error(
        {
          component,
          operation,
          error,
        },
        'Error recorded in metrics'
      );
    } catch (metricsError) {
      // Prevent infinite loop if error recording fails
      logger.error({ metricsError, originalError: error }, 'Failed to record error in metrics');
    }
  }

  /**
   * Update response time metrics
   * @param {Object} timeMetrics - Time metrics object to update
   * @param {number} responseTime - Response time in milliseconds
   */
  updateResponseTimeMetrics(timeMetrics, responseTime) {
    timeMetrics.min = Math.min(timeMetrics.min, responseTime);
    timeMetrics.max = Math.max(timeMetrics.max, responseTime);
    timeMetrics.total += responseTime;
    timeMetrics.count++;
    timeMetrics.avg = timeMetrics.total / timeMetrics.count;
  }

  /**
   * Start performance sampling
   */
  startPerformanceSampling() {
    this.performanceSampleInterval = setInterval(() => {
      try {
        const memUsage = process.memoryUsage();
        this.updatePerformanceMetrics({
          memoryUsage: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        });
      } catch (error) {
        this.recordError('metrics', 'performanceSampling', error);
      }
    }, 30000); // Sample every 30 seconds
  }

  /**
   * Stop performance sampling
   */
  stopPerformanceSampling() {
    if (this.performanceSampleInterval) {
      clearInterval(this.performanceSampleInterval);
      this.performanceSampleInterval = null;
    }
  }

  /**
   * Get current metrics snapshot
   * @param {boolean} includeDetails - Whether to include detailed breakdowns
   * @returns {Object} Metrics snapshot
   */
  getMetrics(includeDetails = true) {
    const snapshot = {
      timestamp: Date.now(),
      uptime: Date.now() - this.metrics.system.startTime,
      ...JSON.parse(JSON.stringify(this.metrics)),
    };

    if (!includeDetails) {
      // Remove detailed breakdowns for summary view
      delete snapshot.errors.recent;
      delete snapshot.performance.memoryUsage.samples;
    }

    return snapshot;
  }

  /**
   * Get system health summary
   * @returns {Object} Health summary
   */
  getHealthSummary() {
    const metrics = this.metrics;
    const uptime = Date.now() - metrics.system.startTime;

    const health = {
      status: 'healthy',
      timestamp: Date.now(),
      uptime,
      summary: {
        totalOperations: metrics.system.totalOperations,
        successRate:
          metrics.system.totalOperations > 0
            ? Math.round(
                (metrics.system.successfulOperations / metrics.system.totalOperations) * 100
              )
            : 100,
        errorRate:
          metrics.errors.total > 0
            ? Math.round((metrics.errors.total / metrics.system.totalOperations) * 100)
            : 0,
        averageMemoryMB: Math.round(metrics.performance.memoryUsage.average),
        activeRelationships: metrics.performance.relationships.active,
      },
      indicators: [],
    };

    // Health indicators
    if (health.summary.successRate < 95) {
      health.status = 'warning';
      health.indicators.push('Low success rate');
    }

    if (health.summary.errorRate > 5) {
      health.status = 'warning';
      health.indicators.push('High error rate');
    }

    if (health.summary.averageMemoryMB > 512) {
      health.status = 'warning';
      health.indicators.push('High memory usage');
    }

    if (metrics.errors.recent.length > 10) {
      health.status = 'warning';
      health.indicators.push('Recent errors detected');
    }

    return health;
  }

  /**
   * Reset metrics
   * @param {boolean} keepPeaks - Whether to keep peak values
   */
  resetMetrics(keepPeaks = true) {
    logger.info('Resetting Enhanced Deletion System metrics');

    const currentTime = Date.now();

    // Reset counters but optionally keep peaks
    this.metrics.system.totalOperations = 0;
    this.metrics.system.successfulOperations = 0;
    this.metrics.system.failedOperations = 0;
    this.metrics.system.lastResetTime = currentTime;

    this.metrics.deletions.total = 0;
    Object.keys(this.metrics.deletions.byStrategy).forEach(key => {
      this.metrics.deletions.byStrategy[key] = 0;
    });
    Object.keys(this.metrics.deletions.byType).forEach(key => {
      this.metrics.deletions.byType[key] = 0;
    });

    if (!keepPeaks) {
      this.metrics.deletions.responseTimeMs = {
        min: Infinity,
        max: 0,
        avg: 0,
        total: 0,
        count: 0,
      };
    }

    this.metrics.contextExtraction.total = 0;
    this.metrics.contextExtraction.successful = 0;
    this.metrics.contextExtraction.failed = 0;
    this.metrics.contextExtraction.cacheHits = 0;
    this.metrics.contextExtraction.cacheMisses = 0;
    Object.keys(this.metrics.contextExtraction.byType).forEach(key => {
      this.metrics.contextExtraction.byType[key] = 0;
    });

    this.metrics.reviews.total = 0;
    Object.keys(this.metrics.reviews.byStatus).forEach(key => {
      this.metrics.reviews.byStatus[key] = 0;
    });
    this.metrics.reviews.reprocessed = 0;
    this.metrics.reviews.discordActionsExecuted = 0;
    this.metrics.reviews.discordActionsFailed = 0;

    this.metrics.adminInterface.commandsExecuted = 0;
    this.metrics.adminInterface.successfulCommands = 0;
    this.metrics.adminInterface.failedCommands = 0;
    this.metrics.adminInterface.byCommand = {};
    this.metrics.adminInterface.byUser = {};

    this.metrics.errors.total = 0;
    this.metrics.errors.byType = {};
    this.metrics.errors.byComponent = {};
    this.metrics.errors.recent = [];

    if (!keepPeaks) {
      this.metrics.performance.memoryUsage.peak = 0;
      this.metrics.performance.relationships.peak = 0;
      this.metrics.performance.userDeletionWindows.peak = 0;
    }

    this.emit('metricsReset', { timestamp: currentTime, keepPeaks });
  }

  /**
   * Export metrics to JSON
   * @param {boolean} pretty - Whether to pretty-print JSON
   * @returns {string} JSON string
   */
  exportMetrics(pretty = true) {
    const metrics = this.getMetrics(true);
    return JSON.stringify(metrics, null, pretty ? 2 : 0);
  }

  /**
   * Generate metrics report
   * @returns {Object} Formatted metrics report
   */
  generateReport() {
    const metrics = this.getMetrics();
    const health = this.getHealthSummary();
    const uptime = Date.now() - metrics.system.startTime;

    return {
      title: 'Enhanced Deletion System Metrics Report',
      generatedAt: new Date().toISOString(),
      uptime: {
        milliseconds: uptime,
        readable: this.formatUptime(uptime),
      },
      health,
      performance: {
        totalOperations: metrics.system.totalOperations,
        successRate: `${health.summary.successRate}%`,
        errorRate: `${health.summary.errorRate}%`,
        averageMemoryUsage: `${health.summary.averageMemoryMB} MB`,
        peakMemoryUsage: `${Math.round(metrics.performance.memoryUsage.peak)} MB`,
      },
      deletions: {
        total: metrics.deletions.total,
        byStrategy: metrics.deletions.byStrategy,
        byType: metrics.deletions.byType,
        averageResponseTime: `${Math.round(metrics.deletions.responseTimeMs.avg)}ms`,
      },
      contextExtraction: {
        total: metrics.contextExtraction.total,
        successRate:
          metrics.contextExtraction.total > 0
            ? `${Math.round((metrics.contextExtraction.successful / metrics.contextExtraction.total) * 100)}%`
            : 'N/A',
        cacheHitRate:
          metrics.contextExtraction.cacheHits + metrics.contextExtraction.cacheMisses > 0
            ? `${Math.round((metrics.contextExtraction.cacheHits / (metrics.contextExtraction.cacheHits + metrics.contextExtraction.cacheMisses)) * 100)}%`
            : 'N/A',
      },
      reviews: {
        total: metrics.reviews.total,
        byStatus: metrics.reviews.byStatus,
        reprocessed: metrics.reviews.reprocessed,
        discordActionSuccessRate:
          metrics.reviews.discordActionsExecuted > 0
            ? `${Math.round(((metrics.reviews.discordActionsExecuted - metrics.reviews.discordActionsFailed) / metrics.reviews.discordActionsExecuted) * 100)}%`
            : 'N/A',
      },
      errors: {
        total: metrics.errors.total,
        byType: metrics.errors.byType,
        byComponent: metrics.errors.byComponent,
        recentCount: metrics.errors.recent.length,
      },
    };
  }

  /**
   * Format uptime duration
   * @param {number} ms - Uptime in milliseconds
   * @returns {string} Formatted uptime
   */
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Cleanup and shutdown
   */
  shutdown() {
    logger.info('Shutting down Enhanced Deletion System metrics');

    this.stopPerformanceSampling();
    this.removeAllListeners();

    // Final metrics snapshot
    const finalMetrics = this.getMetrics(false);
    logger.info(
      {
        totalOperations: finalMetrics.system.totalOperations,
        uptime: this.formatUptime(Date.now() - finalMetrics.system.startTime),
        successRate:
          finalMetrics.system.totalOperations > 0
            ? Math.round(
                (finalMetrics.system.successfulOperations / finalMetrics.system.totalOperations) *
                  100
              )
            : 100,
      },
      'Enhanced Deletion System metrics final summary'
    );
  }
}

// Export singleton instance
const metricsCollector = new EnhancedDeletionMetrics();

module.exports = {
  EnhancedDeletionMetrics,
  metricsCollector,
};
