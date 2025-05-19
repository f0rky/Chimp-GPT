/**
 * Stats Command Module
 *
 * This command provides health and status information about the bot,
 * including uptime, memory usage, API call statistics, and error counts.
 *
 * @module StatsCommand
 * @author Brett
 * @version 1.0.0
 */

const { generateHealthReport } = require('../../healthCheck');
const { createLogger } = require('../../logger');
const logger = createLogger('commands:stats');
const { SlashCommandBuilder } = require('discord.js');

/**
 * Format a health report for Discord display
 *
 * @param {Object} healthReport - Health report object
 * @returns {string} Formatted health report
 */
function formatHealthReport(healthReport) {
  const { uptime, memory, apiCalls, errors, messages, rateLimits } = healthReport;

  // Format uptime
  const days = Math.floor(uptime.total / 86400);
  const hours = Math.floor((uptime.total % 86400) / 3600);
  const minutes = Math.floor((uptime.total % 3600) / 60);
  const seconds = Math.floor(uptime.total % 60);

  // Format memory usage
  const usedMemoryMB = Math.round(memory.used / 1024 / 1024);
  const totalMemoryMB = Math.round(memory.total / 1024 / 1024);
  const memoryPercentage = Math.round((memory.used / memory.total) * 100);

  // Build the formatted report
  let report = '**📊 ChimpGPT Health Report**\n\n';

  // Uptime section
  report += '**⏱️ Uptime:**\n';
  report += `${days}d ${hours}h ${minutes}m ${seconds}s\n\n`;

  // Memory section
  report += '**💾 Memory Usage:**\n';
  report += `${usedMemoryMB}MB / ${totalMemoryMB}MB (${memoryPercentage}%)\n\n`;

  // API calls section
  report += '**🔄 API Calls:**\n';
  const apiCallsList = Object.entries(apiCalls)
    .map(([name, count]) => `${name}: ${count}`)
    .join('\n');
  report += apiCallsList || 'No API calls recorded';
  report += '\n\n';

  // Messages section
  report += '**💬 Messages:**\n';
  report += `Total: ${messages.total}\n`;
  report += `Last hour: ${messages.lastHour}\n\n`;

  // Errors section
  report += '**❌ Errors:**\n';
  const errorsList = Object.entries(errors)
    .map(([name, count]) => `${name}: ${count}`)
    .join('\n');
  report += errorsList || 'No errors recorded';
  report += '\n\n';

  // Rate limits section
  report += '**⏳ Rate Limits:**\n';
  report += `Total: ${rateLimits.total}\n`;
  report += `Last hour: ${rateLimits.lastHour}`;

  return report;
}

module.exports = {
  name: 'stats',
  aliases: ['status', 'health'],
  description: 'Display bot health and status information',
  dmAllowed: true, // This command can be used in DMs

  // Define slash command
  slashCommand: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Display bot health and status information'),

  /**
   * Execute the stats command (text command version)
   *
   * @param {import('discord.js').Message} message - Discord message object
   * @param {string[]} args - Command arguments
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async execute(message) {
    logger.info(
      {
        userId: message.author.id,
        username: message.author.username,
      },
      'Stats command used'
    );

    try {
      // Get health report from the health check system
      const healthReport = await generateHealthReport();

      // Format the health report for Discord
      const formattedReport = formatHealthReport(healthReport);

      await message.reply(formattedReport);
    } catch (error) {
      logger.error({ error }, 'Error executing stats command');
      await message.reply('An error occurred while retrieving health statistics.');
    }
  },

  /**
   * Execute the stats command (slash command version)
   *
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction object
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async executeSlash(interaction) {
    return this.interactionExecute(interaction);
  },

  /**
   * Execute the stats command (slash command version)
   *
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction object
   * @returns {Promise<void>}
   */
  async interactionExecute(interaction) {
    logger.info(
      {
        userId: interaction.user.id,
        username: interaction.user.username,
      },
      'Stats slash command used'
    );

    try {
      // Defer reply to show the bot is processing
      await interaction.deferReply();

      // Get health report from the health check system
      const healthReport = await generateHealthReport();

      // Format the health report for Discord
      const formattedReport = formatHealthReport(healthReport);

      await interaction.editReply(formattedReport);
    } catch (error) {
      logger.error({ error }, 'Error executing stats slash command');

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while retrieving health statistics.',
          ephemeral: true,
        });
      } else {
        await interaction.editReply('An error occurred while retrieving health statistics.');
      }
    }
  },
};
