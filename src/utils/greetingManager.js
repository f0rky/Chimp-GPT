/**
 * Greeting Manager for ChimpGPT
 *
 * This module handles sending greeting messages to channels and detailed
 * startup reports to the bot owner. It serves as a "hello world" test
 * for the bot's functionality and provides useful startup information.
 *
 * @module greetingManager
 */

const { EmbedBuilder } = require('discord.js');
const os = require('os');
const { execSync } = require('child_process');
const { createLogger } = require('../core/logger');
const config = require('../core/configValidator');
const { version: botVersion } = require('../../package.json');
const { getOpenAIModel } = require('../services/openaiConfig');
const { getConversationStorageStatus } = require('../conversation/conversationManagerSelector');
const { getHealthStatus } = require('../core/healthCheck');

// Create a logger for this module
const logger = createLogger('greeting');

/**
 * Generate a startup report with detailed system and bot information
 *
 * @returns {Object} Formatted startup report as an embed
 */
function generateStartupReport() {
  // Get system information
  const cpuCount = os.cpus().length;
  const totalMemory = Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10; // GB
  const freeMemory = Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10; // GB
  const usedMemory = Math.round((totalMemory - freeMemory) * 10) / 10; // GB
  const memoryUsage = Math.round((usedMemory / totalMemory) * 100);
  const uptime = Math.floor(process.uptime()); // seconds
  const loadAvg = os.loadavg()[0].toFixed(2);

  // Get OpenAI model information
  const aiModel = getOpenAIModel();

  // Get conversation storage status
  const conversationStatus = getConversationStorageStatus();

  // Get health status
  const healthStatus = getHealthStatus();

  // Create an embed for the report
  const embed = new EmbedBuilder()
    .setColor(0x00aaff)
    .setTitle(`${config.BOT_NAME || 'ChimpGPT'} Startup Report`)
    .setDescription(`Bot has successfully started and is ready to serve!`)
    .addFields(
      {
        name: '🤖 Bot Information',
        value:
          `**Version:** ${botVersion}\n` +
          `**AI Model:** ${aiModel}\n` +
          `**Environment:** ${process.env.NODE_ENV || 'development'}\n` +
          `**Uptime:** ${formatTime(uptime)}`,
      },
      {
        name: '💻 System Information',
        value:
          `**Platform:** ${os.platform()} ${os.release()}\n` +
          `**CPU:** ${cpuCount} cores\n` +
          `**Memory:** ${usedMemory}GB / ${totalMemory}GB (${memoryUsage}%)\n` +
          `**Load Average:** ${loadAvg}`,
      },
      {
        name: '📊 Health Status',
        value:
          `**API Calls:** ${healthStatus.apiCalls || 0}\n` +
          `**Messages Processed:** ${healthStatus.messagesProcessed || 0}\n` +
          `**Errors:** ${healthStatus.errors || 0}\n` +
          `**Rate Limits Hit:** ${healthStatus.rateLimits || 0}`,
      },
      {
        name: '💾 Conversation Storage',
        value:
          `**Total Conversations:** ${conversationStatus.totalConversations || 0}\n` +
          `**Last Save:** ${conversationStatus.lastSave ? new Date(conversationStatus.lastSave).toLocaleString() : 'Never'}\n` +
          `**Storage Size:** ${formatBytes(conversationStatus.storageSize || 0)}`,
      }
    )
    .setFooter({ text: `Generated at ${new Date().toISOString()}` });

  return embed;
}

/**
 * Generate a simple channel greeting
 *
 * @returns {Object} Formatted greeting as an embed
 */
function generateChannelGreeting() {
  // Get git branch and short commit hash for traceability
  let gitInfo = 'unknown';
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: __dirname, timeout: 2000 })
      .toString()
      .trim();
    const commit = execSync('git rev-parse --short HEAD', { cwd: __dirname, timeout: 2000 })
      .toString()
      .trim();
    gitInfo = `${branch}@${commit}`;
  } catch (_) {
    /* git not available or not a repo */
  }

  // Create an embed for the greeting
  const embed = new EmbedBuilder()
    .setColor(0x00aaff)
    .setTitle(`${config.BOT_NAME || 'ChimpGPT'} is Online!`)
    .setDescription(`I'm up and running, ready to assist! 🚀`)
    .addFields(
      { name: 'Status', value: 'All systems operational', inline: true },
      { name: 'Version', value: botVersion, inline: true },
      { name: 'AI Model', value: getOpenAIModel(), inline: true },
      { name: 'PID', value: `${process.pid}`, inline: true },
      { name: 'Branch', value: gitInfo, inline: true }
    )
    .setFooter({ text: `Type "help" or use /help to see available commands` });

  return embed;
}

/**
 * Send a greeting message to all allowed channels
 *
 * @param {import('discord.js').Client} client - Discord.js client
 * @returns {Promise<void>}
 */
async function sendChannelGreeting(client) {
  try {
    // Check if client is ready before sending
    if (!client.isReady()) {
      logger.warn('Client not ready, skipping channel greeting');
      return;
    }

    // Get the allowed channel IDs from config
    const allowedChannelIDs = config.CHANNEL_ID || [];

    if (allowedChannelIDs.length === 0) {
      logger.warn('No allowed channels configured, skipping channel greeting');
      return;
    }

    // Generate the greeting
    const greeting = generateChannelGreeting();

    // Send to each allowed channel
    let successCount = 0;
    for (const channelID of allowedChannelIDs) {
      try {
        const channel = await client.channels.fetch(channelID);
        if (channel && channel.isTextBased()) {
          const msg = await channel.send({ embeds: [greeting] });
          successCount++;
          logger.info(`Greeting sent to channel ${channel.name} (${channelID})`);

          // Add reaction controls for the owner
          await attachGreetingReactions(client, msg);
        }
      } catch (error) {
        logger.error({ error, channelID }, 'Failed to send greeting to channel');
      }
    }

    logger.info(`Greeting sent to ${successCount}/${allowedChannelIDs.length} channels`);
  } catch (error) {
    logger.error({ error }, 'Failed to send channel greeting');
  }
}

/**
 * Send a detailed startup report to the bot owner
 *
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function sendOwnerStartupReport() {
  try {
    // Use the startup message coordinator
    const startupCoordinator = require('./startupMessageCoordinator');

    // Register greeting manager as a component
    startupCoordinator.registerComponent('greetingManager');

    // We don't need to send a message here, as the health check will handle it
    // Just log that we're registered
    logger.info('Greeting manager registered with startup coordinator');

    // Return success
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to register with startup coordinator');
    return false;
  }
}

/**
 * Format bytes to a human-readable string
 *
 * @param {number} bytes - Number of bytes
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted string
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format time in seconds to a human-readable string
 *
 * @param {number} seconds - Number of seconds
 * @returns {string} Formatted string
 */
function formatTime(seconds) {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes, ${seconds % 60} seconds`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours} hours, ${minutes} minutes`;
}

/**
 * Attach emoji reaction controls to a channel greeting message.
 * Bot adds the reactions; owner can react to manage the message.
 *
 * 🗑️ → delete this message
 * 📌 → hold/archive (clear other reactions, leave message)
 * 🧹 → delete this message + next 5 in channel
 *
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} msg
 */
async function attachGreetingReactions(client, msg) {
  const { PermissionFlagsBits } = require('discord.js');

  // Check we have Manage Messages before proceeding
  const perms = msg.channel.permissionsFor(client.user);
  if (!perms || !perms.has(PermissionFlagsBits.ManageMessages)) {
    logger.warn('Missing ManageMessages permission — skipping reaction controls');
    return;
  }

  const REACTIONS = ['🗑️', '📌', '🧹'];

  try {
    for (const emoji of REACTIONS) {
      await msg.react(emoji);
    }
    logger.info('Reaction controls added to greeting message');
  } catch (error) {
    logger.warn({ error }, 'Failed to add reactions to greeting');
    return;
  }

  // Listen for owner reactions (60 min window — long enough to catch a late response)
  const filter = (reaction, user) =>
    REACTIONS.includes(reaction.emoji.name) && user.id === config.OWNER_ID;

  const collector = msg.createReactionCollector({ filter, time: 60 * 60 * 1000 });

  collector.on('collect', async (reaction, user) => {
    const emoji = reaction.emoji.name;
    logger.info({ emoji, userId: user.id }, 'Owner reacted to greeting');

    try {
      if (emoji === '🗑️') {
        // Delete this message
        await msg.delete();
        logger.info('Greeting message deleted by owner reaction');
      } else if (emoji === '📌') {
        // Hold — remove all bot-added reactions, leave message
        await msg.reactions.removeAll();
        logger.info('Greeting message held/archived by owner reaction');
        collector.stop('held');
      } else if (emoji === '🧹') {
        // Delete this message + next 5
        try {
          const channel = msg.channel;
          const messages = await channel.messages.fetch({ after: msg.id, limit: 5 });
          const toDelete = [msg, ...messages.values()];
          // bulkDelete requires messages < 14 days old
          await channel.bulkDelete(toDelete, true);
          logger.info({ count: toDelete.length }, 'Bulk deleted greeting + next messages');
        } catch (bulkErr) {
          logger.warn({ error: bulkErr }, 'Bulk delete failed, deleting greeting only');
          await msg.delete().catch(() => {});
        }
      }
    } catch (actionErr) {
      logger.warn({ error: actionErr, emoji }, 'Reaction action failed');
    }
  });

  collector.on('end', (_, reason) => {
    if (reason !== 'held' && !msg.deleted) {
      // Clean up our reaction buttons when collector expires
      msg.reactions.removeAll().catch(() => {});
    }
  });
}

module.exports = {
  sendChannelGreeting,
  sendOwnerStartupReport,
  generateStartupReport,
  generateChannelGreeting,
  attachGreetingReactions,
};
