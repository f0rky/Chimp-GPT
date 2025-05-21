/**
 * Image Usage Statistics Command
 * 
 * Displays statistics about image generation usage and costs
 */

const { createLogger } = require('../../logger');
const logger = createLogger('cmd-image-stats');
const { MessageEmbed } = require('discord.js');

// Command definition
module.exports = {
  name: 'imagestats',
  description: 'Shows statistics about image generation usage and costs',
  aliases: ['imgstats', 'imagecosts'],
  usage: '[days]',
  ownerOnly: true,
  adminOnly: false,
  dmAllowed: true,
  hasSlashCommand: true,
  
  /**
   * Execute the command
   * @param {Object} message - The message object
   * @param {Array} args - Command arguments
   */
  async execute(message, args) {
    try {
      // Get the image usage tracker
      const imageUsageTracker = require('../../imageUsageTracker');
      
      // Parse days argument if provided
      let days = 30; // Default to 30 days
      if (args.length > 0 && !isNaN(args[0])) {
        days = parseInt(args[0]);
      }
      
      // Calculate the start date based on the number of days
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      // Get the usage report
      const options = {
        startDate: startDate.toISOString()
      };
      
      const stats = imageUsageTracker.getUsageStats(options);
      
      // Create a rich embed for the response
      const embed = {
        title: '🖼️ Image Generation Statistics',
        color: 0x00AAFF,
        fields: [
          {
            name: '📊 Usage Period',
            value: `Last ${days} days (${new Date(stats.period.start).toLocaleDateString()} - ${new Date(stats.period.end).toLocaleDateString()})`,
            inline: false
          },
          {
            name: '🔢 Total Requests',
            value: stats.totalRequests.toString(),
            inline: true
          },
          {
            name: '💰 Total Cost',
            value: `$${stats.totalCost.toFixed(4)}`,
            inline: true
          },
          {
            name: '📈 Average Cost',
            value: `$${stats.averageCost.toFixed(4)} per image`,
            inline: true
          }
        ],
        footer: {
          text: `Use '!imagestats [days]' to change the time period`
        },
        timestamp: new Date()
      };
      
      // Add recent entries if available
      if (stats.recentEntries.length > 0) {
        const recentList = stats.recentEntries
          .slice(0, 5) // Limit to 5 most recent
          .map((entry, i) => {
            const date = new Date(entry.timestamp).toLocaleString();
            return `**${i+1}.** ${date} - ${entry.size} - $${entry.cost.toFixed(4)} - ${entry.username}`;
          })
          .join('\n');
        
        embed.fields.push({
          name: '🕒 Recent Requests',
          value: recentList || 'No recent requests',
          inline: false
        });
      }
      
      // Send the response
      await message.channel.send({ embeds: [embed] });
      
      logger.info({
        userId: message.author.id,
        username: message.author.username,
        days
      }, 'Image stats command executed');
      
    } catch (error) {
      logger.error({ error }, 'Error executing image stats command');
      await message.reply('❌ An error occurred while retrieving image statistics.');
    }
  },
  
  /**
   * Execute the slash command
   * @param {Object} interaction - The interaction object
   */
  async slashExecute(interaction) {
    try {
      // Get optional days parameter
      const days = interaction.options.getInteger('days') || 30;
      
      // Get the image usage tracker
      const imageUsageTracker = require('../../imageUsageTracker');
      
      // Calculate the start date based on the number of days
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      // Get the usage report
      const options = {
        startDate: startDate.toISOString()
      };
      
      const stats = imageUsageTracker.getUsageStats(options);
      
      // Create a rich embed for the response
      const embed = {
        title: '🖼️ Image Generation Statistics',
        color: 0x00AAFF,
        fields: [
          {
            name: '📊 Usage Period',
            value: `Last ${days} days (${new Date(stats.period.start).toLocaleDateString()} - ${new Date(stats.period.end).toLocaleDateString()})`,
            inline: false
          },
          {
            name: '🔢 Total Requests',
            value: stats.totalRequests.toString(),
            inline: true
          },
          {
            name: '💰 Total Cost',
            value: `$${stats.totalCost.toFixed(4)}`,
            inline: true
          },
          {
            name: '📈 Average Cost',
            value: `$${stats.averageCost.toFixed(4)} per image`,
            inline: true
          }
        ],
        footer: {
          text: `Use '/imagestats days:[number]' to change the time period`
        },
        timestamp: new Date()
      };
      
      // Add recent entries if available
      if (stats.recentEntries.length > 0) {
        const recentList = stats.recentEntries
          .slice(0, 5) // Limit to 5 most recent
          .map((entry, i) => {
            const date = new Date(entry.timestamp).toLocaleString();
            return `**${i+1}.** ${date} - ${entry.size} - $${entry.cost.toFixed(4)} - ${entry.username}`;
          })
          .join('\n');
        
        embed.fields.push({
          name: '🕒 Recent Requests',
          value: recentList || 'No recent requests',
          inline: false
        });
      }
      
      // Send the response
      await interaction.reply({ embeds: [embed], ephemeral: true });
      
      logger.info({
        userId: interaction.user.id,
        username: interaction.user.username,
        days
      }, 'Image stats slash command executed');
      
    } catch (error) {
      logger.error({ error }, 'Error executing image stats slash command');
      await interaction.reply({ 
        content: '❌ An error occurred while retrieving image statistics.', 
        ephemeral: true 
      });
    }
  },
  
  // Slash command options
  slashCommandOptions: [
    {
      name: 'days',
      description: 'Number of days to show statistics for',
      type: 4, // INTEGER type
      required: false
    }
  ]
};
