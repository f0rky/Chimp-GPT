/**
 * API Error Class for ChimpGPT
 * 
 * This error class is used for errors related to external API calls.
 * 
 * @module ApiError
 * @author Brett
 * @version 1.0.0
 */

const ChimpError = require('./ChimpError');

/**
 * Error class for API-related errors
 * 
 * @class ApiError
 * @extends ChimpError
 */
class ApiError extends ChimpError {
  /**
   * Create a new ApiError
   * 
   * @param {string} message - Error message
   * @param {Object} options - Additional error options
   * @param {string} [options.service] - API service name (e.g., 'openai', 'discord', 'weather')
   * @param {string} [options.endpoint] - API endpoint that was called
   * @param {number} [options.statusCode] - HTTP status code
   * @param {Object} [options.requestData] - Request data that was sent
   * @param {Object} [options.responseData] - Response data that was received
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code || 'API_ERROR',
      component: options.component || 'api'
    });
    
    // Add API-specific properties
    this.service = options.service || 'unknown';
    this.endpoint = options.endpoint || 'unknown';
    this.statusCode = options.statusCode;
    this.requestData = options.requestData;
    this.responseData = options.responseData;
    
    // Include API details in context
    this.context = {
      ...this.context,
      service: this.service,
      endpoint: this.endpoint,
      statusCode: this.statusCode
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
      service: this.service,
      endpoint: this.endpoint,
      statusCode: this.statusCode,
      // Include safe versions of request/response data
      requestData: this.requestData ? this.sanitizeData(this.requestData) : undefined,
      responseData: this.responseData ? this.sanitizeData(this.responseData) : undefined
    };
  }

  /**
   * Sanitize sensitive data for logging
   * 
   * @param {Object} data - Data to sanitize
   * @returns {Object} Sanitized data
   */
  sanitizeData(data) {
    // Create a deep copy
    const sanitized = JSON.parse(JSON.stringify(data));
    
    // List of sensitive fields to redact
    const sensitiveFields = [
      'api_key', 'apiKey', 'key', 'token', 'secret', 'password', 'Authorization',
      'authorization', 'auth', 'credentials', 'private'
    ];
    
    // Recursively redact sensitive fields
    const redact = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      
      Object.keys(obj).forEach(key => {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          redact(obj[key]);
        }
      });
    };
    
    redact(sanitized);
    return sanitized;
  }
}

module.exports = ApiError;
