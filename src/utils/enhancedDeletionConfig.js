/**
 * Enhanced Deletion System Configuration and Migration Helpers
 *
 * Provides configuration validation, migration assistance, and environment
 * setup helpers for the Enhanced Message Deletion Management System.
 *
 * @module EnhancedDeletionConfig
 */

const { createLogger } = require('../core/logger');
const fs = require('fs').promises;
const path = require('path');

const logger = createLogger('enhancedDeletionConfig');

/**
 * Default configuration values for the enhanced deletion system
 */
const DEFAULT_CONFIG = {
  // Core system toggles
  ENHANCED_MESSAGE_MANAGEMENT: true,
  USE_CONTEXT_EXTRACTION: true,

  // Detection thresholds
  RAPID_DELETE_THRESHOLD_MS: 30000, // 30 seconds
  BULK_DELETION_THRESHOLD: 2, // messages
  BULK_DELETION_WINDOW_MS: 10 * 60 * 1000, // 10 minutes

  // Regular user limits
  MAX_DELETIONS_PER_HOUR: 3,
  MAX_DELETIONS_PER_DAY: 10,

  // Owner limits (more lenient)
  OWNER_MAX_DELETIONS_PER_HOUR: 10,
  OWNER_MAX_DELETIONS_PER_DAY: 30,

  // Data storage and retention
  ENABLE_WEBUI_TRACKING: true,
  STORE_DELETED_MESSAGE_CONTENT: true,
  MAX_STORED_CONTENT_LENGTH: 2000,
  CLEANUP_AFTER_DAYS: 30,

  // Performance and cleanup
  CLEANUP_INTERVAL_MINUTES: 60,
  RELATIONSHIP_CLEANUP_HOURS: 24,
  CONTEXT_CACHE_TTL_MINUTES: 60,

  // Rate limiting for operations
  DISCORD_API_DELAY_MS: 1000,
  MAX_BULK_OPERATIONS: 10,

  // Template system
  DELETION_TEMPLATES: {
    contextual_single: {
      default: '💭 **{username}** removed their message. *Context: {summary}*',
      answer:
        '💭 **{username}** asked about something but removed their question. *Context: {summary}*',
      image:
        '🎨 **{username}** requested an image but removed their request. *Theme: {imageContext}*',
      function:
        '⚙️ **{username}** made a {functionType} request but removed it. *Context: {summary}*',
    },
    multiple_cleanup: {
      notification:
        '🧹 Cleaned up conversation thread after **{username}** removed {count} messages. *Last topic: {lastContext}*',
    },
    rapid_deletion: {
      cleanup: '🗑️ Rapid deletion detected - cleaning up conversation thread.',
    },
    frequent_deleter: {
      warning: '⚠️ **{username}** has deleted {deleteCount} messages recently. *Latest: {context}*',
    },
    owner_privilege: {
      respectful: '👑 **{username}** (Owner) removed their message. *Context preserved: {context}*',
    },
  },
};

/**
 * Required environment variables for the enhanced deletion system
 */
const REQUIRED_ENV_VARS = ['DISCORD_BOT_TOKEN', 'OWNER_ID'];

/**
 * Optional environment variables with defaults
 */
const OPTIONAL_ENV_VARS = {
  ENHANCED_MESSAGE_MANAGEMENT: 'true',
  USE_CONTEXT_EXTRACTION: 'true',
  RAPID_DELETE_THRESHOLD_MS: '30000',
  BULK_DELETION_THRESHOLD: '2',
  BULK_DELETION_WINDOW_MS: '600000',
  MAX_DELETIONS_PER_HOUR: '3',
  MAX_DELETIONS_PER_DAY: '10',
  OWNER_MAX_DELETIONS_PER_HOUR: '10',
  OWNER_MAX_DELETIONS_PER_DAY: '30',
  CLEANUP_AFTER_DAYS: '30',
  MAX_STORED_CONTENT_LENGTH: '2000',
};

/**
 * Configuration validation results
 */
class ConfigValidationResult {
  constructor() {
    this.valid = true;
    this.errors = [];
    this.warnings = [];
    this.suggestions = [];
    this.migrationNeeded = false;
    this.config = {};
  }

  addError(message, field = null) {
    this.valid = false;
    this.errors.push({ message, field, type: 'error' });
  }

  addWarning(message, field = null) {
    this.warnings.push({ message, field, type: 'warning' });
  }

  addSuggestion(message, field = null) {
    this.suggestions.push({ message, field, type: 'suggestion' });
  }

  needsMigration() {
    this.migrationNeeded = true;
  }
}

/**
 * Enhanced Deletion System Configuration Manager
 */
class EnhancedDeletionConfigManager {
  constructor() {
    this.configPath = path.join(__dirname, '..', 'data', 'enhancedDeletionConfig.json');
  }

  /**
   * Validate the current configuration
   * @param {Object} env - Environment variables (defaults to process.env)
   * @returns {ConfigValidationResult} Validation result
   */
  validateConfiguration(env = process.env) {
    const result = new ConfigValidationResult();

    try {
      // Check required environment variables
      this.validateRequiredEnvVars(env, result);

      // Validate numeric values
      this.validateNumericValues(env, result);

      // Validate boolean values
      this.validateBooleanValues(env, result);

      // Check for deprecated configuration
      this.checkDeprecatedConfig(env, result);

      // Validate file system permissions
      this.validateFileSystemPermissions(result);

      // Build final configuration
      result.config = this.buildConfiguration(env);

      // Check for optimization opportunities
      this.checkOptimizationOpportunities(result.config, result);

      logger.info(
        {
          valid: result.valid,
          errors: result.errors.length,
          warnings: result.warnings.length,
          suggestions: result.suggestions.length,
        },
        'Configuration validation completed'
      );
    } catch (error) {
      result.addError(`Configuration validation failed: ${error.message}`);
      logger.error({ error }, 'Error during configuration validation');
    }

    return result;
  }

  /**
   * Validate required environment variables
   */
  validateRequiredEnvVars(env, result) {
    for (const varName of REQUIRED_ENV_VARS) {
      if (!env[varName]) {
        result.addError(`Required environment variable ${varName} is not set`, varName);
      }
    }

    // Validate specific required values
    if (env.OWNER_ID && !/^\d+$/.test(env.OWNER_ID)) {
      result.addError('OWNER_ID must be a valid Discord user ID (numeric)', 'OWNER_ID');
    }
  }

  /**
   * Validate numeric configuration values
   */
  validateNumericValues(env, result) {
    const numericFields = {
      RAPID_DELETE_THRESHOLD_MS: { min: 1000, max: 300000, default: 30000 },
      BULK_DELETION_THRESHOLD: { min: 2, max: 10, default: 2 },
      BULK_DELETION_WINDOW_MS: { min: 60000, max: 3600000, default: 600000 },
      MAX_DELETIONS_PER_HOUR: { min: 1, max: 100, default: 3 },
      MAX_DELETIONS_PER_DAY: { min: 1, max: 1000, default: 10 },
      OWNER_MAX_DELETIONS_PER_HOUR: { min: 1, max: 1000, default: 10 },
      OWNER_MAX_DELETIONS_PER_DAY: { min: 1, max: 10000, default: 30 },
      CLEANUP_AFTER_DAYS: { min: 1, max: 365, default: 30 },
      MAX_STORED_CONTENT_LENGTH: { min: 100, max: 10000, default: 2000 },
    };

    for (const [fieldName, config] of Object.entries(numericFields)) {
      const value = env[fieldName];
      if (value !== undefined) {
        const numValue = parseInt(value, 10);
        if (isNaN(numValue)) {
          result.addError(`${fieldName} must be a valid number`, fieldName);
        } else if (numValue < config.min || numValue > config.max) {
          result.addError(
            `${fieldName} must be between ${config.min} and ${config.max} (got ${numValue})`,
            fieldName
          );
        }
      }
    }

    // Validate logical relationships
    if (env.MAX_DELETIONS_PER_HOUR && env.MAX_DELETIONS_PER_DAY) {
      const hourly = parseInt(env.MAX_DELETIONS_PER_HOUR, 10);
      const daily = parseInt(env.MAX_DELETIONS_PER_DAY, 10);
      if (!isNaN(hourly) && !isNaN(daily) && daily < hourly) {
        result.addWarning(
          'MAX_DELETIONS_PER_DAY should be greater than or equal to MAX_DELETIONS_PER_HOUR',
          'MAX_DELETIONS_PER_DAY'
        );
      }
    }
  }

  /**
   * Validate boolean configuration values
   */
  validateBooleanValues(env, result) {
    const booleanFields = [
      'ENHANCED_MESSAGE_MANAGEMENT',
      'USE_CONTEXT_EXTRACTION',
      'ENABLE_WEBUI_TRACKING',
      'STORE_DELETED_MESSAGE_CONTENT',
    ];

    for (const fieldName of booleanFields) {
      const value = env[fieldName];
      if (value !== undefined && !['true', 'false', '1', '0'].includes(value.toLowerCase())) {
        result.addError(
          `${fieldName} must be 'true', 'false', '1', or '0' (got '${value}')`,
          fieldName
        );
      }
    }
  }

  /**
   * Check for deprecated configuration options
   */
  checkDeprecatedConfig(env, result) {
    const deprecatedFields = {
      OLD_DELETION_TRACKING: 'Use ENHANCED_MESSAGE_MANAGEMENT instead',
      SIMPLE_DELETION_MODE: 'Enhanced deletion management is now the default',
      LEGACY_MESSAGE_HANDLING: 'Legacy handling is deprecated in favor of enhanced system',
    };

    for (const [deprecated, replacement] of Object.entries(deprecatedFields)) {
      if (env[deprecated]) {
        result.addWarning(`${deprecated} is deprecated. ${replacement}`, deprecated);
        result.needsMigration();
      }
    }
  }

  /**
   * Validate file system permissions
   */
  validateFileSystemPermissions(result) {
    try {
      // Check if we can create the data directory
      result.addSuggestion(
        'Ensure the data directory has proper write permissions for storing deletion records',
        'filesystem'
      );
    } catch (error) {
      result.addError(`Cannot access data directory: ${error.message}`, 'filesystem');
    }
  }

  /**
   * Build final configuration from environment and defaults
   */
  buildConfiguration(env) {
    const config = { ...DEFAULT_CONFIG };

    // Override with environment variables
    for (const [key, defaultValue] of Object.entries(OPTIONAL_ENV_VARS)) {
      const envValue = env[key];
      if (envValue !== undefined) {
        // Convert string values to appropriate types
        if (defaultValue === 'true' || defaultValue === 'false') {
          config[key] = ['true', '1'].includes(envValue.toLowerCase());
        } else if (!isNaN(defaultValue)) {
          config[key] = parseInt(envValue, 10);
        } else {
          config[key] = envValue;
        }
      }
    }

    // Add required values
    config.OWNER_ID = env.OWNER_ID;
    config.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN ? '[REDACTED]' : undefined;

    return config;
  }

  /**
   * Check for optimization opportunities
   */
  checkOptimizationOpportunities(config, result) {
    // Performance suggestions
    if (config.MAX_STORED_CONTENT_LENGTH > 5000) {
      result.addSuggestion(
        'Consider reducing MAX_STORED_CONTENT_LENGTH for better memory usage',
        'MAX_STORED_CONTENT_LENGTH'
      );
    }

    if (config.CLEANUP_AFTER_DAYS > 90) {
      result.addSuggestion(
        'Long retention periods may impact performance. Consider reducing CLEANUP_AFTER_DAYS',
        'CLEANUP_AFTER_DAYS'
      );
    }

    // Security suggestions
    if (config.MAX_DELETIONS_PER_HOUR > 10) {
      result.addSuggestion(
        'High deletion limits may reduce malicious behavior detection effectiveness',
        'MAX_DELETIONS_PER_HOUR'
      );
    }

    // Feature suggestions
    if (!config.USE_CONTEXT_EXTRACTION) {
      result.addSuggestion(
        'Enable USE_CONTEXT_EXTRACTION for better deletion context analysis',
        'USE_CONTEXT_EXTRACTION'
      );
    }
  }

  /**
   * Generate migration script for deprecated configurations
   * @param {ConfigValidationResult} validationResult - Validation result
   * @returns {string} Migration script content
   */
  generateMigrationScript(validationResult) {
    if (!validationResult.migrationNeeded) {
      return '# No migration needed - configuration is up to date\n';
    }

    const script = [
      '#!/bin/bash',
      '# Enhanced Deletion System Configuration Migration Script',
      '# Generated automatically - review before running',
      '',
      'echo "Starting Enhanced Deletion System configuration migration..."',
      '',
    ];

    // Generate migration commands based on warnings
    for (const warning of validationResult.warnings) {
      if (warning.message.includes('deprecated')) {
        script.push(`# TODO: Remove deprecated ${warning.field} from .env file`);
        script.push(`# ${warning.message}`);
        script.push('');
      }
    }

    // Add recommended configuration
    script.push('# Recommended configuration for Enhanced Deletion System:');
    script.push('cat >> .env << EOF');

    for (const [key, defaultValue] of Object.entries(OPTIONAL_ENV_VARS)) {
      script.push(`${key}=${defaultValue}`);
    }

    script.push('EOF');
    script.push('');
    script.push('echo "Migration completed. Please review your .env file and restart the bot."');

    return script.join('\n');
  }

  /**
   * Save configuration to file
   * @param {Object} config - Configuration to save
   * @returns {Promise<boolean>} Success status
   */
  async saveConfiguration(config) {
    try {
      const configData = {
        version: '2.0.0',
        generatedAt: new Date().toISOString(),
        config,
        metadata: {
          system: 'Enhanced Message Deletion Management',
          description: 'Auto-generated configuration file',
        },
      };

      // Ensure data directory exists
      const dataDir = path.dirname(this.configPath);
      await fs.mkdir(dataDir, { recursive: true });

      // Save configuration
      await fs.writeFile(this.configPath, JSON.stringify(configData, null, 2));

      logger.info({ configPath: this.configPath }, 'Configuration saved successfully');
      return true;
    } catch (error) {
      logger.error({ error, configPath: this.configPath }, 'Failed to save configuration');
      return false;
    }
  }

  /**
   * Load configuration from file
   * @returns {Promise<Object|null>} Loaded configuration or null
   */
  async loadConfiguration() {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      const configData = JSON.parse(data);

      logger.info(
        {
          version: configData.version,
          generatedAt: configData.generatedAt,
        },
        'Configuration loaded from file'
      );

      return configData.config;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error({ error, configPath: this.configPath }, 'Failed to load configuration');
      }
      return null;
    }
  }

  /**
   * Run system health check
   * @returns {Promise<Object>} Health check result
   */
  async runHealthCheck() {
    const healthCheck = {
      timestamp: new Date().toISOString(),
      system: 'Enhanced Deletion System',
      status: 'healthy',
      checks: [],
      warnings: [],
      errors: [],
    };

    try {
      // Validate configuration
      const validation = this.validateConfiguration();
      if (!validation.valid) {
        healthCheck.status = 'unhealthy';
        healthCheck.errors.push(...validation.errors);
      }
      healthCheck.warnings.push(...validation.warnings);

      // Check data directory access
      const dataDir = path.join(__dirname, '..', 'data');
      try {
        await fs.access(dataDir, fs.constants.W_OK);
        healthCheck.checks.push('Data directory writable: ✅');
      } catch (error) {
        healthCheck.status = 'unhealthy';
        healthCheck.errors.push(`Data directory not writable: ${error.message}`);
      }

      // Check required modules
      const requiredModules = [
        '../utils/maliciousUserManager',
        '../utils/enhancedMessageManager',
        '../utils/contextExtractionService',
        '../utils/deletionTestingInterface',
      ];

      for (const module of requiredModules) {
        try {
          require(module);
          healthCheck.checks.push(`Module ${module}: ✅`);
        } catch (error) {
          healthCheck.status = 'unhealthy';
          healthCheck.errors.push(`Module ${module} failed to load: ${error.message}`);
        }
      }

      logger.info(
        {
          status: healthCheck.status,
          checks: healthCheck.checks.length,
          warnings: healthCheck.warnings.length,
          errors: healthCheck.errors.length,
        },
        'Enhanced deletion system health check completed'
      );
    } catch (error) {
      healthCheck.status = 'error';
      healthCheck.errors.push(`Health check failed: ${error.message}`);
      logger.error({ error }, 'Health check error');
    }

    return healthCheck;
  }
}

// Export singleton instance
const configManager = new EnhancedDeletionConfigManager();

module.exports = {
  EnhancedDeletionConfigManager,
  ConfigValidationResult,
  DEFAULT_CONFIG,
  REQUIRED_ENV_VARS,
  OPTIONAL_ENV_VARS,
  configManager,
};
