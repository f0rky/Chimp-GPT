/**
 * Configuration Error Class for ChimpGPT
 *
 * This error class is used for errors related to configuration issues.
 *
 * @module ConfigError
 * @author Brett
 * @version 1.0.0
 */

const ChimpError = require('./ChimpError');

/**
 * Error class for configuration-related errors
 *
 * @class ConfigError
 * @extends ChimpError
 */
class ConfigError extends ChimpError {
  /**
   * Create a new ConfigError
   *
   * @param {string} message - Error message
   * @param {Object} options - Additional error options
   * @param {string} [options.configKey] - Configuration key that caused the error
   * @param {*} [options.configValue] - Configuration value that caused the error
   * @param {string} [options.requiredType] - Required type for the configuration value
   * @param {boolean} [options.missingRequired] - Whether a required configuration is missing
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code || 'CONFIG_ERROR',
      component: options.component || 'config',
    });

    // Add config-specific properties
    this.configKey = options.configKey;
    this.configValue = options.configValue;
    this.requiredType = options.requiredType;
    this.missingRequired = !!options.missingRequired;

    // Include config details in context
    this.context = {
      ...this.context,
      configKey: this.configKey,
      requiredType: this.requiredType,
      missingRequired: this.missingRequired,
    };
  }

  /**
   * Get a structured representation of the error for logging
   *
   * @returns {Object} Structured error object
   */
  toJSON() {
    const json = super.toJSON();
    return {
      ...json,
      configKey: this.configKey,
      configValue: this.sanitizeConfigValue(this.configValue),
      requiredType: this.requiredType,
      missingRequired: this.missingRequired,
    };
  }

  /**
   * Sanitize potentially sensitive configuration values for logging
   *
   * @param {*} value - Value to sanitize
   * @returns {*} Sanitized value
   */
  sanitizeConfigValue(value) {
    // Don't log potentially sensitive values
    const sensitiveKeys = ['TOKEN', 'KEY', 'SECRET', 'PASSWORD', 'AUTH', 'CREDENTIALS', 'PRIVATE'];

    if (this.configKey && sensitiveKeys.some(key => this.configKey.toUpperCase().includes(key))) {
      return '[REDACTED]';
    }

    return value;
  }
}

module.exports = ConfigError;
