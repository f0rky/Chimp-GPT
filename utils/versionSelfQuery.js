/**
 * Version Self-Query System
 *
 * This module enables the bot to respond to queries about its own version
 * and configuration through natural language prompts. It detects version
 * queries in messages and provides appropriate responses.
 *
 * @module VersionSelfQuery
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../src/core/logger');
const logger = createLogger('versionQuery');
const {
  getBotVersion,
  getDetailedVersionInfo,
  formatUptime,
} = require('../src/core/getBotVersion');
const os = require('os');

// Special triggers that will prompt a version response
const VERSION_TRIGGERS = [
  '@version',
  '@[@version]',
  '@[@prompt]',
  'what version are you',
  'which version are you',
  'bot version',
  'version info',
  'version information',
  'version', // Add simple 'version' as a trigger
];

/**
 * Check if a message contains a version query
 *
 * @param {string} message - The message to check
 * @returns {boolean} True if the message contains a version query
 */
function isVersionQuery(message) {
  if (!message || typeof message !== 'string') return false;

  const lowerMessage = message.toLowerCase();

  // Check for direct triggers
  for (const trigger of VERSION_TRIGGERS) {
    if (lowerMessage.includes(trigger.toLowerCase())) {
      return true;
    }
  }

  // Check for more complex version queries
  const versionPatterns = [
    /what(?:'s| is) your version/i,
    /which version (?:are you|is this)/i,
    /tell me (?:your|the|about your|about the) version/i,
    /version (?:number|id|identifier)/i,
    /(?:show|display|print) version/i,
    /(?:current|installed) version/i,
  ];

  for (const pattern of versionPatterns) {
    if (pattern.test(lowerMessage)) {
      return true;
    }
  }

  return false;
}

/**
 * Generate a version response for the bot
 *
 * @param {Object} [options] - Options for the response
 * @param {boolean} [options.detailed=false] - Whether to include detailed information
 * @param {boolean} [options.technical=false] - Whether to include technical information
 * @param {Object} [options.config={}] - Bot configuration
 * @returns {string} Formatted version response
 */
function generateVersionResponse(options = {}) {
  const { detailed = false, technical = false, config = {} } = options;

  // Get detailed version info
  const versionInfo = getDetailedVersionInfo();
  const botName = config.BOT_NAME || process.env.BOT_NAME || versionInfo.name || 'ChimpGPT';

  // Build the response
  let response = `I'm ${botName} version ${versionInfo.version}. `;

  // Always include AI model information
  response += `I'm powered by the ${versionInfo.aiModel} AI model. `;

  if (detailed) {
    response += `Running in ${versionInfo.environment} mode. `;

    if (technical) {
      response += `Powered by Node.js ${versionInfo.nodeVersion} on ${versionInfo.platform}. `;

      // Add memory usage if technical details requested
      const memoryUsageMB = (versionInfo.memory / 1024 / 1024).toFixed(1);
      response += `Currently using ${memoryUsageMB} MB of memory. `;

      // Add uptime using the formatter
      response += `I've been running for ${formatUptime(versionInfo.uptime)}. `;

      // Add timestamp
      const startTime = new Date(new Date().getTime() - versionInfo.uptime * 1000);
      response += `Started at ${startTime.toISOString().replace('T', ' ').substring(0, 19)}. `;
    }
  }

  // Add a friendly closing
  response += 'How can I help you today?';

  return response;
}

/**
 * Process a message and check if it contains a version query
 *
 * @param {string} message - The message to process
 * @param {Object} [config={}] - Bot configuration
 * @returns {Object|null} Response object or null if not a version query
 */
function processVersionQuery(message, config = {}) {
  if (!isVersionQuery(message)) {
    return null;
  }

  logger.info({ message }, 'Detected version query');

  // Determine the level of detail based on the message
  const detailed =
    message.toLowerCase().includes('detail') ||
    message.toLowerCase().includes('info') ||
    message.toLowerCase().includes('about');

  const technical =
    message.toLowerCase().includes('tech') ||
    message.toLowerCase().includes('system') ||
    message.toLowerCase().includes('debug');

  const response = generateVersionResponse({
    detailed,
    technical,
    config,
  });

  return {
    content: response,
    isVersionQuery: true,
  };
}

module.exports = {
  isVersionQuery,
  generateVersionResponse,
  processVersionQuery,
  VERSION_TRIGGERS,
};
