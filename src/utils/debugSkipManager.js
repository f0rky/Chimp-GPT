/**
 * Debug Skip Manager
 *
 * This module manages the debug skip functionality that allows the bot owner
 * to skip log checking operations by reacting with a specific emoji to bot messages.
 * This helps save tokens and time during debugging/troubleshooting.
 *
 * @module DebugSkipManager
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../core/logger');
const logger = createLogger('debugSkip');

// Debug skip state
const debugSkipState = {
  isSkipActive: false,
  activatedAt: null,
  activatedBy: null,
  messageId: null,
  autoResetTimeout: null,
};

// Configuration
const SKIP_EMOJI = '⏭️'; // Next track button - intuitive "skip to next step"
const AUTO_RESET_TIMEOUT = 15 * 60 * 1000; // 15 minutes in milliseconds

/**
 * Initialize debug skip functionality with the Discord client
 *
 * @param {import('discord.js').Client} client - Discord client instance
 * @param {Object} config - Bot configuration
 */
function initDebugSkip(client, config) {
  // Check if debug skip is enabled
  const isEnabled = process.env.ENABLE_DEBUG_SKIP !== 'false'; // Default to enabled
  if (!isEnabled) {
    logger.info('Debug skip functionality disabled by environment variable');
    return;
  }

  // Add messageReactionAdd event handler
  client.on('messageReactionAdd', async (reaction, user) => {
    try {
      // Only respond to the bot owner
      if (user.id !== config.OWNER_ID?.replace(/"/g, '')) {
        return;
      }

      // Only respond to our skip emoji
      if (reaction.emoji.name !== SKIP_EMOJI) {
        return;
      }

      // Only respond to reactions on bot messages
      if (reaction.message.author.id !== client.user.id) {
        return;
      }

      // Activate debug skip mode
      activateSkip(user.id, reaction.message.id);

      // Send confirmation by reacting to the original message
      try {
        await reaction.message.react('🤖');
        logger.info(
          {
            userId: user.id,
            messageId: reaction.message.id,
          },
          'Debug skip activated - confirmation reaction added'
        );
      } catch (error) {
        logger.error({ error }, 'Failed to add confirmation reaction');
      }

      // Send a follow-up message if in a guild channel
      if (reaction.message.guild) {
        try {
          await reaction.message.channel.send(
            '🤖 **Debug Mode**: Log checking will be skipped for the next Claude operation'
          );
        } catch (error) {
          logger.error({ error }, 'Failed to send skip confirmation message');
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error handling reaction for debug skip');
    }
  });

  logger.info('Debug skip functionality initialized');
}

/**
 * Activate debug skip mode
 *
 * @param {string} userId - ID of the user who activated skip
 * @param {string} messageId - ID of the message that was reacted to
 */
function activateSkip(userId, messageId) {
  // Clear existing timeout if any
  if (debugSkipState.autoResetTimeout) {
    clearTimeout(debugSkipState.autoResetTimeout);
  }

  // Set skip state
  debugSkipState.isSkipActive = true;
  debugSkipState.activatedAt = new Date();
  debugSkipState.activatedBy = userId;
  debugSkipState.messageId = messageId;

  // Set auto-reset timeout
  debugSkipState.autoResetTimeout = setTimeout(() => {
    deactivateSkip('timeout');
  }, AUTO_RESET_TIMEOUT);

  logger.info(
    {
      userId,
      messageId,
      timeout: AUTO_RESET_TIMEOUT,
    },
    'Debug skip mode activated'
  );
}

/**
 * Deactivate debug skip mode
 *
 * @param {string} reason - Reason for deactivation ('used', 'timeout', 'manual')
 */
function deactivateSkip(reason = 'used') {
  if (!debugSkipState.isSkipActive) {
    return false;
  }

  // Clear timeout
  if (debugSkipState.autoResetTimeout) {
    clearTimeout(debugSkipState.autoResetTimeout);
    debugSkipState.autoResetTimeout = null;
  }

  const previousState = { ...debugSkipState };

  // Reset state
  debugSkipState.isSkipActive = false;
  debugSkipState.activatedAt = null;
  debugSkipState.activatedBy = null;
  debugSkipState.messageId = null;
  debugSkipState.autoResetTimeout = null;

  logger.info(
    {
      reason,
      previousState: {
        activatedBy: previousState.activatedBy,
        activatedAt: previousState.activatedAt,
        messageId: previousState.messageId,
      },
    },
    'Debug skip mode deactivated'
  );

  return true;
}

/**
 * Check if debug skip is currently active
 *
 * @returns {boolean} Whether skip mode is active
 */
function isSkipActive() {
  return debugSkipState.isSkipActive;
}

/**
 * Use the skip (this will deactivate it after one use)
 *
 * @returns {boolean} Whether skip was active and has been used
 */
function useSkip() {
  if (!debugSkipState.isSkipActive) {
    return false;
  }

  logger.info(
    {
      activatedBy: debugSkipState.activatedBy,
      messageId: debugSkipState.messageId,
      activatedAt: debugSkipState.activatedAt,
    },
    'Debug skip used - deactivating'
  );

  deactivateSkip('used');
  return true;
}

/**
 * Get current skip state information
 *
 * @returns {Object} Current skip state
 */
function getSkipState() {
  return {
    isActive: debugSkipState.isSkipActive,
    activatedAt: debugSkipState.activatedAt,
    activatedBy: debugSkipState.activatedBy,
    messageId: debugSkipState.messageId,
    autoResetIn: debugSkipState.autoResetTimeout
      ? AUTO_RESET_TIMEOUT - (Date.now() - debugSkipState.activatedAt?.getTime())
      : null,
  };
}

/**
 * Manually deactivate skip mode (for admin commands)
 *
 * @returns {boolean} Whether skip was deactivated
 */
function manualDeactivate() {
  return deactivateSkip('manual');
}

/**
 * Claude Code integration function - checks if log checking should be skipped
 *
 * This function is designed to be called by Claude Code when it's about to
 * run log checking commands like "pm2 logs chimpGPT-Solvis --lines 15"
 *
 * @returns {Object} Skip information
 */
function shouldSkipLogChecking() {
  if (isSkipActive()) {
    const skipUsed = useSkip(); // This will deactivate the skip mode
    return {
      skip: skipUsed,
      message: skipUsed
        ? '🚫 **Debug Skip Active**: Skipping log checking and proceeding with available information.'
        : '⚠️ **Debug Skip**: Was active but already used.',
    };
  }

  return {
    skip: false,
    message: null,
  };
}

module.exports = {
  initDebugSkip,
  isSkipActive,
  useSkip,
  getSkipState,
  manualDeactivate,
  shouldSkipLogChecking,
  SKIP_EMOJI,
};
