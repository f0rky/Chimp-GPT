/**
 * Ping Command Module
 * 
 * A simple command to test the bot's responsiveness and command system.
 * 
 * @module PingCommand
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../../logger');
const logger = createLogger('commands:ping');
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'ping',
  aliases: ['pong', 'test'],
  description: 'Check if the bot is responding',
  dmAllowed: true, // This command can be used in DMs
  
  // Define slash command
  slashCommand: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is responding'),
  
  /**
   * Execute the ping command (text command version)
   * 
   * @param {import('discord.js').Message} message - Discord message object
   * @param {string[]} args - Command arguments
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async execute(message, args, config) {
    logger.info({ 
      userId: message.author.id, 
      username: message.author.username
    }, 'Ping command used');
    
    try {
      // Calculate bot latency
      const sentMessage = await message.reply('Pinging...');
      const latency = sentMessage.createdTimestamp - message.createdTimestamp;
      
      // Calculate Discord API latency
      const apiLatency = Math.round(message.client.ws.ping);
      
      await sentMessage.edit(`🏓 Pong! Bot latency: ${latency}ms | API latency: ${apiLatency}ms`);
    } catch (error) {
      logger.error({ error }, 'Error executing ping command');
      await message.reply('An error occurred while checking latency.');
    }
  },
  
  /**
   * Execute the ping command (slash command version)
   * 
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction object
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async executeSlash(interaction, config) {
    return this.interactionExecute(interaction, config);
  },
  
  /**
   * Execute the ping command (slash command version)
   * 
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction object
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async interactionExecute(interaction, config) {
    logger.info({ 
      userId: interaction.user.id, 
      username: interaction.user.username
    }, 'Ping slash command used');
    
    try {
      // Defer reply to show the bot is processing
      await interaction.deferReply();
      
      // Calculate bot latency
      const latency = Date.now() - interaction.createdTimestamp;
      
      // Calculate Discord API latency
      const apiLatency = Math.round(interaction.client.ws.ping);
      
      await interaction.editReply(`🏓 Pong! Bot latency: ${latency}ms | API latency: ${apiLatency}ms`);
    } catch (error) {
      logger.error({ error }, 'Error executing ping slash command');
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'An error occurred while checking latency.', ephemeral: true });
      } else {
        await interaction.editReply('An error occurred while checking latency.');
      }
    }
  }
};
