/**
 * Custom Error Classes for ChimpGPT
 *
 * Provides structured error handling with context and proper error types
 * for better debugging and error reporting.
 *
 * @module Errors
 */

/**
 * Base error class for ChimpGPT application errors
 */
class ChimpGPTError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    this.timestamp = new Date().toISOString();

    // Maintain proper stack trace (Node.js)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging/API responses
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

/**
 * Authentication and authorization errors
 */
class AuthorizationError extends ChimpGPTError {
  constructor(message = 'Access denied', context = {}) {
    super(message, context);
    this.statusCode = 403;
  }
}

/**
 * Resource not found errors
 */
class NotFoundError extends ChimpGPTError {
  constructor(message = 'Resource not found', context = {}) {
    super(message, context);
    this.statusCode = 404;
  }
}

/**
 * Input validation errors
 */
class ValidationError extends ChimpGPTError {
  constructor(message = 'Invalid input', context = {}) {
    super(message, context);
    this.statusCode = 400;
  }
}

/**
 * Rate limiting errors
 */
class RateLimitError extends ChimpGPTError {
  constructor(message = 'Rate limit exceeded', context = {}) {
    super(message, context);
    this.statusCode = 429;
  }
}

/**
 * External service errors (OpenAI, Discord API, etc.)
 */
class ExternalServiceError extends ChimpGPTError {
  constructor(message = 'External service error', context = {}) {
    super(message, context);
    this.statusCode = 502;
  }
}

/**
 * Configuration errors
 */
class ConfigurationError extends ChimpGPTError {
  constructor(message = 'Configuration error', context = {}) {
    super(message, context);
    this.statusCode = 500;
  }
}

/**
 * Security-related errors
 */
class SecurityError extends ChimpGPTError {
  constructor(message = 'Security violation detected', context = {}) {
    super(message, context);
    this.statusCode = 403;
  }
}

/**
 * Performance and resource errors
 */
class ResourceError extends ChimpGPTError {
  constructor(message = 'Resource exhausted', context = {}) {
    super(message, context);
    this.statusCode = 503;
  }
}

/**
 * Database and storage errors
 */
class StorageError extends ChimpGPTError {
  constructor(message = 'Storage operation failed', context = {}) {
    super(message, context);
    this.statusCode = 500;
  }
}

/**
 * Create appropriate error instance based on error type
 * @param {string} type - Error type
 * @param {string} message - Error message
 * @param {Object} context - Additional context
 * @returns {ChimpGPTError} Appropriate error instance
 */
function createError(type, message, context = {}) {
  const errorClasses = {
    auth: AuthorizationError,
    authorization: AuthorizationError,
    notfound: NotFoundError,
    not_found: NotFoundError,
    validation: ValidationError,
    ratelimit: RateLimitError,
    rate_limit: RateLimitError,
    external: ExternalServiceError,
    service: ExternalServiceError,
    config: ConfigurationError,
    configuration: ConfigurationError,
    security: SecurityError,
    resource: ResourceError,
    storage: StorageError,
    database: StorageError,
  };

  const ErrorClass = errorClasses[type.toLowerCase()] || ChimpGPTError;
  return new ErrorClass(message, context);
}

/**
 * Check if error is a ChimpGPT application error
 * @param {Error} error - Error to check
 * @returns {boolean} True if ChimpGPT error
 */
function isChimpGPTError(error) {
  return error instanceof ChimpGPTError;
}

/**
 * Extract safe error details for client responses
 * @param {Error} error - Error to process
 * @returns {Object} Safe error details
 */
function getSafeErrorDetails(error) {
  if (isChimpGPTError(error)) {
    return {
      name: error.name,
      message: error.message,
      statusCode: error.statusCode || 500,
      timestamp: error.timestamp,
      // Only include context if it doesn't contain sensitive data
      context: error.context?.safe ? error.context : undefined,
    };
  }

  // For non-ChimpGPT errors, return generic message
  return {
    name: 'InternalError',
    message: 'An internal error occurred',
    statusCode: 500,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  ChimpGPTError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ExternalServiceError,
  ConfigurationError,
  SecurityError,
  ResourceError,
  StorageError,
  createError,
  isChimpGPTError,
  getSafeErrorDetails,
};
