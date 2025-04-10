/**
 * Configuration Validator for ChimpGPT
 * 
 * This module validates all required environment variables on application startup
 * and provides a centralized way to access configuration values. It ensures that
 * all required configuration is present and valid before the application starts.
 * 
 * @module ConfigValidator
 * @author Brett
 * @version 1.0.0
 */

// Import the logger
const { createLogger } = require('./logger');
const logger = createLogger('config');

/**
 * Configuration schema defining all environment variables, their requirements, and validation rules
 * 
 * @typedef {Object} ConfigSchema
 * @property {boolean} required - Whether the variable is required for the application to start
 * @property {string} description - Human-readable description of the variable
 * @property {Function} [validate] - Function to validate the variable value
 * @property {Function} [transform] - Function to transform the variable value
 * @property {*} [default] - Default value if not provided (for optional variables)
 */
/**
 * Schema for all configuration variables used in the application
 * @type {Object.<string, ConfigSchema>}
 */
const CONFIG_SCHEMA = {
  // Required variables (application won't start without these)
  DISCORD_TOKEN: {
    required: true,
    description: 'Discord Bot Token',
    validate: (value) => typeof value === 'string' && value.length > 0
  },
  OPENAI_API_KEY: {
    required: true,
    description: 'OpenAI API Key',
    validate: (value) => typeof value === 'string' && value.length > 0
  },
  CHANNEL_ID: {
    required: true,
    description: 'Channel IDs where the bot is allowed to respond',
    validate: (value) => typeof value === 'string' && value.length > 0,
    transform: (value) => value.split(',')
  },
  
  // Optional variables with defaults
  CLIENT_ID: {
    required: false,
    description: 'Discord application client ID (required for slash commands)',
    default: '',
    validate: (value) => typeof value === 'string'
  },
  X_RAPIDAPI_KEY: {
    required: false,
    description: 'RapidAPI Key for weather and other external services',
    default: '',
    validate: (value) => typeof value === 'string'
  },
  BOT_PERSONALITY: {
    required: false,
    description: 'Bot personality prompt',
    default: 'I am ChimpGPT, a helpful Discord bot.',
    validate: (value) => typeof value === 'string'
  },
  IGNORE_MESSAGE_PREFIX: {
    required: false,
    description: 'Messages starting with this prefix will be ignored',
    default: '.',
    validate: (value) => typeof value === 'string'
  },
  LOADING_EMOJI: {
    required: false,
    description: 'Discord emoji ID for loading animation',
    default: '⏳',
    validate: (value) => typeof value === 'string'
  },
  LOG_LEVEL: {
    required: false,
    description: 'Logging level',
    default: 'info',
    validate: (value) => ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].includes(value),
    transform: (value) => value.toLowerCase()
  },
  NODE_ENV: {
    required: false,
    description: 'Node environment',
    default: 'development',
    validate: (value) => ['development', 'production', 'test'].includes(value),
    transform: (value) => value.toLowerCase()
  },
  HEALTH_PORT: {
    required: false,
    description: 'Port for the health check HTTP server',
    default: '3000',
    validate: (value) => !isNaN(parseInt(value)),
    transform: (value) => parseInt(value)
  },
  OWNER_ID: {
    required: false,
    description: 'Discord user ID of the bot owner for status reports',
    default: '',
    validate: (value) => typeof value === 'string'
  }
};

/**
 * Validates all environment variables according to the schema
 * 
 * This function processes each configuration item defined in CONFIG_SCHEMA,
 * validates its value, applies any transformations, and returns a consolidated
 * configuration object. If any required variables are missing or invalid,
 * it throws an error with detailed information.
 * 
 * @returns {Object} Validated configuration object with all processed values
 * @throws {Error} If any required variables are missing or invalid
 */
function validateConfig() {
  const config = {};
  const errors = [];

  // Process each configuration item
  for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
    const value = process.env[key];
    
    // Check if required and missing
    if (schema.required && (value === undefined || value === '')) {
      errors.push(`Missing required environment variable: ${key} (${schema.description})`);
      continue;
    }
    
    // Use default if value is missing and not required
    const valueToUse = (value === undefined || value === '') ? schema.default : value;
    
    // Validate the value if a validation function exists
    if (schema.validate && !schema.validate(valueToUse)) {
      errors.push(`Invalid value for environment variable: ${key} (${schema.description})`);
      continue;
    }
    
    // Transform the value if a transform function exists
    config[key] = schema.transform ? schema.transform(valueToUse) : valueToUse;
  }

  // If there are any errors, log them and throw an error
  if (errors.length > 0) {
    const errorMessage = `Configuration validation failed:\n${errors.join('\n')}`;
    logger.fatal(errorMessage);
    throw new Error(errorMessage);
  }

  logger.info('Configuration validation successful');
  return config;
}

/**
 * Validated configuration object
 * 
 * This is the main export of the module - a validated configuration object
 * that contains all the processed environment variables. The validation happens
 * immediately when this module is imported, ensuring that the application
 * has valid configuration before proceeding.
 * 
 * @type {Object.<string, *>}
 */
let validatedConfig;

try {
  validatedConfig = validateConfig();
} catch (error) {
  // The error is already logged in validateConfig
  process.exit(1);
}

/**
 * @exports ConfigValidator
 */
module.exports = validatedConfig;
