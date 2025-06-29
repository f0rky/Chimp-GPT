/**
 * Circuit Breaker Command
 *
 * This command allows the bot owner to interact with the circuit breaker system,
 * including approving/denying requests, viewing pending requests, and checking
 * the bot's version information.
 *
 * @module CircuitBreakerCommand
 * @author Brett
 * @version 1.0.0
 */

const { SlashCommandBuilder } = require('discord.js');
const { trackApiCall } = require('../../core/healthCheck');
const circuitBreaker = require('../../middleware/circuitBreaker');
const breakerManager = require('../../middleware/breakerManager');
const { getVersionInfo } = require('../../utils/humanCircuitBreaker');
const { formatUptime } = require('../../core/getBotVersion');

// Create the command definition
const circuitBreakerCommand = {
  name: 'circuitbreaker',
  description: 'Manage circuit breaker approvals and check bot status',
  aliases: ['cb', 'breaker'],
  ownerOnly: true, // Only the bot owner can use this command
  dmAllowed: true, // This command can be used in DMs

  // Slash command definition
  data: new SlashCommandBuilder()
    .setName('circuitbreaker')
    .setDescription('Manage circuit breaker approvals and check bot status')
    .addSubcommand(subcommand =>
      subcommand
        .setName('approve')
        .setDescription('Approve a pending operation')
        .addStringOption(option =>
          option.setName('id').setDescription('The approval ID to approve').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('deny')
        .setDescription('Deny a pending operation')
        .addStringOption(option =>
          option.setName('id').setDescription('The approval ID to deny').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('List all pending approval requests')
    )
    .addSubcommand(subcommand =>
      subcommand.setName('status').setDescription('Check the circuit breaker status')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('version')
        .setDescription('Get detailed version information')
        .addBooleanOption(option =>
          option
            .setName('detailed')
            .setDescription('Show detailed technical information')
            .setRequired(false)
        )
    ),

  /**
   * Execute the circuit breaker command
   *
   * @param {Object} interaction - The Discord interaction or message
   * @param {Object} config - Bot configuration
   * @param {string[]} [args=[]] - Command arguments (for text commands)
   * @returns {Promise<void>}
   */
  async execute(interaction, config, args = []) {
    // Check if this is a slash command or a text command
    const isSlashCommand = interaction.isChatInputCommand?.();

    // Track this as a successful API call for stats
    trackApiCall('circuit_breaker_command', true);

    if (isSlashCommand) {
      // Handle slash command
      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'approve':
          await handleApprove(interaction);
          break;
        case 'deny':
          await handleDeny(interaction);
          break;
        case 'list':
          await handleList(interaction);
          break;
        case 'status':
          await handleStatus(interaction, config);
          break;
        case 'version':
          await handleVersion(interaction, config);
          break;
        default:
          await interaction.reply({
            content: 'Unknown subcommand. Please use one of: approve, deny, list, status, version',
            ephemeral: true,
          });
      }
    } else {
      // Handle text command
      if (!args.length) {
        await interaction.reply(
          'Please specify a subcommand: approve, deny, list, status, version'
        );
        return;
      }

      const subcommand = args[0].toLowerCase();

      switch (subcommand) {
        case 'approve':
          if (args.length < 2) {
            await interaction.reply('Please provide an approval ID to approve');
            return;
          }
          await handleApproveText(interaction, args[1]);
          break;
        case 'deny':
          if (args.length < 2) {
            await interaction.reply('Please provide an approval ID to deny');
            return;
          }
          await handleDenyText(interaction, args[1]);
          break;
        case 'list':
          await handleListText(interaction);
          break;
        case 'status':
          await handleStatusText(interaction, config);
          break;
        case 'version': {
          const detailed = args.includes('--detailed') || args.includes('-d');
          await handleVersionText(interaction, config, detailed);
          break;
        }
        default:
          await interaction.reply(
            'Unknown subcommand. Please use one of: approve, deny, list, status, version'
          );
      }
    }
  },

  /**
   * Handle slash command interactions
   * This is the method that Discord.js expects for slash commands
   */
  interactionExecute: async function (interaction, config) {
    return this.execute(interaction, config);
  },
};

/**
 * Handle the approve subcommand (slash command)
 *
 * @param {Object} interaction - The Discord interaction
 * @returns {Promise<void>}
 */
async function handleApprove(interaction) {
  const id = interaction.options.getString('id');

  try {
    const success = circuitBreaker.approveRequest(id);

    if (success) {
      await interaction.reply({
        content: `✅ Approved operation with ID: ${id}`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `❌ Failed to approve operation: Request not found or already resolved`,
        ephemeral: true,
      });
    }
  } catch (error) {
    await interaction.reply({
      content: `❌ Error approving operation: ${error.message}`,
      ephemeral: true,
    });
  }
}

/**
 * Handle the approve subcommand (text command)
 *
 * @param {Object} message - The Discord message
 * @param {string} id - The approval ID
 * @returns {Promise<void>}
 */
async function handleApproveText(message, id) {
  try {
    const success = circuitBreaker.approveRequest(id);

    if (success) {
      await message.reply(`✅ Approved operation with ID: ${id}`);
    } else {
      await message.reply(`❌ Failed to approve operation: Request not found or already resolved`);
    }
  } catch (error) {
    await message.reply(`❌ Error approving operation: ${error.message}`);
  }
}

/**
 * Handle the deny subcommand (slash command)
 *
 * @param {Object} interaction - The Discord interaction
 * @returns {Promise<void>}
 */
async function handleDeny(interaction) {
  const id = interaction.options.getString('id');

  try {
    const success = circuitBreaker.denyRequest(id);

    if (success) {
      await interaction.reply({
        content: `🚫 Denied operation with ID: ${id}`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `❌ Failed to deny operation: Request not found or already resolved`,
        ephemeral: true,
      });
    }
  } catch (error) {
    await interaction.reply({
      content: `❌ Error denying operation: ${error.message}`,
      ephemeral: true,
    });
  }
}

/**
 * Handle the deny subcommand (text command)
 *
 * @param {Object} message - The Discord message
 * @param {string} id - The approval ID
 * @returns {Promise<void>}
 */
async function handleDenyText(message, id) {
  try {
    const success = circuitBreaker.denyRequest(id);

    if (success) {
      await message.reply(`🚫 Denied operation with ID: ${id}`);
    } else {
      await message.reply(`❌ Failed to deny operation: Request not found or already resolved`);
    }
  } catch (error) {
    await message.reply(`❌ Error denying operation: ${error.message}`);
  }
}

/**
 * Handle the list subcommand (slash command)
 *
 * @param {Object} interaction - The Discord interaction
 * @returns {Promise<void>}
 */
async function handleList(interaction) {
  try {
    const pendingApprovals = circuitBreaker.listPendingApprovals();

    if (!pendingApprovals || pendingApprovals.length === 0) {
      await interaction.reply({
        content: '📋 No pending approval requests',
        ephemeral: true,
      });
      return;
    }

    let message = '📋 **Pending Approval Requests**\n\n';

    for (const approval of pendingApprovals) {
      const timestamp = Math.floor(approval.requestedAt / 1000);
      message += `**ID:** \`${approval.id}\`\n`;
      message += `**Type:** ${approval.type}\n`;
      message += `**User:** ${approval.user || 'N/A'}\n`;
      message += `**Requested:** <t:${timestamp}:R>\n`;
      message += `**Approve:** \`/circuitbreaker approve id:${approval.id}\`\n`;
      message += `**Deny:** \`/circuitbreaker deny id:${approval.id}\`\n\n`;
    }

    await interaction.reply({
      content: message,
      ephemeral: true,
    });
  } catch (error) {
    await interaction.reply({
      content: `❌ Error listing approvals: ${error.message}`,
      ephemeral: true,
    });
  }
}

/**
 * Handle the list subcommand (text command)
 *
 * @param {Object} message - The Discord message
 * @returns {Promise<void>}
 */
async function handleListText(message) {
  try {
    const pendingApprovals = circuitBreaker.listPendingApprovals();

    if (!pendingApprovals || pendingApprovals.length === 0) {
      await message.reply('📋 No pending approval requests');
      return;
    }

    let response = '📋 **Pending Approval Requests**\n\n';

    for (const approval of pendingApprovals) {
      const timestamp = Math.floor(approval.requestedAt / 1000);
      response += `**ID:** \`${approval.id}\`\n`;
      response += `**Type:** ${approval.type}\n`;
      response += `**User:** ${approval.user || 'N/A'}\n`;
      response += `**Requested:** <t:${timestamp}:R>\n`;
      response += `**Approve:** \`!circuitbreaker approve ${approval.id}\`\n`;
      response += `**Deny:** \`!circuitbreaker deny ${approval.id}\`\n\n`;
    }

    await message.reply(response);
  } catch (error) {
    await message.reply(`❌ Error listing approvals: ${error.message}`);
  }
}

/**
 * Handle the status subcommand (slash command)
 *
 * @param {Object} interaction - The Discord interaction
 * @param {Object} config - Bot configuration
 * @returns {Promise<void>}
 */
async function handleStatus(interaction, config) {
  try {
    const isOpen = breakerManager.isBreakerOpen();
    const pendingCount = circuitBreaker.listPendingApprovals().length;
    const botName = config.BOT_NAME || process.env.BOT_NAME || 'ChimpGPT';
    const versionInfo = getVersionInfo();

    let message = `📊 **${botName} Circuit Breaker Status**\n\n`;
    message += `**Version:** ${versionInfo.version}\n`;
    message += `**Circuit Breaker:** ${isOpen ? '🔴 OPEN' : '🟢 CLOSED'}\n`;
    message += `**Pending Approvals:** ${pendingCount}\n`;

    if (pendingCount > 0) {
      message += `\nUse \`/circuitbreaker list\` to view pending approvals.`;
    }

    await interaction.reply({
      content: message,
      ephemeral: false,
    });
  } catch (error) {
    await interaction.reply({
      content: `❌ Error getting status: ${error.message}`,
      ephemeral: true,
    });
  }
}

/**
 * Handle the status subcommand (text command)
 *
 * @param {Object} message - The Discord message
 * @param {Object} config - Bot configuration
 * @returns {Promise<void>}
 */
async function handleStatusText(message, config) {
  try {
    const isOpen = breakerManager.isBreakerOpen();
    const pendingCount = circuitBreaker.listPendingApprovals().length;
    const botName = config.BOT_NAME || process.env.BOT_NAME || 'ChimpGPT';
    const versionInfo = getVersionInfo();

    let response = `📊 **${botName} Circuit Breaker Status**\n\n`;
    response += `**Version:** ${versionInfo.version}\n`;
    response += `**Circuit Breaker:** ${isOpen ? '🔴 OPEN' : '🟢 CLOSED'}\n`;
    response += `**Pending Approvals:** ${pendingCount}\n`;

    if (pendingCount > 0) {
      response += `\nUse \`!circuitbreaker list\` to view pending approvals.`;
    }

    await message.reply(response);
  } catch (error) {
    await message.reply(`❌ Error getting status: ${error.message}`);
  }
}

/**
 * Handle the version subcommand (slash command)
 *
 * @param {Object} interaction - The Discord interaction
 * @param {Object} config - Bot configuration
 * @returns {Promise<void>}
 */
async function handleVersion(interaction, config) {
  try {
    const detailed = interaction.options.getBoolean('detailed') || false;
    const versionInfo = getVersionInfo(detailed);
    const botName = config.BOT_NAME || process.env.BOT_NAME || versionInfo.name || 'ChimpGPT';

    let message = `🤖 **${botName} Version Information**\n\n`;
    message += `**Version:** ${versionInfo.version}\n`;

    if (detailed) {
      // Format uptime
      const uptimeFormatted = formatUptime(versionInfo.uptime);

      message += `**Environment:** ${versionInfo.environment}\n`;
      message += `**Node.js:** ${versionInfo.nodeVersion}\n`;
      message += `**Platform:** ${versionInfo.platform}\n`;
      message += `**Uptime:** ${uptimeFormatted}\n`;
      message += `**Memory Usage:** ${Math.round(versionInfo.memory / 1024 / 1024)} MB\n`;

      // Add timestamp
      const startTime = new Date(Date.now() - versionInfo.uptime * 1000);
      message += `**Started:** <t:${Math.floor(startTime.getTime() / 1000)}:F>\n`;
    }

    await interaction.reply({
      content: message,
      ephemeral: false,
    });
  } catch (error) {
    await interaction.reply({
      content: `❌ Error getting version information: ${error.message}`,
      ephemeral: true,
    });
  }
}

/**
 * Handle the version subcommand (text command)
 *
 * @param {Object} message - The Discord message
 * @param {Object} config - Bot configuration
 * @param {boolean} detailed - Whether to show detailed information
 * @returns {Promise<void>}
 */
async function handleVersionText(message, config, detailed) {
  try {
    const versionInfo = getVersionInfo(detailed);
    const botName = config.BOT_NAME || process.env.BOT_NAME || versionInfo.name || 'ChimpGPT';

    let response = `🤖 **${botName} Version Information**\n\n`;
    response += `**Version:** ${versionInfo.version}\n`;

    if (detailed) {
      // Format uptime
      const uptimeFormatted = formatUptime(versionInfo.uptime);

      response += `**Environment:** ${versionInfo.environment}\n`;
      response += `**Node.js:** ${versionInfo.nodeVersion}\n`;
      response += `**Platform:** ${versionInfo.platform}\n`;
      response += `**Uptime:** ${uptimeFormatted}\n`;
      response += `**Memory Usage:** ${Math.round(versionInfo.memory / 1024 / 1024)} MB\n`;

      // Add timestamp
      const startTime = new Date(Date.now() - versionInfo.uptime * 1000);
      response += `**Started:** <t:${Math.floor(startTime.getTime() / 1000)}:F>\n`;
    }

    await message.reply(response);
  } catch (error) {
    await message.reply(`❌ Error getting version information: ${error.message}`);
  }
}

module.exports = circuitBreakerCommand;
