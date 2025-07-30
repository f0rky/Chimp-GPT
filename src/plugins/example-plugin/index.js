/**
 * Example Plugin for ChimpGPT
 *
 * This is a simple example plugin that demonstrates the plugin system.
 * It adds a basic greeting command, sends status reports to the owner,
 * and logs when the bot starts and stops.
 *
 * @version 1.0.0
 * @author Brett
 */

const { SlashCommandBuilder } = require('discord.js');
const { createLogger } = require('../../core/logger');
const config = require('../../core/configValidator');
const os = require('os');

// Create a logger for this plugin
const logger = createLogger('example-plugin');

// Export the plugin
module.exports = {
  // Required metadata
  id: 'example-plugin',
  name: 'Example Plugin',
  version: '1.0.0',

  // Optional metadata
  description: 'A simple example plugin for ChimpGPT',
  author: 'Brett',

  // Discord slash commands
  commands: [
    {
      name: 'greet',
      description: 'Get a friendly greeting',
      aliases: ['hello', 'hi', 'hey'],
      dmAllowed: true,
      options: [
        {
          name: 'name',
          description: 'Your name (optional)',
          type: 3, // STRING type
          required: false,
        },
      ],

      // Add SlashCommandBuilder for Discord.js integration
      slashCommand: new SlashCommandBuilder()
        .setName('greet')
        .setDescription('Get a friendly greeting')
        .addStringOption(option =>
          option.setName('name').setDescription('Your name (optional)').setRequired(false)
        ),

      // Command execution for message commands
      execute: async message => {
        const name = message.author.username;
        return message.reply(`Hello, ${name}! 👋 I'm ChimpGPT, your friendly Discord bot.`);
      },

      // Command execution for slash commands
      interactionExecute: async interaction => {
        const name = interaction.options.getString('name') || interaction.user.username;
        return interaction.reply({
          content: `Hello, ${name}! 👋 I'm ChimpGPT, your friendly Discord bot.`,
        });
      },
    },
    {
      name: 'status-report',
      description: 'Send a status report to the bot owner',
      aliases: ['report', 'status', 'health'],
      dmAllowed: true,
      options: [],

      // Add SlashCommandBuilder for Discord.js integration
      slashCommand: new SlashCommandBuilder()
        .setName('status-report')
        .setDescription('Send a status report to the bot owner'),

      // Command execution for message commands
      execute: async message => {
        // Only allow the owner to use this command
        if (message.author.id !== config.OWNER_ID) {
          return message.reply('Sorry, only the bot owner can use this command.');
        }

        await sendStatusReport(message.client);
        return message.reply('Status report sent to the owner!');
      },

      // Command execution for slash commands
      interactionExecute: async interaction => {
        // Log the interaction for debugging
        logger.info(
          {
            userId: interaction.user.id,
            ownerId: config.OWNER_ID,
            isOwner: interaction.user.id === config.OWNER_ID,
          },
          'Status report command executed'
        );

        // Only allow the owner to use this command
        if (interaction.user.id !== config.OWNER_ID) {
          logger.info('Non-owner tried to use status-report command');
          return interaction.reply({
            content: 'Sorry, only the bot owner can use this command.',
            ephemeral: true,
          });
        }

        try {
          await sendStatusReport(interaction.client);
          logger.info('Status report sent via slash command');
          return interaction.reply({
            content: 'Status report sent to the owner!',
            ephemeral: true,
          });
        } catch (error) {
          logger.error({ error }, 'Error sending status report via slash command');
          return interaction.reply({
            content: 'Failed to send status report. Check logs for details.',
            ephemeral: true,
          });
        }
      },
    },
  ],

  // Functions that can be called by the bot
  functions: {
    getRandomGreeting: () => {
      const greetings = ['Hello there!', 'Hi!', 'Greetings!', 'Hey!', 'Howdy!', 'Good day!'];
      return greetings[Math.floor(Math.random() * greetings.length)];
    },

    generateStatusReport: () => {
      return generateStatusReport();
    },

    sendStatusReport: async client => {
      return await sendStatusReport(client);
    },
  },

  // Hooks that are triggered at specific points in the bot's execution
  hooks: {
    // Called when the bot starts
    onBotStart: async client => {
      logger.info('Bot started! Example plugin is now active.');
      logger.info(`Connected to ${client.guilds.cache.size} servers.`);

      // Use the startup message coordinator
      try {
        const startupCoordinator = require('../../utils/startupMessageCoordinator');

        // Register example plugin as a component
        startupCoordinator.registerComponent('example-plugin');

        // Generate the status report
        const statusReport = generateStatusReport();

        // Add the embed to the coordinator
        startupCoordinator.addEmbed('example-plugin', {
          title: '🔌 Plugin Status',
          description: statusReport,
          color: 0x00ff00,
          timestamp: new Date(),
        });

        logger.info('Added plugin status to startup message');
      } catch (error) {
        logger.error({ error }, 'Failed to add plugin status to startup message');
      }

      // Schedule periodic status reports (every 6 hours)
      const REPORT_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

      // Store the interval ID so we can clear it on shutdown
      client.examplePluginInterval = setInterval(async () => {
        try {
          await sendStatusReport(client);
          logger.info('Scheduled status report sent to owner');
        } catch (error) {
          logger.error({ error }, 'Failed to send scheduled status report');
        }
      }, REPORT_INTERVAL);

      logger.info(`Scheduled status reports every ${REPORT_INTERVAL / (60 * 60 * 1000)} hours`);
    },

    // Called when the bot is shutting down
    onBotShutdown: async client => {
      logger.info('Bot is shutting down. Example plugin says goodbye!');

      // Clear the scheduled status reports interval
      if (client && client.examplePluginInterval) {
        clearInterval(client.examplePluginInterval);
        logger.info('Cleared scheduled status reports interval');
      }
    },

    // Called when a message is received before processing
    onMessageReceived: async message => {
      // Only log messages in console, don't interfere with processing
      if (message.content.toLowerCase().includes('hello') && !message.author.bot) {
        logger.debug(
          {
            author: message.author.username,
            content: message.content,
          },
          'Detected a greeting in a message'
        );
      }

      // Handle the !status-report command
      if (
        message.content.toLowerCase() === '!status-report' ||
        message.content.toLowerCase() === '.status-report'
      ) {
        logger.info(
          {
            userId: message.author.id,
            ownerId: config.OWNER_ID,
            isOwner: message.author.id === config.OWNER_ID,
          },
          'Status report message command received'
        );

        // Only allow the owner to use this command
        if (message.author.id !== config.OWNER_ID) {
          logger.info('Non-owner tried to use status-report command');
          await message.reply('Sorry, only the bot owner can use this command.');
          return true; // We handled the message
        }

        try {
          await sendStatusReport(message.client);
          logger.info('Status report sent via message command');
          await message.reply('Status report sent to the owner!');
        } catch (error) {
          logger.error({ error }, 'Error sending status report via message command');
          await message.reply('Failed to send status report. Check logs for details.');
        }

        return true; // We handled the message
      }

      // Return true to continue processing the message
      return true;
    },
  },
};

/**
 * Generate a status report with system and bot information
 *
 * @returns {string} Formatted status report
 */
function generateStatusReport() {
  // Get system information
  const cpuCount = os.cpus().length;
  const totalMemory = Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10; // GB
  const freeMemory = Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10; // GB
  const usedMemory = Math.round((totalMemory - freeMemory) * 10) / 10; // GB
  const memoryUsage = Math.round((usedMemory / totalMemory) * 100);
  const uptime = Math.floor(os.uptime() / 3600); // hours
  const loadAvg = os.loadavg()[0].toFixed(2);

  // Format the report
  return `## 🤖 Example Plugin Status Report

**System Information:**
• Platform: ${os.platform()} ${os.release()}
• CPU: ${cpuCount} cores
• Memory: ${usedMemory}GB / ${totalMemory}GB (${memoryUsage}%)
• System Uptime: ${uptime} hours
• Load Average: ${loadAvg}

**Plugin Status:**
• Plugin: Example Plugin
• Version: 1.0.0
• Status: Active
• Generated: ${new Date().toISOString()}

This is a demonstration of how plugins can send status reports to the bot owner.`;
}

/**
 * Send a status report to the bot owner
 *
 * @param {import('discord.js').Client} client - Discord.js client
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function sendStatusReport(client) {
  try {
    // Generate the status report
    const report = generateStatusReport();

    // Get the owner user
    const owner = await client.users.fetch(config.OWNER_ID);
    if (!owner) {
      logger.error('Could not find owner user');
      return false;
    }

    // Send the report to the owner
    await owner.send(report);
    logger.info('Status report sent to owner');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to send status report');
    return false;
  }
}
