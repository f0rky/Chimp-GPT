/**
 * Enhanced Security Utilities for ChimpGPT
 *
 * This module provides advanced security functions including environment variable
 * validation, secure file operations, and enhanced input sanitization.
 *
 * @module SecurityUtils
 * @author Claude Code Assistant
 * @version 1.0.0
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../core/logger');
const inputSanitizer = require('./inputSanitizer');

const logger = createLogger('security');

/**
 * Project root directory for path validation
 */
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Environment variable validation schema
 */
const ENV_VALIDATION_SCHEMA = {
  // Required variables
  DISCORD_TOKEN: { required: true, type: 'string', minLength: 50 },
  OPENAI_API_KEY: { required: true, type: 'string', minLength: 40 },
  OWNER_ID: { required: true, type: 'string', pattern: /^\d+$/ },

  // Optional with defaults
  LOG_LEVEL: {
    required: false,
    type: 'string',
    enum: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
  },
  NODE_ENV: { required: false, type: 'string', enum: ['development', 'production', 'test'] },

  // Numeric validations
  PROD_PORT: { required: false, type: 'number', min: 1, max: 65535 },
  DEV_PORT: { required: false, type: 'number', min: 1, max: 65535 },

  // Boolean validations
  ENABLE_REPLY_CONTEXT: { required: false, type: 'boolean' },
  ENABLE_IMAGE_GENERATION: { required: false, type: 'boolean' },
  ENABLE_DEBUG_SKIP: { required: false, type: 'boolean' },
};

/**
 * Validate and sanitize environment variables
 * @param {Object} env - Environment variables object (typically process.env)
 * @returns {Object} Validated and sanitized environment variables
 * @throws {Error} If required variables are missing or invalid
 */
function validateEnvironmentVariables(env = process.env) {
  const validated = {};
  const errors = [];

  for (const [key, schema] of Object.entries(ENV_VALIDATION_SCHEMA)) {
    const value = env[key];

    // Check if required variable is missing
    if (schema.required && !value) {
      errors.push(`Required environment variable ${key} is missing`);
      continue;
    }

    // Skip validation if optional and not provided
    if (!schema.required && !value) {
      continue;
    }

    try {
      validated[key] = validateEnvironmentVariable(key, value, schema);
    } catch (error) {
      errors.push(`Environment variable ${key}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }

  logger.info(`Validated ${Object.keys(validated).length} environment variables`);
  return validated;
}

/**
 * Validate a single environment variable
 * @param {string} key - Variable name
 * @param {string} value - Variable value
 * @param {Object} schema - Validation schema
 * @returns {*} Validated and converted value
 */
function validateEnvironmentVariable(key, value, schema) {
  let validated = value;

  // Type conversion and validation
  switch (schema.type) {
    case 'number':
      validated = Number(value);
      if (isNaN(validated)) {
        throw new Error(`must be a number, got: ${value}`);
      }
      if (schema.min !== undefined && validated < schema.min) {
        throw new Error(`must be >= ${schema.min}, got: ${validated}`);
      }
      if (schema.max !== undefined && validated > schema.max) {
        throw new Error(`must be <= ${schema.max}, got: ${validated}`);
      }
      break;

    case 'boolean':
      validated = value.toLowerCase() === 'true';
      break;

    case 'string':
      validated = String(value);
      if (schema.minLength && validated.length < schema.minLength) {
        throw new Error(`must be at least ${schema.minLength} characters long`);
      }
      if (schema.maxLength && validated.length > schema.maxLength) {
        throw new Error(`must be at most ${schema.maxLength} characters long`);
      }
      if (schema.pattern && !schema.pattern.test(validated)) {
        throw new Error(`must match pattern ${schema.pattern}`);
      }
      if (schema.enum && !schema.enum.includes(validated)) {
        throw new Error(`must be one of: ${schema.enum.join(', ')}`);
      }

      // Sanitize string values
      validated = inputSanitizer.sanitizeText(validated);
      break;

    default:
      throw new Error(`Unsupported schema type: ${schema.type}`);
  }

  return validated;
}

/**
 * Securely validate file path and ensure it's within project boundaries
 * @param {string} filePath - Path to validate
 * @param {string} [basePath=PROJECT_ROOT] - Base path to validate against
 * @returns {string} Normalized and validated path
 * @throws {Error} If path is invalid or escapes boundaries
 */
function validateFilePath(filePath, basePath = PROJECT_ROOT) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path must be a non-empty string');
  }

  // Sanitize the path
  const sanitizedPath = inputSanitizer.sanitizePath(filePath);

  // Resolve to absolute path
  const resolvedPath = path.resolve(basePath, sanitizedPath);
  const normalizedBasePath = path.resolve(basePath);

  // Ensure the resolved path stays within the base path
  if (!resolvedPath.startsWith(normalizedBasePath)) {
    logger.warn(
      {
        filePath,
        sanitizedPath,
        resolvedPath,
        basePath: normalizedBasePath,
      },
      'Path traversal attempt blocked'
    );
    throw new Error(`Path traversal attempt blocked: ${filePath}`);
  }

  return resolvedPath;
}

/**
 * Atomic file write operation with backup
 * @param {string} filePath - Target file path
 * @param {string} data - Data to write
 * @param {Object} [options] - Write options
 * @returns {Promise<void>}
 */
async function atomicWriteFile(filePath, data, options = {}) {
  const validatedPath = validateFilePath(filePath);
  const tempPath = `${validatedPath}.tmp.${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;
  const backupPath = `${validatedPath}.bak`;

  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(validatedPath), { recursive: true });

    // Create backup if file exists
    try {
      await fs.access(validatedPath);
      await fs.copyFile(validatedPath, backupPath);
    } catch (error) {
      // File doesn't exist, no backup needed
    }

    // Write to temporary file
    await fs.writeFile(tempPath, data, {
      encoding: 'utf8',
      mode: 0o644,
      ...options,
    });

    // Verify the write by reading back
    const writtenData = await fs.readFile(tempPath, 'utf8');
    if (writtenData !== data) {
      throw new Error('Data verification failed after write');
    }

    // Atomic rename
    await fs.rename(tempPath, validatedPath);

    logger.debug({ filePath: validatedPath }, 'Atomic file write completed');
  } catch (error) {
    // Cleanup temp file on error
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    logger.error({ error, filePath: validatedPath }, 'Atomic file write failed');
    throw error;
  }
}

/**
 * Safe file read operation with validation
 * @param {string} filePath - File path to read
 * @param {Object} [options] - Read options
 * @returns {Promise<string>} File contents
 */
async function safeReadFile(filePath, options = {}) {
  const validatedPath = validateFilePath(filePath);

  try {
    // Check if file exists and is readable
    await fs.access(validatedPath, fs.constants.R_OK);

    // Get file stats for validation
    const stats = await fs.stat(validatedPath);

    // Prevent reading extremely large files (default 10MB limit)
    const maxSize = options.maxSize || 10 * 1024 * 1024;
    if (stats.size > maxSize) {
      throw new Error(`File too large: ${stats.size} bytes (max: ${maxSize})`);
    }

    const data = await fs.readFile(validatedPath, {
      encoding: 'utf8',
      ...options,
    });

    logger.debug(
      {
        filePath: validatedPath,
        size: stats.size,
      },
      'Safe file read completed'
    );

    return data;
  } catch (error) {
    logger.error({ error, filePath: validatedPath }, 'Safe file read failed');
    throw error;
  }
}

/**
 * Validate and sanitize command arguments for system execution
 * @param {Array<string>} args - Command arguments
 * @param {Array<string>} allowedCommands - List of allowed commands
 * @returns {Array<string>} Sanitized arguments
 * @throws {Error} If command is not allowed or arguments are invalid
 */
function validateCommandArguments(args, allowedCommands = []) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('Command arguments must be a non-empty array');
  }

  const [command, ..._commandArgs] = args;

  // Check if command is in allowed list
  if (allowedCommands.length > 0 && !allowedCommands.includes(command)) {
    throw new Error(`Command not allowed: ${command}`);
  }

  // Sanitize all arguments
  const sanitizedArgs = args.map(arg => {
    if (typeof arg !== 'string') {
      throw new Error(`Command argument must be string, got: ${typeof arg}`);
    }
    return inputSanitizer.sanitizeCommand(arg);
  });

  // Additional validation for common dangerous patterns
  const joinedArgs = sanitizedArgs.join(' ');
  if (inputSanitizer.hasDangerousPatterns(joinedArgs)) {
    logger.warn({ args: sanitizedArgs }, 'Dangerous patterns detected in command arguments');
    throw new Error('Command contains potentially dangerous patterns');
  }

  return sanitizedArgs;
}

/**
 * Create a secure temporary file
 * @param {string} prefix - File prefix
 * @param {string} suffix - File suffix
 * @returns {Promise<string>} Path to temporary file
 */
async function createSecureTempFile(prefix = 'chimp', suffix = '.tmp') {
  const tempDir = path.join(PROJECT_ROOT, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });

  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${suffix}`;
  const tempPath = path.join(tempDir, filename);

  // Create empty file with secure permissions
  await fs.writeFile(tempPath, '', { mode: 0o600 });

  // Schedule cleanup after 1 hour
  setTimeout(
    async () => {
      try {
        await fs.unlink(tempPath);
      } catch (error) {
        // Ignore cleanup errors
      }
    },
    60 * 60 * 1000
  );

  return tempPath;
}

/**
 * Hash sensitive data for logging purposes
 * @param {string} data - Data to hash
 * @returns {string} SHA256 hash (first 8 characters)
 */
function hashForLogging(data) {
  if (!data) return 'empty';
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 8);
}

/**
 * Clean up temporary files older than specified age
 * @param {number} maxAgeMs - Maximum age in milliseconds
 * @returns {Promise<number>} Number of files cleaned up
 */
async function cleanupTempFiles(maxAgeMs = 24 * 60 * 60 * 1000) {
  // 24 hours default
  const tempDir = path.join(PROJECT_ROOT, 'tmp');
  let cleanedCount = 0;

  try {
    const files = await fs.readdir(tempDir);
    const now = Date.now();

    for (const file of files) {
      const filePath = path.join(tempDir, file);

      try {
        const stats = await fs.stat(filePath);
        const age = now - stats.mtime.getTime();

        if (age > maxAgeMs) {
          await fs.unlink(filePath);
          cleanedCount++;
        }
      } catch (error) {
        // Ignore individual file errors
      }
    }

    if (cleanedCount > 0) {
      logger.info({ cleanedCount }, 'Cleaned up temporary files');
    }
  } catch (error) {
    // Temp directory might not exist
  }

  return cleanedCount;
}

module.exports = {
  validateEnvironmentVariables,
  validateEnvironmentVariable,
  validateFilePath,
  atomicWriteFile,
  safeReadFile,
  validateCommandArguments,
  createSecureTempFile,
  hashForLogging,
  cleanupTempFiles,
  PROJECT_ROOT,
  ENV_VALIDATION_SCHEMA,
};
