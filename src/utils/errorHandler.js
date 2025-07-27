/**
 * Standardized Error Handling Utility for ChimpGPT
 *
 * This module provides consistent error handling patterns across the application,
 * including error classification, logging, and response formatting.
 *
 * @module ErrorHandler
 * @author Claude Code Assistant
 * @version 1.0.0
 */

const { createLogger } = require('../core/logger');
const { hashForLogging } = require('../../utils/securityUtils');

const logger = createLogger('error-handler');

/**
 * Error severity levels
 */
const ERROR_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

/**
 * Error categories for classification
 */
const ERROR_CATEGORIES = {
  VALIDATION: 'validation',
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  NETWORK: 'network',
  EXTERNAL_API: 'external_api',
  DATABASE: 'database',
  FILE_SYSTEM: 'file_system',
  RATE_LIMIT: 'rate_limit',
  SECURITY: 'security',
  CONFIGURATION: 'configuration',
  BUSINESS_LOGIC: 'business_logic',
  INTERNAL: 'internal',
  UNKNOWN: 'unknown',
};

/**
 * Standardized error class with enhanced context
 */
class ChimpError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ChimpError';
    this.timestamp = new Date().toISOString();
    this.category = options.category || ERROR_CATEGORIES.UNKNOWN;
    this.severity = options.severity || ERROR_SEVERITY.MEDIUM;
    this.context = options.context || {};
    this.operation = options.operation || 'unknown';
    this.userId = options.userId || null;
    this.correlationId = options.correlationId || this._generateCorrelationId();
    this.isOperational = options.isOperational !== false; // Operational by default
    this.statusCode = options.statusCode || null;
    this.originalError = options.originalError || null;
    this.code = options.code || null;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ChimpError);
    }
  }

  /**
   * Generate a unique correlation ID for error tracking
   * @returns {string} Correlation ID
   */
  _generateCorrelationId() {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Convert error to a loggable object (without sensitive data)
   * @returns {Object} Sanitized error object for logging
   */
  toLogObject() {
    return {
      name: this.name,
      message: this.message,
      timestamp: this.timestamp,
      category: this.category,
      severity: this.severity,
      operation: this.operation,
      correlationId: this.correlationId,
      isOperational: this.isOperational,
      statusCode: this.statusCode,
      // Hash sensitive context data
      contextHash: this.context ? hashForLogging(JSON.stringify(this.context)) : null,
      // Include user ID hash for tracking without exposing it
      userIdHash: this.userId ? hashForLogging(this.userId) : null,
      // Include original error info without sensitive data
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
        code: this.originalError.code,
      } : null,
    };
  }

  /**
   * Convert error to user-friendly message
   * @returns {string} User-friendly error message
   */
  toUserMessage() {
    const userMessages = {
      [ERROR_CATEGORIES.VALIDATION]: 'Invalid input provided. Please check your request and try again.',
      [ERROR_CATEGORIES.AUTHENTICATION]: 'Authentication failed. Please check your credentials.',
      [ERROR_CATEGORIES.AUTHORIZATION]: 'You do not have permission to perform this action.',
      [ERROR_CATEGORIES.NETWORK]: 'Network connection failed. Please try again later.',
      [ERROR_CATEGORIES.EXTERNAL_API]: 'External service is temporarily unavailable. Please try again later.',
      [ERROR_CATEGORIES.DATABASE]: 'Data storage error occurred. Please try again later.',
      [ERROR_CATEGORIES.FILE_SYSTEM]: 'File operation failed. Please try again later.',
      [ERROR_CATEGORIES.RATE_LIMIT]: 'Rate limit exceeded. Please wait before trying again.',
      [ERROR_CATEGORIES.SECURITY]: 'Security validation failed. Please contact support if this persists.',
      [ERROR_CATEGORIES.CONFIGURATION]: 'Service configuration error. Please contact support.',
      [ERROR_CATEGORIES.BUSINESS_LOGIC]: 'Request could not be processed due to business rules.',
      [ERROR_CATEGORIES.INTERNAL]: 'An internal error occurred. Please try again later.',
      [ERROR_CATEGORIES.UNKNOWN]: 'An unexpected error occurred. Please try again later.',
    };

    return userMessages[this.category] || userMessages[ERROR_CATEGORIES.UNKNOWN];
  }

  /**
   * Custom JSON serialization to include error message and other properties
   * @returns {Object} Serializable error object
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      timestamp: this.timestamp,
      category: this.category,
      severity: this.severity,
      context: this.context,
      operation: this.operation,
      userId: this.userId,
      correlationId: this.correlationId,
      isOperational: this.isOperational,
      statusCode: this.statusCode,
      originalError: this.originalError,
      code: this.code,
    };
  }
}

/**
 * Error handling wrapper for async functions
 * @param {Function} fn - Function to wrap
 * @param {Object} options - Error handling options
 * @returns {Function} Wrapped function
 */
function withErrorHandling(fn, options = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      const enhancedError = enhanceError(error, {
        operation: options.operation || fn.name || 'anonymous',
        category: options.category || ERROR_CATEGORIES.UNKNOWN,
        severity: options.severity || ERROR_SEVERITY.MEDIUM,
        context: options.context || {},
        ...options,
      });

      // Log the error
      logError(enhancedError);

      // Re-throw or handle based on configuration
      if (options.rethrow !== false) {
        throw enhancedError;
      }

      return options.fallbackValue || null;
    }
  };
}

/**
 * Enhance an existing error with additional context
 * @param {Error} error - Original error
 * @param {Object} options - Enhancement options
 * @returns {ChimpError} Enhanced error
 */
function enhanceError(error, options = {}) {
  if (error instanceof ChimpError) {
    // Already enhanced, just update context
    error.context = { ...error.context, ...options.context };
    return error;
  }

  // Create new enhanced error
  return new ChimpError(error.message, {
    ...options,
    originalError: error,
  });
}

/**
 * Classify error based on error properties
 * @param {Error} error - Error to classify
 * @returns {string} Error category
 */
function classifyError(error) {
  if (!error) return ERROR_CATEGORIES.UNKNOWN;

  const message = error.message?.toLowerCase() || '';
  const code = error.code?.toLowerCase() || '';
  const name = error.name?.toLowerCase() || '';

  // Network errors
  if (code.includes('econnrefused') || code.includes('enotfound') || code.includes('etimedout')) {
    return ERROR_CATEGORIES.NETWORK;
  }

  // Authentication/Authorization
  if (message.includes('unauthorized') || message.includes('authentication') || error.status === 401) {
    return ERROR_CATEGORIES.AUTHENTICATION;
  }
  if (message.includes('forbidden') || message.includes('permission') || error.status === 403) {
    return ERROR_CATEGORIES.AUTHORIZATION;
  }

  // Rate limiting
  if (message.includes('rate limit') || message.includes('too many requests') || error.status === 429) {
    return ERROR_CATEGORIES.RATE_LIMIT;
  }

  // Validation
  if (message.includes('validation') || message.includes('invalid') || error.status === 400) {
    return ERROR_CATEGORIES.VALIDATION;
  }

  // File system
  if (code.includes('enoent') || code.includes('eacces') || message.includes('file') || message.includes('directory')) {
    return ERROR_CATEGORIES.FILE_SYSTEM;
  }

  // External API errors
  if (message.includes('openai') || message.includes('api') || message.includes('service unavailable')) {
    return ERROR_CATEGORIES.EXTERNAL_API;
  }

  // Security
  if (message.includes('security') || message.includes('blocked') || message.includes('policy')) {
    return ERROR_CATEGORIES.SECURITY;
  }

  return ERROR_CATEGORIES.UNKNOWN;
}

/**
 * Determine error severity based on error properties
 * @param {Error} error - Error to assess
 * @returns {string} Error severity
 */
function determineSeverity(error) {
  if (!error) return ERROR_SEVERITY.LOW;

  // Critical errors
  if (error.message?.includes('EADDRINUSE') || 
      error.message?.includes('server') || 
      error.message?.includes('database connection')) {
    return ERROR_SEVERITY.CRITICAL;
  }

  // High severity
  if (error.message?.includes('security') || 
      error.message?.includes('unauthorized') ||
      error.status >= 500) {
    return ERROR_SEVERITY.HIGH;
  }

  // Medium severity
  if (error.status >= 400 || 
      error.message?.includes('validation') ||
      error.message?.includes('rate limit')) {
    return ERROR_SEVERITY.MEDIUM;
  }

  return ERROR_SEVERITY.LOW;
}

/**
 * Log error with appropriate level based on severity
 * @param {ChimpError|Error} error - Error to log
 * @param {Object} additionalContext - Additional context for logging
 */
function logError(error, additionalContext = {}) {
  const logObject = error instanceof ChimpError 
    ? error.toLogObject() 
    : {
        name: error.name,
        message: error.message,
        category: classifyError(error),
        severity: determineSeverity(error),
        stack: error.stack,
      };

  const context = { ...logObject, ...additionalContext };

  // Log at appropriate level based on severity
  switch (context.severity) {
    case ERROR_SEVERITY.CRITICAL:
      logger.fatal(context, 'Critical error occurred');
      break;
    case ERROR_SEVERITY.HIGH:
      logger.error(context, 'High severity error occurred');
      break;
    case ERROR_SEVERITY.MEDIUM:
      logger.warn(context, 'Medium severity error occurred');
      break;
    case ERROR_SEVERITY.LOW:
      logger.info(context, 'Low severity error occurred');
      break;
    default:
      logger.error(context, 'Unknown severity error occurred');
  }
}

/**
 * Handle Discord-specific errors
 * @param {Error} error - Discord error
 * @param {Object} context - Additional context
 * @returns {ChimpError} Enhanced Discord error
 */
function handleDiscordError(error, context = {}) {
  const category = error.code === 50013 ? ERROR_CATEGORIES.AUTHORIZATION :
                   error.code === 50001 ? ERROR_CATEGORIES.AUTHENTICATION :
                   error.code === 50035 ? ERROR_CATEGORIES.VALIDATION :
                   ERROR_CATEGORIES.EXTERNAL_API;

  const severity = error.code === 50035 ? ERROR_SEVERITY.LOW : ERROR_SEVERITY.MEDIUM;

  return new ChimpError(`Discord API Error: ${error.message}`, {
    category,
    severity,
    operation: 'discord_api',
    context: {
      discordCode: error.code,
      httpStatus: error.httpStatus,
      ...context,
    },
    originalError: error,
  });
}

/**
 * Handle OpenAI-specific errors
 * @param {Error} error - OpenAI error
 * @param {Object} context - Additional context
 * @returns {ChimpError} Enhanced OpenAI error
 */
function handleOpenAIError(error, context = {}) {
  const isRateLimit = error.status === 429 || error.message?.includes('rate limit');
  const isQuotaExceeded = error.message?.includes('quota') || error.message?.includes('billing');
  const isContentPolicy = error.message?.includes('content policy') || error.message?.includes('safety');

  const category = isRateLimit ? ERROR_CATEGORIES.RATE_LIMIT :
                   isQuotaExceeded ? ERROR_CATEGORIES.EXTERNAL_API :
                   isContentPolicy ? ERROR_CATEGORIES.SECURITY :
                   ERROR_CATEGORIES.EXTERNAL_API;

  const severity = isQuotaExceeded || isContentPolicy ? ERROR_SEVERITY.HIGH : ERROR_SEVERITY.MEDIUM;

  return new ChimpError(`OpenAI API Error: ${error.message}`, {
    category,
    severity,
    operation: 'openai_api',
    context: {
      openaiStatus: error.status,
      openaiCode: error.code,
      ...context,
    },
    originalError: error,
  });
}

/**
 * Specialized Error Classes for backward compatibility
 */

/**
 * API Error class
 */
class ApiError extends ChimpError {
  constructor(message, options = {}) {
    super(message, {
      category: ERROR_CATEGORIES.EXTERNAL_API,
      severity: ERROR_SEVERITY.MEDIUM,
      ...options,
    });
    
    this.name = 'ApiError';
    this.service = options.service || 'unknown';
    this.endpoint = options.endpoint || 'unknown';
    this.statusCode = options.statusCode;
    this.requestData = options.requestData;
    this.responseData = options.responseData;
    this.cause = options.cause || options.originalError;
  }

  /**
   * Custom JSON serialization for ApiError
   * @returns {Object} Serializable error object
   */
  toJSON() {
    const baseJson = super.toJSON();
    return {
      ...baseJson,
      service: this.service,
      endpoint: this.endpoint,
      requestData: this.requestData,
      responseData: this.responseData,
      cause: this.cause,
    };
  }
}

/**
 * Plugin Error class
 */
class PluginError extends ChimpError {
  constructor(message, options = {}) {
    super(message, {
      category: ERROR_CATEGORIES.BUSINESS_LOGIC,
      severity: ERROR_SEVERITY.MEDIUM,
      ...options,
    });
    
    this.name = 'PluginError';
    this.pluginName = options.pluginName || 'unknown';
    this.pluginVersion = options.pluginVersion;
    this.hookName = options.hookName;
    this.cause = options.cause || options.originalError;
  }
}

/**
 * Validation Error class
 */
class ValidationError extends ChimpError {
  constructor(message, options = {}) {
    super(message, {
      category: ERROR_CATEGORIES.VALIDATION,
      severity: ERROR_SEVERITY.LOW,
      ...options,
    });
    
    this.name = 'ValidationError';
    this.field = options.field;
    this.value = options.value;
    this.constraint = options.constraint;
    this.validationErrors = options.validationErrors || [];
  }
  
  addError(field, message) {
    this.validationErrors.push({ field, message });
  }
}

/**
 * Config Error class
 */
class ConfigError extends ChimpError {
  constructor(message, options = {}) {
    super(message, {
      category: ERROR_CATEGORIES.CONFIGURATION,
      severity: ERROR_SEVERITY.HIGH,
      ...options,
    });
    
    this.name = 'ConfigError';
    this.configKey = options.configKey;
    this.missingRequired = options.missingRequired;
    this.requiredType = options.requiredType;
  }
}

/**
 * Discord Error class (extends ApiError)
 */
class DiscordError extends ApiError {
  constructor(message, options = {}) {
    super(message, {
      service: 'discord',
      category: ERROR_CATEGORIES.EXTERNAL_API,
      severity: ERROR_SEVERITY.MEDIUM,
      ...options,
    });
    
    this.name = 'DiscordError';
    this.channelId = options.channelId;
    this.guildId = options.guildId;
    this.permissions = options.permissions;
  }
}

/**
 * Create an error instance based on the error type
 * @param {string} type - Error type
 * @param {string} message - Error message
 * @param {Object} options - Additional error options
 * @returns {ChimpError} Error instance
 */
function createError(type, message, options = {}) {
  switch (type.toLowerCase()) {
    case 'api':
      return new ApiError(message, options);
    case 'plugin':
      return new PluginError(message, options);
    case 'validation':
      return new ValidationError(message, options);
    case 'config':
      return new ConfigError(message, options);
    case 'discord':
      return new DiscordError(message, options);
    default:
      return new ChimpError(message, options);
  }
}

/**
 * Wrap an error in a ChimpError (for backward compatibility)
 * @param {Error} error - Original error
 * @param {string} message - Custom message
 * @param {Object} options - Additional error options
 * @returns {ChimpError} Wrapped error
 */
function wrapError(error, message, options = {}) {
  // If it's already a ChimpError, just return it
  if (error instanceof ChimpError) {
    return error;
  }

  // Create a new error with the original as the cause
  return new ChimpError(message || error.message, {
    ...options,
    originalError: error,
  });
}

/**
 * Safely execute an async operation with timeout
 * @param {Function} operation - Async operation to execute
 * @param {number} timeout - Timeout in milliseconds
 * @param {Object} options - Error handling options
 * @returns {Promise} Operation result or timeout error
 */
async function withTimeout(operation, timeout = 30000, options = {}) {
  return Promise.race([
    operation(),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new ChimpError('Operation timed out', {
          category: ERROR_CATEGORIES.INTERNAL,
          severity: ERROR_SEVERITY.MEDIUM,
          operation: options.operation || 'timeout_operation',
          context: { timeout },
        }));
      }, timeout);
    }),
  ]);
}

module.exports = {
  ChimpError,
  ApiError,
  PluginError,
  ValidationError,
  ConfigError,
  DiscordError,
  ERROR_SEVERITY,
  ERROR_CATEGORIES,
  withErrorHandling,
  enhanceError,
  classifyError,
  determineSeverity,
  logError,
  handleDiscordError,
  handleOpenAIError,
  withTimeout,
  createError,
  wrapError,
};