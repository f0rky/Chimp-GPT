/**
 * Input Sanitization Utility for ChimpGPT
 *
 * This module provides functions to sanitize user inputs before they are processed
 * or sent to external APIs. It helps protect against injection attacks, malicious
 * inputs, and other security vulnerabilities.
 *
 * @module InputSanitizer
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../logger');
const logger = createLogger('sanitizer');

/**
 * Maximum allowed length for different types of inputs
 * @constant
 */
const MAX_LENGTHS = {
  MESSAGE: 2000, // Discord message limit
  COMMAND_ARG: 1000, // Command argument
  PROMPT: 4000, // OpenAI prompt
  LOCATION: 100, // Location for weather/time lookups
  QUERY: 500, // General query (e.g., Wolfram Alpha)
  USERNAME: 50, // Username
  CHANNEL_NAME: 50, // Channel name
};

/**
 * Patterns for potentially dangerous inputs
 * @constant
 */
const DANGEROUS_PATTERNS = [
  // System command injection attempts
  /\b(sh|bash|powershell|cmd|exec|eval|system|process)\s*\(/i,

  // SQL injection attempts
  /('|")\s*(OR|AND)\s*('|")\s*=\s*('|")/i,
  /;\s*(DROP|DELETE|UPDATE|INSERT)\s+/i,

  // Path traversal attempts
  /\.\.\//g,

  // Prompt injection markers
  /ignore previous instructions/i,
  /ignore all previous commands/i,
  /disregard previous prompt/i,
];

/**
 * Sanitize a general text input
 *
 * @param {string} input - The input to sanitize
 * @param {number} [maxLength=MAX_LENGTHS.MESSAGE] - Maximum allowed length
 * @returns {string} Sanitized input
 */
function sanitizeText(input, maxLength = MAX_LENGTHS.MESSAGE) {
  if (!input) return '';

  // Convert to string if not already
  let sanitized = String(input);

  // Trim whitespace
  sanitized = sanitized.trim();

  // Truncate to max length
  if (sanitized.length > maxLength) {
    logger.warn(
      { originalLength: input.length, truncatedTo: maxLength },
      'Input truncated due to length'
    );
    sanitized = sanitized.substring(0, maxLength);
  }

  // Remove control characters (using ESLint-friendly approach)
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\u0000-\u001F\u007F]/g, '');

  return sanitized;
}

/**
 * Sanitize a user message before processing
 *
 * @param {string} message - The user message to sanitize
 * @returns {string} Sanitized message
 */
function sanitizeUserMessage(message) {
  let sanitized = sanitizeText(message, MAX_LENGTHS.MESSAGE);

  // Check for dangerous patterns
  const hasDangerousPattern = DANGEROUS_PATTERNS.some(pattern => pattern.test(sanitized));

  if (hasDangerousPattern) {
    logger.warn({ message: sanitized }, 'Potentially dangerous pattern detected in user message');
    // Don't reveal the exact pattern to the user in logs
  }

  return sanitized;
}

/**
 * Sanitize a prompt before sending to OpenAI
 *
 * @param {string} prompt - The prompt to sanitize
 * @returns {string} Sanitized prompt
 */
function sanitizePrompt(prompt) {
  let sanitized = sanitizeText(prompt, MAX_LENGTHS.PROMPT);

  // Additional prompt-specific sanitization
  // Remove potential prompt injection attempts
  DANGEROUS_PATTERNS.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '[filtered]');
  });

  return sanitized;
}

/**
 * Sanitize a location string for weather/time lookups
 *
 * @param {string} location - The location to sanitize
 * @returns {string} Sanitized location
 */
function sanitizeLocation(location) {
  let sanitized = sanitizeText(location, MAX_LENGTHS.LOCATION);

  // Remove special characters that aren't needed in location names
  // Allow letters, numbers, spaces, commas, periods, and a few special characters
  sanitized = sanitized.replace(/[^\w\s.,\-']/g, '');

  return sanitized;
}

/**
 * Sanitize a query for external APIs (e.g., Wolfram Alpha)
 *
 * @param {string} query - The query to sanitize
 * @returns {string} Sanitized query
 */
function sanitizeQuery(query) {
  return sanitizeText(query, MAX_LENGTHS.QUERY);
}

/**
 * Sanitize a command argument
 *
 * @param {string} arg - The command argument to sanitize
 * @returns {string} Sanitized argument
 */
function sanitizeCommandArg(arg) {
  return sanitizeText(arg, MAX_LENGTHS.COMMAND_ARG);
}

/**
 * Check if input contains potentially dangerous patterns
 *
 * @param {string} input - The input to check
 * @returns {boolean} True if dangerous patterns are detected
 */
function hasDangerousPatterns(input) {
  if (!input) return false;

  return DANGEROUS_PATTERNS.some(pattern => pattern.test(input));
}

/**
 * Sanitize an object's string properties recursively
 *
 * @param {Object} obj - The object to sanitize
 * @param {number} [maxDepth=3] - Maximum recursion depth
 * @returns {Object} Sanitized object
 */
function sanitizeObject(obj, maxDepth = 3) {
  if (!obj || typeof obj !== 'object' || maxDepth <= 0) {
    return obj;
  }

  const result = Array.isArray(obj) ? [] : {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];

      if (typeof value === 'string') {
        result[key] = sanitizeText(value);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = sanitizeObject(value, maxDepth - 1);
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

module.exports = {
  sanitizeText,
  sanitizeUserMessage,
  sanitizePrompt,
  sanitizeLocation,
  sanitizeQuery,
  sanitizeCommandArg,
  sanitizeObject,
  hasDangerousPatterns,
  MAX_LENGTHS,
};
