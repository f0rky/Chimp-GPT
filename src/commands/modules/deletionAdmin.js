/**
 * Enhanced Message Deletion Administrative Command
 *
 * Discord command interface for the Enhanced Message Deletion Management System.
 * Provides owner-only administrative commands for testing, reviewing, and managing
 * the intelligent message deletion system.
 *
 * @module DeletionAdminCommand
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createLogger } = require('../../core/logger');
const { deletionTestingInterface } = require('../../utils/deletionTestingInterface');
// const maliciousUserManager = require('../../utils/maliciousUserManager'); // Imported but not used in this module

const logger = createLogger('deletionAdminCommand');

/**
 * Format command result for Discord display
 * @param {Object} result - Command result from deletion testing interface
 * @param {string} command - Command name
 * @returns {Object} Discord message content
 */
function formatCommandResult(result, command) {
  if (!result.success) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor('#ff4444')
          .setTitle('❌ Command Error')
          .setDescription(result.error || 'Unknown error occurred')
          .setTimestamp(),
      ],
    };
  }

  const data = result.result;

  switch (command) {
    case 'help':
      return {
        embeds: [
          new EmbedBuilder()
            .setColor('#4287f5')
            .setTitle('📚 ' + data.title)
            .setDescription(data.description)
            .addFields(
              data.commands.slice(0, 25).map(cmd => ({
                name: `\`${cmd.command}\``,
                value: `${cmd.description}\n*Usage: ${cmd.usage}*`,
                inline: false,
              }))
            )
            .addFields({
              name: '📋 Examples',
              value: data.examples.map(ex => `\`${ex}\``).join('\n'),
              inline: false,
            })
            .setTimestamp(),
        ],
      };

    case 'stats': {
      const stats = data;
      return {
        embeds: [
          new EmbedBuilder()
            .setColor('#00ff88')
            .setTitle('📊 Enhanced Deletion System Statistics')
            .addFields(
              {
                name: '🔄 Reprocessing Stats',
                value:
                  `Total Messages: ${stats.reprocessingStats.totalMessages}\n` +
                  `Reprocessable: ${stats.reprocessingStats.reprocessableMessages}\n` +
                  `Already Reprocessed: ${stats.reprocessingStats.alreadyReprocessed}`,
                inline: true,
              },
              {
                name: '⚡ Enhanced System',
                value:
                  `Active Relationships: ${stats.enhancedStats.totalRelationships}\n` +
                  `User Deletion Windows: ${stats.enhancedStats.userDeletionWindows}\n` +
                  `Bulk Operation Queue: ${stats.enhancedStats.bulkOperationQueueSize}`,
                inline: true,
              },
              {
                name: '📈 Message Statistics',
                value:
                  `Total Messages: ${stats.messageStats.total}\n` +
                  `Recent (24h): ${stats.messageStats.recent24h}\n` +
                  `Rapid Deletions: ${stats.messageStats.rapidDeletions}`,
                inline: true,
              },
              {
                name: '📋 Status Breakdown',
                value:
                  Object.entries(stats.messageStats.byStatus)
                    .map(([status, count]) => `${status}: ${count}`)
                    .join('\n') || 'No data',
                inline: true,
              },
              {
                name: '📺 Channel Distribution',
                value:
                  Object.entries(stats.messageStats.byChannel)
                    .slice(0, 5)
                    .map(([channel, count]) => `${channel}: ${count}`)
                    .join('\n') || 'No data',
                inline: true,
              },
              {
                name: '🏥 System Health',
                value:
                  `Cache Size: ${stats.systemHealth.cacheSize}\n` +
                  `Deletion Windows: ${stats.systemHealth.userDeletionWindows}\n` +
                  `Queue Size: ${stats.systemHealth.bulkOperationQueue}`,
                inline: true,
              }
            )
            .setTimestamp(),
        ],
      };
    }

    case 'list-pending':
      if (data.messages.length === 0) {
        return {
          embeds: [
            new EmbedBuilder()
              .setColor('#ffaa00')
              .setTitle('📝 Pending Reviews')
              .setDescription('No messages pending review.')
              .setTimestamp(),
          ],
        };
      }

      return {
        embeds: [
          new EmbedBuilder()
            .setColor('#ffaa00')
            .setTitle(`📝 Pending Reviews (${data.showing}/${data.total})`)
            .addFields(
              data.messages.slice(0, 10).map((msg, index) => ({
                name: `${index + 1}. ${msg.username} in #${msg.channelName}`,
                value:
                  `**ID:** \`${msg.messageId}\`\n` +
                  `**Content:** ${msg.content}...\n` +
                  `**Rapid:** ${msg.isRapidDeletion ? '⚡ Yes' : '❌ No'} | ` +
                  `**Count:** ${msg.deletionCount} | ` +
                  `**Time:** ${new Date(msg.timestamp).toLocaleString()}`,
                inline: false,
              }))
            )
            .setTimestamp(),
        ],
      };

    case 'review':
      return {
        embeds: [
          new EmbedBuilder()
            .setColor('#00ff88')
            .setTitle('✅ Message Reviewed')
            .addFields({
              name: 'Review Details',
              value:
                `**Message ID:** \`${data.messageId}\`\n` +
                `**Status:** ${data.status}\n` +
                `**Notes:** ${data.notes || 'None'}\n` +
                `**Action:** ${data.actionResult?.outcome || 'None'}`,
              inline: false,
            })
            .setTimestamp(),
        ],
      };

    case 'bulk-review':
      return {
        embeds: [
          new EmbedBuilder()
            .setColor('#00ff88')
            .setTitle('🔄 Bulk Review Complete')
            .addFields({
              name: 'Results',
              value:
                `**Processed:** ${data.processed}\n` +
                `**Successful:** ${data.successful}\n` +
                `**Failed:** ${data.failed}\n` +
                `**Status Applied:** ${data.status}`,
              inline: false,
            })
            .setTimestamp(),
        ],
      };

    case 'reprocess':
      return {
        embeds: [
          new EmbedBuilder()
            .setColor('#4287f5')
            .setTitle('🔄 Message Reprocessed')
            .addFields(
              {
                name: 'Reprocessing Details',
                value:
                  `**Message ID:** \`${data.messageId}\`\n` +
                  `**Original Status:** ${data.originalStatus}\n` +
                  `**Reprocess Count:** ${data.reprocessCount}`,
                inline: false,
              },
              {
                name: 'Test Options',
                value:
                  Object.entries(data.reprocessingOptions)
                    .map(([key, value]) => `**${key}:** ${value}`)
                    .join('\n') || 'None',
                inline: false,
              },
              {
                name: 'Result',
                value:
                  `**Action:** ${data.reprocessingResult.action}\n` +
                  `**Success:** ${data.reprocessingResult.success ? '✅' : '❌'}\n` +
                  `**Reason:** ${data.reprocessingResult.reason || 'None'}`,
                inline: false,
              }
            )
            .setTimestamp(),
        ],
      };

    case 'bulk-reprocess':
      return {
        embeds: [
          new EmbedBuilder()
            .setColor('#4287f5')
            .setTitle('🔄 Bulk Reprocessing Complete')
            .addFields({
              name: 'Results',
              value:
                `**Processed:** ${data.processed}\n` +
                `**Successful:** ${data.successful}\n` +
                `**Failed:** ${data.failed}`,
              inline: false,
            })
            .setTimestamp(),
        ],
      };

    case 'simulate': {
      return {
        embeds: [
          new EmbedBuilder()
            .setColor('#9932cc')
            .setTitle('🎭 Scenario Simulation Complete')
            .addFields({
              name: 'Simulation Result',
              value:
                `**Success:** ${data.success ? '✅' : '❌'}\n` +
                `**Action:** ${data.action || 'Unknown'}\n` +
                `**Reason:** ${data.reason || 'None'}`,
              inline: false,
            })
            .setTimestamp(),
        ],
      };
    }

    case 'analyze': {
      const analysis = data;
      return {
        embeds: [
          new EmbedBuilder()
            .setColor('#ff8c00')
            .setTitle(`🔍 Deletion Pattern Analysis (${analysis.timeframe})`)
            .addFields(
              {
                name: '📊 Overview',
                value:
                  `**Total Messages:** ${analysis.totalMessages}\n` +
                  `**Unique Users:** ${analysis.uniqueUsers}`,
                inline: true,
              },
              {
                name: '⚡ Patterns',
                value:
                  `**Rapid Deletions:** ${analysis.patterns.rapidDeletions}\n` +
                  `**Bulk Deletions:** ${analysis.patterns.bulkDeletions}\n` +
                  `**Frequent Deleters:** ${analysis.patterns.frequentDeleters}`,
                inline: true,
              },
              {
                name: '🕒 Peak Hours',
                value:
                  analysis.patterns.peakHours.map(ph => `${ph.hour}:00 (${ph.count})`).join('\n') ||
                  'No data',
                inline: true,
              },
              {
                name: '📺 Top Channels',
                value:
                  Object.entries(analysis.patterns.channelDistribution)
                    .slice(0, 5)
                    .map(([channel, count]) => `${channel}: ${count}`)
                    .join('\n') || 'No data',
                inline: true,
              },
              {
                name: '📋 Status Distribution',
                value:
                  Object.entries(analysis.patterns.statusDistribution)
                    .map(([status, count]) => `${status}: ${count}`)
                    .join('\n') || 'No data',
                inline: true,
              }
            )
            .setTimestamp(),
        ],
      };
    }

    case 'export':
      if (typeof data === 'string') {
        // CSV export
        return {
          content: 'Data exported successfully. CSV data too large for Discord display.',
          files: [
            {
              attachment: Buffer.from(data, 'utf-8'),
              name: `deletion_export_${Date.now()}.csv`,
            },
          ],
        };
      }
      // JSON export
      return {
        content: `Data exported successfully. ${data.exportInfo.totalRecords} records exported.`,
        files: [
          {
            attachment: Buffer.from(JSON.stringify(data, null, 2), 'utf-8'),
            name: `deletion_export_${Date.now()}.json`,
          },
        ],
      };

    default:
      return {
        embeds: [
          new EmbedBuilder()
            .setColor('#00ff88')
            .setTitle('✅ Command Executed')
            .setDescription(`Command \`${command}\` executed successfully.`)
            .setTimestamp(),
        ],
      };
  }
}

module.exports = {
  name: 'admin',
  aliases: ['deletion-admin', 'del-admin'],
  description: 'Enhanced Message Deletion System administrative commands',
  ownerOnly: true,
  dmAllowed: true,

  // Slash command definition
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Enhanced Message Deletion System administrative commands')
    .addStringOption(option =>
      option
        .setName('category')
        .setDescription('Command category')
        .setRequired(true)
        .addChoices({ name: 'deletion', value: 'deletion' })
    )
    .addStringOption(option =>
      option
        .setName('command')
        .setDescription('Administrative command')
        .setRequired(true)
        .addChoices(
          { name: 'help', value: 'help' },
          { name: 'stats', value: 'stats' },
          { name: 'list-pending', value: 'list-pending' },
          { name: 'review', value: 'review' },
          { name: 'bulk-review', value: 'bulk-review' },
          { name: 'reprocess', value: 'reprocess' },
          { name: 'bulk-reprocess', value: 'bulk-reprocess' },
          { name: 'simulate', value: 'simulate' },
          { name: 'analyze', value: 'analyze' },
          { name: 'export', value: 'export' }
        )
    )
    .addStringOption(option =>
      option
        .setName('args')
        .setDescription('Command arguments (space-separated)')
        .setRequired(false)
    ),

  async execute(message, args, client, config) {
    try {
      // Verify owner permissions
      if (message.author.id !== config.OWNER_ID) {
        await message.reply('❌ This command is restricted to the bot owner.');
        return;
      }

      if (args.length === 0) {
        await message.reply(
          'Usage: `!admin deletion <command> [args...]`\nUse `!admin deletion help` for available commands.'
        );
        return;
      }

      const [category, command, ...commandArgs] = args;

      if (category !== 'deletion') {
        await message.reply('❌ Unknown category. Available: `deletion`');
        return;
      }

      if (!command) {
        await message.reply('❌ No command specified. Use `help` to see available commands.');
        return;
      }

      logger.info(
        {
          userId: message.author.id,
          username: message.author.username,
          command,
          args: commandArgs,
        },
        'Processing deletion admin command'
      );

      // Process the command through the deletion testing interface
      const result = await deletionTestingInterface.processCommand(
        message.author.id,
        command,
        commandArgs,
        client // Pass Discord client for message operations
      );

      // Format and send the response
      const response = formatCommandResult(result, command);
      await message.reply(response);
    } catch (error) {
      logger.error(
        {
          error,
          userId: message.author.id,
          command: args[1],
          args: args.slice(2),
        },
        'Error in deletion admin command'
      );

      await message.reply(
        '❌ An error occurred while processing the command. Check the logs for details.'
      );
    }
  },

  async executeSlash(interaction, config) {
    try {
      // Verify owner permissions
      if (interaction.user.id !== config.OWNER_ID) {
        await interaction.reply({
          content: '❌ This command is restricted to the bot owner.',
          ephemeral: true,
        });
        return;
      }

      const category = interaction.options.getString('category');
      const command = interaction.options.getString('command');
      const argsString = interaction.options.getString('args') || '';
      const commandArgs = argsString.trim() ? argsString.split(/\s+/) : [];

      if (category !== 'deletion') {
        await interaction.reply({
          content: '❌ Unknown category. Available: `deletion`',
          ephemeral: true,
        });
        return;
      }

      logger.info(
        {
          userId: interaction.user.id,
          username: interaction.user.username,
          command,
          args: commandArgs,
        },
        'Processing deletion admin slash command'
      );

      // Defer reply for potentially long-running operations
      await interaction.deferReply({ ephemeral: true });

      // Process the command through the deletion testing interface
      const result = await deletionTestingInterface.processCommand(
        interaction.user.id,
        command,
        commandArgs,
        interaction.client // Pass Discord client for message operations
      );

      // Format and send the response
      const response = formatCommandResult(result, command);
      await interaction.editReply(response);
    } catch (error) {
      logger.error(
        {
          error,
          userId: interaction.user.id,
          command: interaction.options.getString('command'),
          args: interaction.options.getString('args'),
        },
        'Error in deletion admin slash command'
      );

      const errorMessage =
        '❌ An error occurred while processing the command. Check the logs for details.';

      if (interaction.deferred) {
        await interaction.editReply({ content: errorMessage });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  },
};
