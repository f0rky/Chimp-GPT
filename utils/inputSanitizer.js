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
 * @param {string} [type='MESSAGE'] - Type of input for length limits
 * @returns {string} Sanitized input
 */
function sanitizeText(input, type = 'MESSAGE') {
  if (!input) return '';

  // Convert to string if not already
  let sanitized = String(input);

  // Trim whitespace
  sanitized = sanitized.trim();

  // Get max length for this type
  const maxLength = MAX_LENGTHS[type] || MAX_LENGTHS.MESSAGE;

  // Truncate to max length
  if (sanitized.length > maxLength) {
    logger.warn(
      { originalLength: input.length, truncatedTo: maxLength, type },
      'Input truncated due to length'
    );
    sanitized = sanitized.substring(0, maxLength);
  }

  // Remove control characters (using ESLint-friendly approach)
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\u0000-\u001F\u007F]/g, '');

  // Remove HTML/XML tags to prevent XSS
  sanitized = sanitized.replace(/<[^>]*>/g, '');

  // Replace tab and newline with spaces
  sanitized = sanitized.replace(/[\t\n\r]/g, ' ');

  return sanitized;
}

/**
 * Sanitize a user message before processing
 *
 * @param {string} message - The user message to sanitize
 * @returns {string} Sanitized message
 */
function sanitizeUserMessage(message) {
  const sanitized = sanitizeText(message, MAX_LENGTHS.MESSAGE);

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
  let sanitized = sanitizeText(query, 'QUERY');
  
  // Remove SQL injection patterns
  sanitized = sanitized.replace(/['";]/g, '');
  sanitized = sanitized.replace(/\b(DROP|DELETE|INSERT|UPDATE|UNION|SELECT)\b/gi, '');
  
  return sanitized;
}

/**
 * Sanitize command input to prevent command injection
 *
 * @param {string} command - The command to sanitize
 * @returns {string} Sanitized command
 */
function sanitizeCommand(command) {
  let sanitized = sanitizeText(command, 'COMMAND_ARG');
  
  // Remove command injection patterns
  sanitized = sanitized.replace(/[;&|`$()]/g, '');
  sanitized = sanitized.replace(/\b(exec|eval|system|rm|del|format)\b/gi, '');
  sanitized = sanitized.replace(/ignore previous instructions?/gi, '');
  
  return sanitized;
}

/**
 * Sanitize file path to prevent path traversal
 *
 * @param {string} path - The path to sanitize
 * @returns {string} Sanitized path
 */
function sanitizePath(path) {
  let sanitized = sanitizeText(path, 'LOCATION');
  
  // Remove path traversal patterns
  sanitized = sanitized.replace(/\.\./g, '');
  sanitized = sanitized.replace(/[\\]/g, '/');
  
  return sanitized;
}

/**
 * Sanitize OpenAI prompt
 *
 * @param {string} prompt - The prompt to sanitize
 * @returns {string} Sanitized prompt
 */
function sanitizeOpenAIPrompt(prompt) {
  let sanitized = sanitizeText(prompt, 'PROMPT');
  
  // Remove potential prompt injection
  sanitized = sanitized.replace(/ignore previous instructions?/gi, '');
  sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  
  return sanitized;
}

/**
 * Sanitize weather location
 *
 * @param {string} location - The location to sanitize
 * @returns {string} Sanitized location
 */
function sanitizeWeatherLocation(location) {
  let sanitized = sanitizeText(location, 'LOCATION');
  
  // Remove SQL injection and command injection
  sanitized = sanitized.replace(/[;'"]/g, '');
  sanitized = sanitized.replace(/\b(DROP|DELETE|INSERT|UPDATE|UNION|SELECT)\b/gi, '');
  
  // Only allow alphanumeric, spaces, commas, periods, hyphens
  sanitized = sanitized.replace(/[^\w\s.,\-]/g, '');
  
  return sanitized;
}

/**
 * Sanitize Wolfram query
 *
 * @param {string} query - The query to sanitize
 * @returns {string} Sanitized query
 */
function sanitizeWolframQuery(query) {
  let sanitized = sanitizeText(query, 'QUERY');
  
  // Remove command injection patterns
  sanitized = sanitized.replace(/[;&|`]/g, '');
  sanitized = sanitized.replace(/\b(rm|del|format|exec)\b/gi, '');
  
  return sanitized;
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

/**
 * Validate if a username is safe
 *
 * @param {string} username - The username to validate
 * @returns {boolean} True if valid
 */
function isValidUsername(username) {
  if (!username || typeof username !== 'string') return false;
  if (username.length > MAX_LENGTHS.USERNAME) return false;
  
  // Only allow alphanumeric characters and underscores
  return /^[a-zA-Z0-9_]+$/.test(username);
}

/**
 * Validate if a channel name is safe
 *
 * @param {string} channelName - The channel name to validate
 * @returns {boolean} True if valid
 */
function isValidChannelName(channelName) {
  if (!channelName || typeof channelName !== 'string') return false;
  if (channelName.length > MAX_LENGTHS.CHANNEL_NAME) return false;
  
  // Allow alphanumeric characters, hyphens, and underscores
  return /^[a-zA-Z0-9_-]+$/.test(channelName);
}

module.exports = {
  sanitizeText,
  sanitizeUserMessage,
  sanitizePrompt,
  sanitizeLocation,
  sanitizeQuery,
  sanitizeCommand,
  sanitizePath,
  sanitizeOpenAIPrompt,
  sanitizeWeatherLocation,
  sanitizeWolframQuery,
  sanitizeCommandArg,
  sanitizeObject,
  hasDangerousPatterns,
  isValidUsername,
  isValidChannelName,
  MAX_LENGTHS,
};
