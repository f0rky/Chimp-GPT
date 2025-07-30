/**
 * Startup Message Coordinator for ChimpGPT
 *
 * This module coordinates startup messages to ensure only one message
 * is sent to the bot owner when the bot starts up. It prevents duplicate
 * messages from different components of the bot.
 *
 * @module startupMessageCoordinator
 */

const { createLogger } = require('../core/logger');
const logger = createLogger('startup');

// Store the startup message reference
let startupMessageRef = null;
// Track which components have contributed to the startup message
const contributingComponents = new Set();
// Flag to indicate if the message has been sent
let messageSent = false;
// Store embeds from different components
const embeds = [];

/**
 * Register a component that will contribute to the startup message
 *
 * @param {string} componentName - Name of the component
 * @returns {void}
 */
function registerComponent(componentName) {
  contributingComponents.add(componentName);
  logger.info(`Component ${componentName} registered for startup message`);
}

/**
 * Add an embed to the startup message
 *
 * @param {string} componentName - Name of the component adding the embed
 * @param {Object} embed - Discord embed object
 * @returns {boolean} True if the embed was added, false otherwise
 */
function addEmbed(componentName, embed) {
  if (!contributingComponents.has(componentName)) {
    logger.warn(`Component ${componentName} tried to add embed but is not registered`);
    return false;
  }

  embeds.push(embed);
  logger.info(`Embed added from component ${componentName}`);
  return true;
}

/**
 * Send the startup message to the bot owner
 *
 * @param {import('discord.js').User} owner - Discord user object for the bot owner
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function sendStartupMessage(owner) {
  if (messageSent) {
    logger.warn('Attempted to send startup message more than once');
    return false;
  }

  if (!owner) {
    logger.error('Cannot send startup message: owner is undefined');
    return false;
  }

  try {
    // Send initial simple message
    startupMessageRef = await owner.send({
      embeds: [
        {
          title: '🚀 ChimpGPT Starting Up...',
          description: 'Initializing systems and gathering status information...',
          color: 0xffaa00, // Amber color for in-progress
          timestamp: new Date(),
        },
      ],
    });

    messageSent = true;
    logger.info('Initial startup message sent to owner');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to send startup message to owner');
    return false;
  }
}

/**
 * Update the startup message with all registered embeds
 *
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function updateStartupMessage() {
  if (!startupMessageRef) {
    logger.error('Cannot update startup message: no message reference');
    return false;
  }

  try {
    await startupMessageRef.edit({ embeds });
    logger.info('Startup message updated with all embeds');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to update startup message');
    return false;
  }
}

/**
 * Reset the coordinator state
 *
 * @returns {void}
 */
function reset() {
  startupMessageRef = null;
  contributingComponents.clear();
  messageSent = false;
  embeds.length = 0;
  logger.info('Startup message coordinator reset');
}

// Export the module
module.exports = {
  registerComponent,
  addEmbed,
  sendStartupMessage,
  updateStartupMessage,
  reset,
  get messageRef() {
    return startupMessageRef;
  },
  get hasMessage() {
    return messageSent;
  },
};
