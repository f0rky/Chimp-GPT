/**
 * Base Error Class for ChimpGPT
 *
 * This is the base error class for all custom errors in ChimpGPT.
 * It extends the native Error class and adds additional properties
 * for better error tracking and handling.
 *
 * @module ChimpError
 * @author Brett
 * @version 1.0.0
 */

/**
 * Base error class for all ChimpGPT errors
 *
 * @class ChimpError
 * @extends Error
 */
class ChimpError extends Error {
  /**
   * Create a new ChimpError
   *
   * @param {string} message - Error message
   * @param {Object} options - Additional error options
   * @param {string} [options.code] - Error code
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {Object} [options.context] - Additional context for the error
   * @param {string} [options.component] - Component where the error occurred
   * @param {string} [options.operation] - Operation that was being performed
   */
  constructor(message, options = {}) {
    super(message);

    // Set the name to the class name
    this.name = this.constructor.name;

    // Add additional properties
    this.code = options.code || 'UNKNOWN_ERROR';
    this.cause = options.cause;
    this.context = options.context || {};
    this.component = options.component || 'unknown';
    this.operation = options.operation || 'unknown';
    this.timestamp = new Date().toISOString();

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get a structured representation of the error for logging
   *
   * @returns {Object} Structured error object
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      component: this.component,
      operation: this.operation,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
      cause: this.cause
        ? this.cause.toJSON
          ? this.cause.toJSON()
          : this.cause.message
        : undefined,
    };
  }

  /**
   * Get a string representation of the error
   *
   * @returns {string} String representation
   */
  toString() {
    return `${this.name} [${this.code}]: ${this.message} (${this.component}/${this.operation})`;
  }
}

module.exports = ChimpError;
