/**
 * Human Circuit Breaker Integration
 *
 * This module integrates the existing circuit breaker implementations:
 * - breakerManager.js: Used for automatic circuit breaking on API failures
 * - circuitBreaker.js: Used for human-in-the-loop approval of sensitive actions
 *
 * It provides a unified interface for requesting human approval for sensitive
 * operations while maintaining compatibility with both systems.
 *
 * @module HumanCircuitBreaker
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../logger');
const logger = createLogger('humanCircuitBreaker');
const breakerManager = require('../breakerManager');
const circuitBreaker = require('../circuitBreaker');
const { Client } = require('discord.js');
const { getBotVersion, getDetailedVersionInfo } = require('../getBotVersion');

// Categories of operations that require approval
const SENSITIVE_OPERATIONS = {
  DATA_WRITE: 'data_write',
  COMMAND_EXECUTION: 'command_execution',
  API_CALL: 'api_call',
  SYSTEM_CHANGE: 'system_change',
  PLUGIN_ACTION: 'plugin_action',
};

/**
 * Request human approval for a sensitive operation
 *
 * @param {Object} details - Details about the operation
 * @param {string} details.type - Type of operation (use SENSITIVE_OPERATIONS constants)
 * @param {string} details.user - User who triggered the operation
 * @param {string} details.context - Context/description of the operation
 * @param {Object} [details.metadata] - Additional metadata about the operation
 * @param {Function} onApprove - Callback function if approved
 * @param {Function} onDeny - Callback function if denied
 * @param {Client} [client] - Discord client for notifications
 * @returns {Promise<string>} Approval ID
 */
async function requestHumanApproval(details, onApprove, onDeny, client) {
  try {
    // Log the approval request
    logger.info(
      {
        type: details.type,
        user: details.user,
        context: details.context,
        metadata: details.metadata,
      },
      'Human circuit breaker approval requested'
    );

    // Generate approval ID using the circuitBreaker module
    const approvalId = circuitBreaker.requestApproval(details, onApprove, onDeny);

    // Notify the owner through Discord if client is provided
    if (client && process.env.OWNER_ID) {
      try {
        const ownerUser = await client.users.fetch(process.env.OWNER_ID.replace(/"/g, ''));
        if (ownerUser) {
          const message = createApprovalMessage(approvalId, details);
          await ownerUser.send(message).catch(err => {
            logger.error({ err }, 'Failed to send approval request to owner via DM');
            notifyThroughChannel(client, approvalId, details);
          });
        } else {
          notifyThroughChannel(client, approvalId, details);
        }
      } catch (err) {
        logger.error({ err }, 'Failed to notify owner about approval request');
        notifyThroughChannel(client, approvalId, details);
      }
    }

    return approvalId;
  } catch (err) {
    logger.error({ err, details }, 'Error requesting human approval');
    throw err;
  }
}

/**
 * Create a formatted approval message for Discord
 *
 * @param {string} approvalId - The approval ID
 * @param {Object} details - Details about the operation
 * @returns {string} Formatted message
 */
function createApprovalMessage(approvalId, details) {
  const typeEmoji = getTypeEmoji(details.type);
  const timestamp = Math.floor(Date.now() / 1000);
  const botVersion = getBotVersion();

  let message = `${typeEmoji} **Circuit Breaker Approval Needed**\n`;
  message += `**Type:** ${formatType(details.type)}\n`;
  message += `**User:** ${details.user || 'N/A'}\n`;
  message += `**Context:** ${details.context || 'No context provided'}\n`;
  message += `**Bot Version:** ${botVersion}\n`;
  message += `**Requested:** <t:${timestamp}:R>\n`;
  message += `**ID:** \`${approvalId}\`\n\n`;

  // Add metadata if available
  if (details.metadata && Object.keys(details.metadata).length > 0) {
    message += '**Details:**\n';
    for (const [key, value] of Object.entries(details.metadata)) {
      message += `• ${key}: ${value}\n`;
    }
    message += '\n';
  }

  // Add system information
  try {
    const versionInfo = getDetailedVersionInfo();
    message += '**System Info:**\n';
    message += `• Environment: ${versionInfo.environment}\n`;
    message += `• Node: ${versionInfo.nodeVersion}\n`;
    message += `• Platform: ${versionInfo.platform}\n`;
    message += '\n';
  } catch (error) {
    logger.error({ error }, 'Error getting version info for approval message');
  }

  message += `**Approve:** \`/circuitbreaker approve id:${approvalId}\`\n`;
  message += `**Deny:** \`/circuitbreaker deny id:${approvalId}\`\n`;
  message += `**View All:** \`/circuitbreaker list\``;

  return message;
}

/**
 * Notify the owner through a channel if DM fails
 *
 * @param {Client} client - Discord client
 * @param {string} approvalId - The approval ID
 * @param {Object} details - Details about the operation
 */
async function notifyThroughChannel(client, approvalId, details) {
  if (!client || !process.env.CHANNEL_ID) return;

  try {
    // Try to use the first available channel from CHANNEL_ID
    const channelIds = process.env.CHANNEL_ID.split(',');
    if (channelIds.length > 0) {
      const channel = await client.channels.fetch(channelIds[0]);
      if (channel) {
        const message = `<@${process.env.OWNER_ID.replace(/"/g, '')}> ${createApprovalMessage(approvalId, details)}`;
        await channel.send(message);
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to notify through channel');
  }
}

/**
 * Get emoji for operation type
 *
 * @param {string} type - Operation type
 * @returns {string} Emoji
 */
function getTypeEmoji(type) {
  switch (type) {
    case SENSITIVE_OPERATIONS.DATA_WRITE:
      return '💾';
    case SENSITIVE_OPERATIONS.COMMAND_EXECUTION:
      return '⚡';
    case SENSITIVE_OPERATIONS.API_CALL:
      return '🌐';
    case SENSITIVE_OPERATIONS.SYSTEM_CHANGE:
      return '⚙️';
    case SENSITIVE_OPERATIONS.PLUGIN_ACTION:
      return '🔌';
    default:
      return '🚨';
  }
}

/**
 * Format operation type for display
 *
 * @param {string} type - Operation type
 * @returns {string} Formatted type
 */
function formatType(type) {
  switch (type) {
    case SENSITIVE_OPERATIONS.DATA_WRITE:
      return 'Data Write Operation';
    case SENSITIVE_OPERATIONS.COMMAND_EXECUTION:
      return 'Command Execution';
    case SENSITIVE_OPERATIONS.API_CALL:
      return 'External API Call';
    case SENSITIVE_OPERATIONS.SYSTEM_CHANGE:
      return 'System Configuration Change';
    case SENSITIVE_OPERATIONS.PLUGIN_ACTION:
      return 'Plugin Action';
    default:
      return type;
  }
}

/**
 * Execute a function with human approval
 *
 * @param {Object} details - Details about the operation
 * @param {Function} fn - Function to execute if approved
 * @param {Client} [client] - Discord client for notifications
 * @returns {Promise<Object>} Result with status and data
 */
async function executeWithApproval(details, fn, client) {
  return new Promise(resolve => {
    requestHumanApproval(
      details,
      // On approve
      async () => {
        try {
          const result = await fn();
          resolve({ approved: true, result });
        } catch (err) {
          logger.error({ err, details }, 'Error executing approved function');
          resolve({ approved: true, error: err });
        }
      },
      // On deny
      () => {
        resolve({ approved: false, result: null });
      },
      client
    ).catch(err => {
      logger.error({ err }, 'Error in approval process');
      resolve({ approved: false, error: err });
    });
  });
}

/**
 * Check if an operation requires human approval
 *
 * @param {string} operationType - Type of operation
 * @param {Object} [context] - Additional context
 * @returns {boolean} Whether approval is required
 */
function requiresHumanApproval(operationType, context = {}) {
  // Always require approval for system changes
  if (operationType === SENSITIVE_OPERATIONS.SYSTEM_CHANGE) {
    return true;
  }

  // Check if the breaker is open (system under stress)
  if (breakerManager.isBreakerOpen()) {
    return true;
  }

  // Add additional logic here based on context

  return false;
}

/**
 * Get the bot's version information
 *
 * This function provides a way for the bot to self-query its version
 * information, which is useful for diagnostics and logging.
 *
 * @param {boolean} [detailed=false] - Whether to return detailed information
 * @returns {Object} Version information
 */
function getVersionInfo(detailed = false) {
  try {
    if (detailed) {
      return getDetailedVersionInfo();
    }
    return {
      version: getBotVersion(),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error({ error }, 'Error getting version information');
    return {
      version: 'unknown',
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = {
  SENSITIVE_OPERATIONS,
  requestHumanApproval,
  executeWithApproval,
  requiresHumanApproval,
  createApprovalMessage,
  getVersionInfo,
};
