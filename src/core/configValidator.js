/**
 * @typedef {Object} ConfigSchema
 * @property {boolean} required - Whether the variable is required for the application to start
 * @property {string} description - Human-readable description of the variable
 * @property {Function} [validate] - Function to validate the variable value
 * @property {Function} [transform] - Function to transform the variable value
 * @property {*} [default] - Default value if not provided (for optional variables)
 *
 * @typedef {Object.<string, ConfigSchema>} ConfigSchemaMap
 *
 * @typedef {Object.<string, *>} ValidatedConfig
 *
 * @typedef {ValidatedConfig} ConfigValidator
 */
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
 * Configuration schema defining all environment variables, their requirements, and validation rules.
 *
 * @type {ConfigSchemaMap}
 */
const CONFIG_SCHEMA = {
  // Required variables (application won't start without these)
  DISCORD_TOKEN: {
    required: true,
    description: 'Discord Bot Token',
    validate: value => typeof value === 'string' && value.length > 0,
  },
  OPENAI_API_KEY: {
    required: true,
    description: 'OpenAI API Key',
    validate: value => typeof value === 'string' && value.length > 0,
  },
  CHANNEL_ID: {
    required: true,
    description: 'Channel IDs where the bot is allowed to respond',
    validate: value => typeof value === 'string' && value.length > 0,
    transform: value => value.split(','),
  },

  // Optional variables with defaults
  CLIENT_ID: {
    required: false,
    description: 'Discord application client ID (required for slash commands)',
    default: '',
    validate: value => typeof value === 'string',
  },
  X_RAPIDAPI_KEY: {
    required: false,
    description: 'RapidAPI Key for weather and other external services',
    default: '',
    validate: value => typeof value === 'string',
  },
  BOT_NAME: {
    required: false,
    description: 'Bot name for display purposes',
    default: 'ChimpGPT',
    validate(value) {
      return typeof value === 'string' && value.length > 0;
    },
  },
  BOT_PERSONALITY: {
    required: false,
    description: 'Bot personality prompt',
    default: 'I am ChimpGPT, a helpful Discord bot.',
    validate(value) {
      return typeof value === 'string' && value.length > 0;
    },
  },
  IGNORE_MESSAGE_PREFIX: {
    required: false,
    description: 'Messages starting with this prefix will be ignored',
    default: '.',
    validate: value => typeof value === 'string',
  },
  LOADING_EMOJI: {
    required: false,
    description: 'Discord emoji ID for loading animation',
    default: '⏳',
    validate: value => typeof value === 'string',
  },
  LOG_LEVEL: {
    required: false,
    description: 'Logging level',
    default: 'info',
    validate: value => ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].includes(value),
    transform: value => value.toLowerCase(),
  },
  NODE_ENV: {
    required: false,
    description: 'Node environment',
    default: 'development',
    validate: value => ['development', 'production', 'test'].includes(value),
    transform: value => value.toLowerCase(),
  },
  PORT: {
    required: false,
    description: 'Port for all services',
    default: '3001',
    validate(value) {
      return /^\d+$/.test(value);
    },
    transform(value) {
      return parseInt(value, 10);
    },
  },
  STATUS_HOSTNAME: {
    required: false,
    description: 'Hostname for remote access to status page',
    default: 'localhost',
    validate(value) {
      return typeof value === 'string' && value.length > 0;
    },
  },
  OWNER_ID: {
    required: false,
    description: 'Discord user ID of the bot owner for status reports',
    default: '',
    validate: value => typeof value === 'string',
  },
  CORS_ALLOWED_ORIGINS: {
    required: false,
    description: 'Comma-separated list of allowed origins that can access the status page',
    default: 'http://localhost,http://127.0.0.1',
    validate: value => typeof value === 'string',
    transform: value => value.split(','),
  },
  DEPLOY_COMMANDS: {
    required: false,
    description: 'Whether to deploy slash commands on bot startup',
    default: 'true',
    validate: value => {
      return typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase());
    },
    transform: value => {
      return value.toLowerCase() === 'true';
    },
  },
  ENABLE_IMAGE_GENERATION: {
    required: false,
    description: 'Enable or disable image generation feature',
    default: 'true',
    validate: value => typeof value === 'string', // Ensure it's a string from .env
    transform: value => value === 'true', // Convert to boolean
  },
  STATUS_RATE_LIMIT_POINTS: {
    required: false,
    description: 'Maximum number of requests allowed per client for the status page',
    default: '60',
    validate(value) {
      return /^\d+$/.test(value);
    },
    transform(value) {
      return parseInt(value, 10);
    },
  },
  STATUS_RATE_LIMIT_DURATION: {
    required: false,
    description: 'Duration in seconds for the status page rate limit window',
    default: '60',
    validate: value => {
      const num = parseInt(value, 10);
      return !isNaN(num) && num > 0;
    },
    transform: value => {
      return parseInt(value, 10);
    },
  },
  ENABLE_REPLY_CONTEXT: {
    required: false,
    description: 'Whether to use message replies as context for conversations',
    default: 'true',
    validate: value => {
      return typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase());
    },
    transform: value => {
      return value.toLowerCase() === 'true';
    },
  },
  MAX_REFERENCE_DEPTH: {
    required: false,
    description: 'Maximum depth for message reference chains',
    default: '5',
    validate: value => {
      return typeof value === 'string' && !isNaN(Number(value)) && Number(value) > 0;
    },
    transform: value => {
      return Number(value);
    },
  },
  MAX_REFERENCE_CONTEXT: {
    required: false,
    description: 'Maximum number of referenced messages to include in conversation context',
    default: '5',
    validate: value => {
      return typeof value === 'string' && !isNaN(Number(value)) && Number(value) > 0;
    },
    transform: value => {
      return Number(value);
    },
  },
  MAX_MESSAGES_PER_USER_BLENDED: {
    required: false,
    description: 'Maximum messages to keep per user in blended mode',
    default: '5',
    validate: value => {
      return typeof value === 'string' && !isNaN(Number(value)) && Number(value) > 0;
    },
    transform: value => {
      return Number(value);
    },
  },

  // PocketFlow Configuration - Now the only conversation system
  ENABLE_POCKETFLOW: {
    required: false,
    description: 'Enable PocketFlow conversation system (graph-based architecture)',
    default: 'true',
    validate: value => {
      return typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase());
    },
    transform: value => {
      return value.toLowerCase() === 'true';
    },
  },

  // Knowledge System Configuration
  ENABLE_KNOWLEDGE_SYSTEM: {
    required: false,
    description: 'Enable the multi-agent knowledge system with web search and documentation fetch',
    default: 'true',
    validate: value => {
      return typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase());
    },
    transform: value => {
      return value.toLowerCase() === 'true';
    },
  },
  KNOWLEDGE_OWNER_ONLY_CODE: {
    required: false,
    description: 'Restrict code generation in knowledge system to bot owner only',
    default: 'true',
    validate: value => {
      return typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase());
    },
    transform: value => {
      return value.toLowerCase() === 'true';
    },
  },
  KNOWLEDGE_WEB_SEARCH_ENABLED: {
    required: false,
    description: 'Enable web search functionality in knowledge system',
    default: 'true',
    validate: value => {
      return typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase());
    },
    transform: value => {
      return value.toLowerCase() === 'true';
    },
  },
  KNOWLEDGE_MCP_FETCH_ENABLED: {
    required: false,
    description: 'Enable MCP-style web fetch functionality for documentation',
    default: 'true',
    validate: value => {
      return typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase());
    },
    transform: value => {
      return value.toLowerCase() === 'true';
    },
  },
  KNOWLEDGE_CONFIDENCE_THRESHOLD: {
    required: false,
    description: 'Minimum confidence threshold for knowledge verification (0-100)',
    default: '60',
    validate: value => {
      const num = parseInt(value, 10);
      return !isNaN(num) && num >= 0 && num <= 100;
    },
    transform: value => {
      return parseInt(value, 10);
    },
  },
  KNOWLEDGE_MAX_SEARCH_RESULTS: {
    required: false,
    description: 'Maximum number of search results to process per query',
    default: '5',
    validate: value => {
      const num = parseInt(value, 10);
      return !isNaN(num) && num >= 1 && num <= 20;
    },
    transform: value => {
      return parseInt(value, 10);
    },
  },
  POCKETFLOW_TEST_PERCENTAGE: {
    required: false,
    description: 'Percentage of messages to test with PocketFlow when parallel testing is enabled',
    default: '10',
    validate: value => {
      const num = parseFloat(value);
      return !isNaN(num) && num >= 0 && num <= 100;
    },
    transform: value => {
      return parseFloat(value);
    },
  },
  POCKETFLOW_TEST_USERS: {
    required: false,
    description:
      'Comma-separated list of user IDs to include in PocketFlow testing (empty = all users)',
    default: '',
    validate: value => typeof value === 'string',
    transform: value => (value ? value.split(',').map(id => id.trim()) : []),
  },
  POCKETFLOW_LOG_COMPARISONS: {
    required: false,
    description: 'Enable detailed logging of PocketFlow vs legacy comparisons',
    default: 'false',
    validate: value => {
      return typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase());
    },
    transform: value => {
      return value.toLowerCase() === 'true';
    },
  },
  POCKETFLOW_INTENT_CONFIDENCE_THRESHOLD: {
    required: false,
    description: 'Confidence threshold for PocketFlow intent detection (0.0-1.0)',
    default: '0.4',
    validate: value => {
      const num = parseFloat(value);
      return !isNaN(num) && num >= 0 && num <= 1;
    },
    transform: value => {
      return parseFloat(value);
    },
  },
  POCKETFLOW_CONTEXT_MAX_TOKENS: {
    required: false,
    description: 'Maximum tokens for PocketFlow context management',
    default: '2000',
    validate: value => {
      return typeof value === 'string' && !isNaN(Number(value)) && Number(value) > 0;
    },
    transform: value => {
      return Number(value);
    },
  },
  POCKETFLOW_MAX_CONCURRENT_FLOWS: {
    required: false,
    description: 'Maximum number of concurrent PocketFlow conversations',
    default: '10',
    validate: value => {
      return typeof value === 'string' && !isNaN(Number(value)) && Number(value) > 0;
    },
    transform: value => {
      return Number(value);
    },
  },
  POCKETFLOW_CLEANUP_INTERVAL: {
    required: false,
    description: 'PocketFlow cleanup interval in milliseconds',
    default: '300000',
    validate: value => {
      return typeof value === 'string' && !isNaN(Number(value)) && Number(value) > 0;
    },
    transform: value => {
      return Number(value);
    },
  },
};

/**
 * Validates all environment variables according to the schema.
 *
 * This function processes each configuration item defined in CONFIG_SCHEMA,
 * validates its value, applies any transformations, and returns a consolidated configuration object.
 * If any required variables are missing or invalid, it throws an error with detailed information.
 *
 * @returns {ValidatedConfig} Validated configuration object with all processed values
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
    const valueToUse = value === undefined || value === '' ? schema.default : value;

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
 * Validated configuration object.
 *
 * This is the main export of the module - a validated configuration object
 * that contains all the processed environment variables. The validation happens
 * immediately when this module is imported, ensuring that the application
 * has valid configuration before proceeding.
 *
 * @type {ConfigValidator}
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
 * @type {ConfigValidator}
 */
module.exports = validatedConfig;
