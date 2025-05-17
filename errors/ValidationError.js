/**
 * Validation Error Class for ChimpGPT
 * 
 * This error class is used for errors related to input validation.
 * 
 * @module ValidationError
 * @author Brett
 * @version 1.0.0
 */

const ChimpError = require('./ChimpError');

/**
 * Error class for validation-related errors
 * 
 * @class ValidationError
 * @extends ChimpError
 */
class ValidationError extends ChimpError {
  /**
   * Create a new ValidationError
   * 
   * @param {string} message - Error message
   * @param {Object} options - Additional error options
   * @param {string} [options.field] - Field that failed validation
   * @param {*} [options.value] - Value that failed validation
   * @param {string} [options.constraint] - Constraint that was violated
   * @param {Object} [options.validationErrors] - Detailed validation errors
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code || 'VALIDATION_ERROR',
      component: options.component || 'validation'
    });
    
    // Add validation-specific properties
    this.field = options.field;
    this.value = options.value;
    this.constraint = options.constraint;
    this.validationErrors = options.validationErrors || [];
    
    // Include validation details in context
    this.context = {
      ...this.context,
      field: this.field,
      constraint: this.constraint,
      validationErrors: this.validationErrors
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
      field: this.field,
      value: this.sanitizeValue(this.value),
      constraint: this.constraint,
      validationErrors: this.validationErrors
    };
  }

  /**
   * Sanitize potentially sensitive values for logging
   * 
   * @param {*} value - Value to sanitize
   * @returns {*} Sanitized value
   */
  sanitizeValue(value) {
    // Don't log potentially sensitive values
    const sensitiveFields = [
      'password', 'token', 'key', 'secret', 'auth', 'credentials', 'private'
    ];
    
    if (this.field && sensitiveFields.some(field => 
      this.field.toLowerCase().includes(field.toLowerCase()))) {
      return '[REDACTED]';
    }
    
    return value;
  }

  /**
   * Add a validation error
   * 
   * @param {string} field - Field with error
   * @param {string} message - Error message
   * @param {*} [value] - Invalid value
   * @returns {ValidationError} This error instance for chaining
   */
  addError(field, message, value) {
    this.validationErrors.push({
      field,
      message,
      value: this.sanitizeValue(value)
    });
    
    return this;
  }
}

module.exports = ValidationError;
