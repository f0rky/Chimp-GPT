/**
 * Message Sanitizer Utility
 *
 * This module provides functions to sanitize and validate messages
 * before they're added to conversation logs or processed by the bot.
 *
 * @module MessageSanitizer
 * @author ChimpGPT Team
 * @version 1.0.0
 */

const { createLogger } = require('../src/core/logger');
const logger = createLogger('messageSanitizer');

// Maximum allowed message length (in characters)
const MAX_MESSAGE_LENGTH = 2000;

// Regular expressions for sanitization
const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, // Script tags
  /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, // eslint-disable-line no-control-regex -- Control characters except newlines and tabs
  /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, // Invisible formatting characters
  /[\uFFF0-\uFFFF]/g, // Specials
];

/**
 * Sanitizes a message to prevent injection and other security issues
 *
 * @param {string} content - The message content to sanitize
 * @param {Object} [options] - Sanitization options
 * @param {boolean} [options.stripNewlines=false] - Whether to strip newlines
 * @param {boolean} [options.trim=true] - Whether to trim whitespace
 * @returns {string} The sanitized message
 */
function sanitizeMessage(content, options = {}) {
  if (typeof content !== 'string') {
    logger.warn({ content }, 'Non-string content passed to sanitizeMessage');
    return '';
  }

  const { stripNewlines = false, trim = true } = options;
  let sanitized = content;

  try {
    // Apply each dangerous pattern replacement
    DANGEROUS_PATTERNS.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '');
    });

    // Handle newlines based on options
    if (stripNewlines) {
      sanitized = sanitized.replace(/[\r\n]+/g, ' ');
    }

    // Trim if requested
    if (trim) {
      sanitized = sanitized.trim();
    }

    // Truncate if too long
    if (sanitized.length > MAX_MESSAGE_LENGTH) {
      logger.warn(
        { originalLength: content.length, truncatedLength: MAX_MESSAGE_LENGTH },
        'Message content was truncated'
      );
      sanitized = sanitized.substring(0, MAX_MESSAGE_LENGTH);
    }
  } catch (error) {
    logger.error({ error, content }, 'Error sanitizing message');
    return ''; // Return empty string on error
  }

  return sanitized;
}

/**
 * Validates a message meets security requirements
 *
 * @param {string} content - The message content to validate
 * @returns {Object} Validation result with { valid: boolean, reason?: string }
 */
function validateMessage(content) {
  if (typeof content !== 'string') {
    return { valid: false, reason: 'Message must be a string' };
  }

  if (content.length === 0) {
    return { valid: false, reason: 'Message cannot be empty' };
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    return {
      valid: false,
      reason: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`,
    };
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      return { valid: false, reason: 'Message contains potentially dangerous content' };
    }
  }

  return { valid: true };
}

module.exports = {
  sanitizeMessage,
  validateMessage,
  MAX_MESSAGE_LENGTH,
};
