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

const { createLogger } = require('../logger');
const { ChimpError, wrapError } = require('../errors');
const { trackError } = require('../healthCheck');

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
  const chimpError = error instanceof ChimpError ? error : wrapError(error, error.message, options);

  // Log the error
  logger.error(
    {
      error: chimpError.toJSON(),
      component: options.component || chimpError.component,
      operation: options.operation || chimpError.operation,
      context: {
        ...chimpError.context,
        ...(options.context || {}),
      },
    },
    chimpError.message
  );

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
