/**
 * Input Validation Utility
 *
 * This module provides validation functions for user inputs to ensure
 * they meet expected formats and constraints before processing.
 *
 * @module InputValidator
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../core/logger');
const { ValidationError } = require('../core/errors');
const logger = createLogger('inputValidator');

/**
 * Validate a server name or IP address
 *
 * @param {string} input - Server name or IP to validate
 * @returns {Object} Validation result with isValid and sanitized value
 */
function validateServerInput(input) {
  // If input is null or undefined, it's valid (optional parameter)
  if (input === null || input === undefined) {
    return { isValid: true, value: null };
  }

  // Convert to string if it's not already
  const serverInput = String(input).trim();

  // Empty string is considered valid (no filter)
  if (serverInput === '') {
    return { isValid: true, value: null };
  }

  // Check for potentially malicious patterns
  const maliciousPatterns = [
    /[<>]/g, // HTML tags
    /javascript:/i, // JavaScript protocol
    /(\s|;|&|`|\|)/g, // Command injection characters
    /%[0-9A-F]{2}/g, // URL encoding
    /\\x[0-9A-F]{2}/g, // Hex encoding
  ];

  for (const pattern of maliciousPatterns) {
    if (pattern.test(serverInput)) {
      logger.warn(
        { input: serverInput, pattern: pattern.toString() },
        'Potentially malicious server input detected'
      );
      return { isValid: false, value: null };
    }
  }

  // For IP addresses, validate format
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d{1,5})?$/.test(serverInput)) {
    // Basic IP validation - could be enhanced with more specific checks
    const ipParts = serverInput.split(':')[0].split('.');
    for (const part of ipParts) {
      const num = parseInt(part, 10);
      if (num < 0 || num > 255) {
        logger.warn({ input: serverInput }, 'Invalid IP address format');
        return { isValid: false, value: null };
      }
    }

    // If port is specified, validate it
    if (serverInput.includes(':')) {
      const port = parseInt(serverInput.split(':')[1], 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        logger.warn({ input: serverInput }, 'Invalid port number');
        return { isValid: false, value: null };
      }
    }
  }

  // For server names, limit length and validate characters
  if (serverInput.length > 100) {
    logger.warn({ input: serverInput, length: serverInput.length }, 'Server name too long');
    return { isValid: false, value: null };
  }

  // Only allow alphanumeric, spaces, and common punctuation
  if (!/^[a-zA-Z0-9\s\-_.,:;!?()[\]{}'"]+$/.test(serverInput)) {
    logger.warn({ input: serverInput }, 'Server name contains invalid characters');
    return { isValid: false, value: null };
  }

  return { isValid: true, value: serverInput };
}

/**
 * Validate an ELO mode value
 *
 * @param {number|string} input - ELO mode to validate
 * @returns {Object} Validation result with isValid and sanitized value
 */
function validateEloMode(input) {
  // If input is null or undefined, it's valid (optional parameter)
  if (input === null || input === undefined) {
    return { isValid: true, value: null };
  }

  // Convert to number if it's a string
  const eloMode = typeof input === 'string' ? parseInt(input, 10) : input;

  // Check if it's a number and within valid range
  if (isNaN(eloMode) || !Number.isInteger(eloMode) || eloMode < 0 || eloMode > 2) {
    logger.warn({ input }, 'Invalid ELO mode');
    return { isValid: false, value: null };
  }

  return { isValid: true, value: eloMode };
}

/**
 * Sanitize output text to prevent injection issues
 *
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
function sanitizeOutput(text) {
  if (!text) return '';

  // Convert to string if it's not already
  const outputText = String(text);

  // Check if the text contains code blocks
  if (outputText.includes('```')) {
    // Split by code blocks and process each part separately
    const parts = outputText.split(/(```(?:.*?)```)/s);
    return parts
      .map(part => {
        // If this is a code block, don't sanitize the content inside
        if (part.startsWith('```') && part.endsWith('```')) {
          return part;
        }
        // Otherwise sanitize normally
        return part
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      })
      .join('');
  }

  // If no code blocks, sanitize normally
  return outputText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitize Discord message content
 *
 * @param {string} content - Message content to sanitize
 * @returns {string} Sanitized message content
 */
function sanitizeDiscordMessage(content) {
  if (!content) return '';

  // Convert to string if it's not already
  const messageContent = String(content);

  // Check if the text contains code blocks
  if (messageContent.includes('```')) {
    // Split by code blocks and process each part separately
    const parts = messageContent.split(/(```(?:.*?)```)/s);
    return parts
      .map(part => {
        // If this is a code block, only prevent mentions inside it
        if (part.startsWith('```') && part.endsWith('```')) {
          return part
            .replace(/@(everyone|here)/gi, '@\u200b$1')
            .replace(/<@&?!?(\d+)>/g, '<@\u200b$1>');
        }
        // Otherwise sanitize normally
        return part
          .replace(/@(everyone|here)/gi, '@\u200b$1')
          .replace(/<@&?!?(\d+)>/g, '<@\u200b$1>')
          .replace(/(\[.*?\]\(.*?\))/g, '\\$1');
      })
      .join('');
  }

  // If no code blocks, sanitize normally
  return (
    messageContent
      // Prevent everyone/here mentions
      .replace(/@(everyone|here)/gi, '@\u200b$1')
      // Prevent user/role/channel mentions
      .replace(/<@&?!?(\d+)>/g, '<@\u200b$1>')
      // Prevent markdown injection
      .replace(/(\[.*?\]\(.*?\))/g, '\\$1')
  );
}

/**
 * Validate message status for deleted messages
 * @param {string} status - Status to validate
 * @param {string} messageId - Message ID for context
 * @returns {string} Validated status
 * @throws {ValidationError} If status is invalid
 */
function validateMessageStatus(status, messageId) {
  const validStatuses = ['pending_review', 'approved', 'flagged', 'ignored', 'banned'];

  if (!status || typeof status !== 'string') {
    throw new ValidationError('Status is required and must be a string', {
      safe: true,
      providedStatus: status,
      validStatuses,
      messageId,
    });
  }

  const normalizedStatus = status.trim().toLowerCase();

  if (!validStatuses.includes(normalizedStatus)) {
    throw new ValidationError(
      `Invalid status '${status}'. Must be one of: ${validStatuses.join(', ')}`,
      {
        safe: true,
        providedStatus: status,
        validStatuses,
        messageId,
      }
    );
  }

  return normalizedStatus;
}

/**
 * Validate and sanitize review notes
 * @param {string} notes - Notes to validate
 * @param {Object} options - Validation options
 * @returns {string} Sanitized notes
 */
function validateReviewNotes(notes, options = {}) {
  const { maxLength = 500, required = false, allowEmpty = true } = options;

  if (!notes) {
    if (required) {
      throw new ValidationError('Notes are required for this status', {
        safe: true,
        maxLength,
        required,
      });
    }
    return '';
  }

  if (typeof notes !== 'string') {
    throw new ValidationError('Notes must be a string', {
      safe: true,
      providedType: typeof notes,
      maxLength,
    });
  }

  const trimmedNotes = notes.trim();

  if (!allowEmpty && trimmedNotes.length === 0) {
    throw new ValidationError('Notes cannot be empty', {
      safe: true,
      maxLength,
    });
  }

  if (trimmedNotes.length > maxLength) {
    throw new ValidationError(`Notes must be ${maxLength} characters or less`, {
      safe: true,
      providedLength: trimmedNotes.length,
      maxLength,
    });
  }

  // Use existing sanitization function
  return sanitizeOutput(trimmedNotes);
}

/**
 * Validate Discord message/user ID format
 * @param {string} id - ID to validate
 * @param {string} type - Type for error messages ('message' or 'user')
 * @returns {string} Validated ID
 */
function validateDiscordId(id, type = 'ID') {
  if (!id || typeof id !== 'string') {
    throw new ValidationError(`${type} is required and must be a string`, {
      safe: true,
      providedId: id,
      type,
    });
  }

  const trimmedId = id.trim();

  if (trimmedId.length === 0) {
    throw new ValidationError(`${type} cannot be empty`, {
      safe: true,
      type,
    });
  }

  // Discord snowflakes are typically 17-19 digits
  if (!/^[0-9]{10,20}$/.test(trimmedId)) {
    throw new ValidationError(`Invalid ${type.toLowerCase()} format`, {
      safe: true,
      providedId: id,
      type,
      expectedFormat: 'numeric string 10-20 digits',
    });
  }

  return trimmedId;
}

/**
 * Comprehensive validation for deleted message status update
 * @param {Object} data - Data to validate
 * @returns {Object} Validated data
 */
function validateStatusUpdateData(data) {
  const { messageId, status, notes, userId } = data;

  const validatedData = {
    messageId: validateDiscordId(messageId, 'Message ID'),
    status: validateMessageStatus(status, messageId),
    userId: validateDiscordId(userId, 'User ID'),
    notes: validateReviewNotes(notes, {
      required: status === 'flagged', // Require notes for flagged messages
      maxLength: 500,
    }),
  };

  logger.debug('Status update data validated successfully', {
    messageId: validatedData.messageId,
    status: validatedData.status,
    userId: validatedData.userId,
    notesLength: validatedData.notes.length,
  });

  return validatedData;
}

module.exports = {
  validateServerInput,
  validateEloMode,
  sanitizeOutput,
  sanitizeDiscordMessage,
  validateMessageStatus,
  validateReviewNotes,
  validateDiscordId,
  validateStatusUpdateData,
};
