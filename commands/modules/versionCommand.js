/**
 * Version Command
 * 
 * This command allows users to query the bot's version and system information
 * through a slash command.
 * 
 * @module VersionCommand
 * @author Brett
 * @version 1.0.0
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { getDetailedVersionInfo } = require('../../getBotVersion');
const { generateVersionResponse } = require('../../utils/versionSelfQuery');
const { trackApiCall } = require('../../healthCheck');
const { formatUptime } = require('../../utils/formatters');

// Create the command definition
const versionCommand = {
  name: 'version',
  description: 'Get information about the bot version',
  aliases: ['ver', 'v'],
  dmAllowed: true, // Allow in DMs
  
  // Slash command definition
  slashCommand: new SlashCommandBuilder()
    .setName('version')
    .setDescription('Get information about the bot version')
    .addBooleanOption(option => 
      option.setName('detailed')
        .setDescription('Show detailed information')
        .setRequired(false))
    .addBooleanOption(option => 
      option.setName('technical')
        .setDescription('Show technical system information')
        .setRequired(false)),
  
  /**
   * Execute the version command
   * 
   * @param {Object} interaction - The Discord interaction or message
   * @param {Object} config - Bot configuration
   * @param {string[]} [args=[]] - Command arguments (for text commands)
   * @returns {Promise<void>}
   */
  async execute(interaction, config, args = []) {
    // Check if this is a slash command or a text command
    const isSlashCommand = interaction.isChatInputCommand?.();
    
    // Get options based on command type
    let detailed = false;
    let technical = false;
    
    if (isSlashCommand) {
      detailed = interaction.options.getBoolean('detailed') || false;
      technical = interaction.options.getBoolean('technical') || false;
    } else {
      // Parse arguments for text commands
      detailed = args.includes('detailed') || args.includes('detail') || args.includes('d');
      technical = args.includes('technical') || args.includes('tech') || args.includes('t');
    }
    
    // Track this as a successful API call for stats
    trackApiCall('version_command', true);
    
    // Generate the version response
    const response = generateVersionResponse({
      detailed,
      technical,
      config
    });
    
    // Get the detailed version info for the embed
    const versionInfo = getDetailedVersionInfo();
    const botName = config.BOT_NAME || process.env.BOT_NAME || versionInfo.name || 'ChimpGPT';
    
    // Send the response based on command type
    if (isSlashCommand) {
      // Create a rich embed for slash commands
      const embed = new EmbedBuilder()
        .setColor('#00AAFF')
        .setTitle(`${botName} Version Information`)
        .setDescription(`Version: **${versionInfo.version}**`)
        .addFields(
          { name: 'AI Model', value: versionInfo.aiModel || 'Unknown', inline: true },
          { name: 'Environment', value: versionInfo.environment, inline: true }
        )
        .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();
      
      // Add detailed and technical information if requested
      if (detailed) {
        embed.addFields(
          { name: 'Node.js Version', value: versionInfo.nodeVersion, inline: true },
          { name: 'Platform', value: versionInfo.platform, inline: true }
        );
        
        if (technical) {
          const memoryUsageMB = (versionInfo.memory / 1024 / 1024).toFixed(1);
          const uptimeFormatted = formatUptime(versionInfo.uptime);
          const startTime = new Date(new Date().getTime() - (versionInfo.uptime * 1000));
          
          embed.addFields(
            { name: 'Memory Usage', value: `${memoryUsageMB} MB`, inline: true },
            { name: 'Uptime', value: uptimeFormatted, inline: true },
            { name: 'Started At', value: startTime.toISOString().replace('T', ' ').substring(0, 19), inline: false }
          );
        }
      }
      
      await interaction.reply({
        embeds: [embed],
        ephemeral: false // Make it visible to everyone
      });
    } else {
      // For text commands, use the simple text response
      await interaction.reply(response);
    }
  }
};

module.exports = versionCommand;
