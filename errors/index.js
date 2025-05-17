/**
 * Error Classes for ChimpGPT
 * 
 * This module exports all custom error classes for ChimpGPT.
 * 
 * @module errors
 * @author Brett
 * @version 1.0.0
 */

const ChimpError = require('./ChimpError');
const ApiError = require('./ApiError');
const PluginError = require('./PluginError');
const ValidationError = require('./ValidationError');
const ConfigError = require('./ConfigError');
const DiscordError = require('./DiscordError');

/**
 * Create an error instance based on the error type
 * 
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
 * Wrap an error in a ChimpError
 * 
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
    cause: error
  });
}

module.exports = {
  ChimpError,
  ApiError,
  PluginError,
  ValidationError,
  ConfigError,
  DiscordError,
  createError,
  wrapError
};
