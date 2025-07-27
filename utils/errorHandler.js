/**
 * Error Handler Utility for ChimpGPT
 *
 * This module provides utility functions for handling errors consistently
 * throughout the ChimpGPT codebase.
 *
 * @module errorHandler
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../src/core/logger');
const { ChimpError, enhanceError } = require('../src/utils/errorHandler');
const { trackError } = require('../src/core/healthCheck');

// Create a logger for the error handler
const logger = createLogger('errorHandler');

/**
 * Handle an error with consistent logging and tracking
 *
 * @param {Error} error - The error to handle
 * @param {Object} options - Additional options
 * @param {string} [options.component] - Component where the error occurred
 * @param {string} [options.operation] - Operation that was being performed
 * @param {Object} [options.context] - Additional context for the error
 * @param {boolean} [options.rethrow=false] - Whether to rethrow the error after handling
 * @returns {ChimpError} The handled error
 * @throws {ChimpError} If rethrow is true
 */
function handleError(error, options = {}) {
  // Ensure we have a ChimpError
  const chimpError = error instanceof ChimpError ? error : enhanceError(error, options);

  // Log the error using the new system
  const { logError } = require('../src/utils/errorHandler');
  logError(chimpError);

  // Track the error in health check system
  trackError(options.component || chimpError.component);

  // Rethrow if requested
  if (options.rethrow) {
    throw chimpError;
  }

  return chimpError;
}

/**
 * Try to execute a function and handle any errors
 *
 * @param {Function} fn - Function to execute
 * @param {Object} options - Error handling options
 * @param {*} [defaultValue] - Default value to return if the function fails
 * @returns {*} The result of the function or the default value
 */
async function tryExec(fn, options = {}, defaultValue = null) {
  try {
    return await fn();
  } catch (error) {
    handleError(error, options);
    return defaultValue;
  }
}

/**
 * Create a function that wraps another function with error handling
 *
 * @param {Function} fn - Function to wrap
 * @param {Object} options - Error handling options
 * @param {*} [defaultValue] - Default value to return if the function fails
 * @returns {Function} Wrapped function
 */
function withErrorHandling(fn, options = {}, defaultValue = null) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error, options);
      return defaultValue;
    }
  };
}

module.exports = {
  handleError,
  tryExec,
  withErrorHandling,
};
