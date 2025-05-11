/**
 * @typedef {import('pino').Logger} LoggerInstance
 *
 * @typedef {Object} DiscordMessageLog
 * @property {string} id
 * @property {string} content
 * @property {string} channelId
 * @property {{ id: string, username: string } | null} author
 */
/**
 * Logger configuration for Chimp-GPT
 * 
 * Provides structured logging with different log levels and formatting options.
 * This module sets up a centralized logging system using Pino, with support for
 * pretty printing in development and structured JSON logging in production.
 * 
 * Note: This file uses process.env directly instead of the config validator
 * to avoid circular dependencies, as the config validator imports this logger.
 * 
 * @module Logger
 * @author Brett
 * @version 1.0.0
 */
const pino = require('pino');
require('dotenv').config();

/**
 * Standard log levels with their numeric values
 * Higher numbers indicate higher severity
 * 
 * @constant {Object} LOG_LEVELS
 * @property {number} fatal - System is unusable (60)
 * @property {number} error - Error conditions (50)
 * @property {number} warn - Warning conditions (40)
 * @property {number} info - Informational messages (30)
 * @property {number} debug - Debug-level messages (20)
 * @property {number} trace - Trace-level messages (10)
 */

/**
 * Current log level from environment variables or default to 'info'
 * @constant {string} LOG_LEVEL
 */
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

/**
 * Whether to use pretty printing for logs (enabled in development, disabled in production)
 * @constant {boolean} prettyPrint
 */
const prettyPrint = process.env.NODE_ENV !== 'production';

/**
 * Main logger instance configured with appropriate settings
 * @type {import('pino').Logger}
 */
const logger = pino({
  level: LOG_LEVEL,
  transport: prettyPrint ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  } : undefined,
  base: {
    pid: process.pid,
    hostname: process.env.HOSTNAME || 'unknown'
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  formatters: {
    level: (label) => {
      return { level: label };
    }
  },
  serializers: {
    error: pino.stdSerializers.err,
    /**
     * Custom serializer for Discord.js message objects to prevent circular references
     * Extracts only the necessary properties for logging
     * 
     * @param {import('discord.js').Message} message - Discord.js message object
     * @returns {Object} Serialized message with safe properties
     */
    discordMessage: (message) => {
      if (!message) return message;
      return {
        id: message.id,
        content: message.content,
        channelId: message.channelId,
        author: message.author ? {
          id: message.author.id,
          username: message.author.username
        } : null
      };
    },
    /**
     * Custom serializer for OpenAI API responses to prevent circular references
     * Extracts only the necessary properties for logging
     * 
     * @param {Object} response - OpenAI API response object
     * @returns {Object} Serialized response with safe properties
     */
    openaiResponse: (response) => {
      if (!response) return response;
      // Extract only the necessary information to avoid large logs
      return {
        id: response.id,
        model: response.model,
        usage: response.usage
      };
    }
  }
});

/**
 * Creates a child logger for a specific component.
 *
 * Child loggers inherit all settings from the parent logger but include
 * additional component information in every log entry, making it easier
 * to filter and identify logs from specific parts of the application.
 *
 * @param {string} component - Name of the component (e.g., 'discord', 'openai', 'health')
 * @returns {LoggerInstance} Child logger instance for the component
 */
function createChildLogger(component) {
  return logger.child({ component });
}

/**
 * Logger module exports.
 *
 * Exposes the main logger instance, child loggers for specific components,
 * and a helper function to create custom child loggers.
 *
 * @typedef {Object} LoggerExports
 * @property {LoggerInstance} logger - Main logger instance
 * @property {LoggerInstance} discord - Child logger for Discord component
 * @property {LoggerInstance} openai - Child logger for OpenAI component
 * @property {LoggerInstance} quake - Child logger for Quake component
 * @property {LoggerInstance} weather - Child logger for Weather component
 * @property {LoggerInstance} wolfram - Child logger for Wolfram component
 * @property {LoggerInstance} time - Child logger for Time component
 * @property {function(string): LoggerInstance} createLogger - Helper to create custom child loggers
 *
 * @type {LoggerExports}
 */
module.exports = {
  logger,
  // Create child loggers for different components
  discord: createChildLogger('discord'),
  openai: createChildLogger('openai'),
  quake: createChildLogger('quake'),
  weather: createChildLogger('weather'),
  wolfram: createChildLogger('wolfram'),
  time: createChildLogger('time'),
  // Helper function to create custom child loggers
  createLogger: createChildLogger
};
