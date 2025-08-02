/**
 * Enhanced Deletion System Initializer
 *
 * Handles startup initialization, configuration validation, and system
 * health checks for the Enhanced Message Deletion Management System.
 *
 * @module EnhancedDeletionInitializer
 */

const { createLogger } = require('../core/logger');
const { configManager } = require('./enhancedDeletionConfig');
const maliciousUserManager = require('./maliciousUserManager');

const logger = createLogger('enhancedDeletionInit');

/**
 * Enhanced Deletion System Initializer
 * Manages system startup and health monitoring
 */
class EnhancedDeletionInitializer {
  constructor() {
    this.initialized = false;
    this.configValid = false;
    this.healthCheckInterval = null;
  }

  /**
   * Initialize the Enhanced Deletion System
   * @param {Object} options - Initialization options
   * @param {Object} options.discordClient - Discord client instance
   * @param {boolean} options.validateConfig - Whether to validate configuration
   * @param {boolean} options.runHealthChecks - Whether to run periodic health checks
   * @param {number} options.healthCheckInterval - Health check interval in minutes
   * @returns {Promise<Object>} Initialization result
   */
  async initialize(options = {}) {
    const {
      discordClient = null,
      validateConfig = true,
      runHealthChecks = true,
      healthCheckInterval = 60, // minutes
    } = options;

    logger.info('Starting Enhanced Deletion System initialization...');

    const result = {
      success: false,
      configValid: false,
      systemHealthy: false,
      warnings: [],
      errors: [],
      components: {
        maliciousUserManager: false,
        enhancedMessageManager: false,
        contextExtractionService: false,
        deletionTestingInterface: false,
        discordMessageExecutor: false,
      },
    };

    try {
      // Step 1: Validate configuration
      if (validateConfig) {
        logger.info('Validating Enhanced Deletion System configuration...');
        const validation = configManager.validateConfiguration();

        result.configValid = validation.valid;
        result.warnings.push(...validation.warnings);
        result.errors.push(...validation.errors);

        if (!validation.valid) {
          logger.error(
            {
              errors: validation.errors,
              warnings: validation.warnings,
            },
            'Configuration validation failed'
          );

          // Save migration script if needed
          if (validation.migrationNeeded) {
            const migrationScript = configManager.generateMigrationScript(validation);
            logger.info('Migration script generated - check logs for details');
            logger.debug({ migrationScript }, 'Migration script content');
          }

          return result;
        }

        logger.info(
          {
            warnings: validation.warnings.length,
            suggestions: validation.suggestions.length,
          },
          'Configuration validation passed'
        );

        // Save validated configuration
        await configManager.saveConfiguration(validation.config);
      }

      // Step 2: Initialize core components
      logger.info('Initializing core components...');

      // Initialize malicious user manager
      try {
        await maliciousUserManager.init();
        result.components.maliciousUserManager = true;
        logger.info('Malicious User Manager initialized');
      } catch (error) {
        result.errors.push(`Malicious User Manager initialization failed: ${error.message}`);
        logger.error({ error }, 'Failed to initialize Malicious User Manager');
      }

      // Initialize enhanced message manager
      try {
        require('./enhancedMessageManager');
        // Enhanced message manager is initialized on first use
        result.components.enhancedMessageManager = true;
        logger.info('Enhanced Message Manager available');
      } catch (error) {
        result.errors.push(`Enhanced Message Manager initialization failed: ${error.message}`);
        logger.error({ error }, 'Failed to initialize Enhanced Message Manager');
      }

      // Initialize context extraction service
      try {
        require('./contextExtractionService');
        // Context extraction service is initialized on first use
        result.components.contextExtractionService = true;
        logger.info('Context Extraction Service available');
      } catch (error) {
        result.errors.push(`Context Extraction Service initialization failed: ${error.message}`);
        logger.error({ error }, 'Failed to initialize Context Extraction Service');
      }

      // Initialize deletion testing interface
      try {
        require('./deletionTestingInterface');
        // Testing interface is ready to use
        result.components.deletionTestingInterface = true;
        logger.info('Deletion Testing Interface available');
      } catch (error) {
        result.errors.push(`Deletion Testing Interface initialization failed: ${error.message}`);
        logger.error({ error }, 'Failed to initialize Deletion Testing Interface');
      }

      // Initialize Discord message executor (requires client)
      if (discordClient) {
        try {
          const { DiscordMessageExecutor } = require('./discordMessageExecutor');
          const _executor = new DiscordMessageExecutor(discordClient); // Initialize and store reference
          // Executor is initialized and ready for use
          result.components.discordMessageExecutor = true;
          logger.info('Discord Message Executor initialized');
        } catch (error) {
          result.errors.push(`Discord Message Executor initialization failed: ${error.message}`);
          logger.error({ error }, 'Failed to initialize Discord Message Executor');
        }
      } else {
        result.warnings.push(
          'Discord client not provided - message executor will be initialized on demand'
        );
      }

      // Step 3: Run system health check
      logger.info('Running system health check...');
      const healthCheck = await configManager.runHealthCheck();

      result.systemHealthy = healthCheck.status === 'healthy';
      result.warnings.push(...healthCheck.warnings.map(w => ({ message: w, type: 'health' })));
      result.errors.push(...healthCheck.errors.map(e => ({ message: e, type: 'health' })));

      if (!result.systemHealthy) {
        logger.warn(
          {
            status: healthCheck.status,
            errors: healthCheck.errors,
            warnings: healthCheck.warnings,
          },
          'System health check found issues'
        );
      }

      // Step 4: Set up periodic health checks
      if (runHealthChecks && healthCheckInterval > 0) {
        this.setupPeriodicHealthChecks(healthCheckInterval);
        logger.info({ intervalMinutes: healthCheckInterval }, 'Periodic health checks enabled');
      }

      // Determine overall success
      const criticalErrors = result.errors.filter(e =>
        typeof e === 'object' ? e.type !== 'health' : true
      );

      result.success = result.configValid && criticalErrors.length === 0;
      this.initialized = result.success;
      this.configValid = result.configValid;

      if (result.success) {
        logger.info(
          {
            components: Object.values(result.components).filter(Boolean).length,
            warnings: result.warnings.length,
            systemHealthy: result.systemHealthy,
          },
          'Enhanced Deletion System initialized successfully'
        );
      } else {
        logger.error(
          {
            errors: result.errors.length,
            warnings: result.warnings.length,
            configValid: result.configValid,
          },
          'Enhanced Deletion System initialization failed'
        );
      }

      return result;
    } catch (error) {
      result.errors.push(`Initialization failed: ${error.message}`);
      logger.error({ error }, 'Critical error during Enhanced Deletion System initialization');
      return result;
    }
  }

  /**
   * Set up periodic health checks
   * @param {number} intervalMinutes - Health check interval in minutes
   */
  setupPeriodicHealthChecks(intervalMinutes) {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(
      async () => {
        try {
          logger.debug('Running periodic health check...');
          const healthCheck = await configManager.runHealthCheck();

          if (healthCheck.status !== 'healthy') {
            logger.warn(
              {
                status: healthCheck.status,
                errors: healthCheck.errors,
                warnings: healthCheck.warnings,
              },
              'Periodic health check found issues'
            );
          } else {
            logger.debug('Periodic health check passed');
          }
        } catch (error) {
          logger.error({ error }, 'Error during periodic health check');
        }
      },
      intervalMinutes * 60 * 1000
    );
  }

  /**
   * Shutdown the Enhanced Deletion System
   * @returns {Promise<void>}
   */
  async shutdown() {
    logger.info('Shutting down Enhanced Deletion System...');

    try {
      // Clear health check interval
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      // Perform any necessary cleanup
      // Note: Individual components handle their own cleanup in their respective modules

      this.initialized = false;
      this.configValid = false;

      logger.info('Enhanced Deletion System shutdown completed');
    } catch (error) {
      logger.error({ error }, 'Error during Enhanced Deletion System shutdown');
    }
  }

  /**
   * Get system status
   * @returns {Object} Current system status
   */
  getStatus() {
    return {
      initialized: this.initialized,
      configValid: this.configValid,
      healthCheckActive: !!this.healthCheckInterval,
    };
  }

  /**
   * Validate that the system is ready for operation
   * @returns {Object} Readiness check result
   */
  checkReadiness() {
    const result = {
      ready: false,
      issues: [],
    };

    if (!this.initialized) {
      result.issues.push('System not initialized');
    }

    if (!this.configValid) {
      result.issues.push('Configuration validation failed');
    }

    // Check if core components are available
    try {
      require('./maliciousUserManager');
      require('./enhancedMessageManager');
      require('./contextExtractionService');
    } catch (error) {
      result.issues.push(`Core component missing: ${error.message}`);
    }

    result.ready = result.issues.length === 0;
    return result;
  }

  /**
   * Get system statistics
   * @returns {Promise<Object>} System statistics
   */
  async getStatistics() {
    try {
      const stats = {
        timestamp: new Date().toISOString(),
        system: 'Enhanced Message Deletion Management',
        initialized: this.initialized,
        configValid: this.configValid,
      };

      // Get malicious user manager stats
      if (this.initialized) {
        try {
          // Note: These would need to be implemented in maliciousUserManager
          stats.deletionStats = {
            totalDeletedMessages: 'N/A', // Would get from maliciousUserManager
            pendingReviews: 'N/A',
            processedReviews: 'N/A',
          };
        } catch (error) {
          stats.deletionStatsError = error.message;
        }
      }

      return stats;
    } catch (error) {
      logger.error({ error }, 'Error getting system statistics');
      return {
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Export singleton instance
const initializer = new EnhancedDeletionInitializer();

module.exports = {
  EnhancedDeletionInitializer,
  initializer,
};
