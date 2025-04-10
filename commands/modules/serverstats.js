/**
 * Quake Server Stats Command Module
 * 
 * This command provides statistics about Quake Live servers,
 * including player information, map details, and game status.
 * It implements the compact display format preferred by the user.
 * 
 * @module ServerStatsCommand
 * @author Brett
 * @version 1.0.0
 */

const lookupQuakeServer = require('../../quakeLookup');
const { createLogger } = require('../../logger');
const { trackApiCall } = require('../../healthCheck');
const { validateServerInput, validateEloMode, sanitizeDiscordMessage } = require('../../utils/inputValidator');
const logger = createLogger('commands:serverstats');
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'serverstats',
  aliases: ['server', 'ql', 'quake'],
  description: 'Display Quake Live server statistics',
  dmAllowed: true, // This command can be used in DMs
  
  // Define slash command
  slashCommand: new SlashCommandBuilder()
    .setName('serverstats')
    .setDescription('Display Quake Live server statistics')
    .addStringOption(option =>
      option.setName('server')
        .setDescription('Server name or IP address')
        .setRequired(false))
    .addIntegerOption(option =>
      option.setName('elomode')
        .setDescription('ELO display mode (0=off, 1=categories, 2=values)')
        .setRequired(false)
        .addChoices(
          { name: 'Off', value: 0 },
          { name: 'Categories', value: 1 },
          { name: 'Values', value: 2 }
        )),
  
  /**
   * Execute the serverstats command (text command version)
   * 
   * @param {import('discord.js').Message} message - Discord message object
   * @param {string[]} args - Command arguments
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async execute(message, args, config) {
    logger.info({ 
      userId: message.author.id, 
      username: message.author.username,
      args
    }, 'Server stats command used');
    
    try {
      // Send initial feedback
      const feedbackMessage = await message.reply('🎯 Checking server stats...');
      
      // Validate server argument
      const serverArg = args.length > 0 ? args[0] : null;
      const validatedServer = validateServerInput(serverArg);
      
      if (serverArg && !validatedServer.isValid) {
        await feedbackMessage.edit('⚠️ Invalid server name or IP address provided. Please try again with a valid input.');
        return;
      }
      
      // Validate ELO mode argument
      let eloMode = null;
      if (args.length > 1) {
        const validatedEloMode = validateEloMode(args[1]);
        if (!validatedEloMode.isValid) {
          await feedbackMessage.edit('⚠️ Invalid ELO mode. Please use 0 (off), 1 (categories), or 2 (values).');
          return;
        }
        eloMode = validatedEloMode.value;
      }
      
      // Track API call in health check system
      trackApiCall('quake');
      
      // Get server stats with optional server filter and ELO mode
      const serverStats = await lookupQuakeServer(validatedServer.value, eloMode);
      
      // Send the sanitized server stats to the channel
      await feedbackMessage.edit(sanitizeDiscordMessage(serverStats));
    } catch (error) {
      logger.error({ error }, 'Error executing server stats command');
      await message.reply('An error occurred while retrieving server statistics.');
    }
  },
  
  /**
   * Execute the serverstats command (slash command version)
   * 
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction object
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async executeSlash(interaction, config) {
    return this.interactionExecute(interaction, config);
  },
  
  /**
   * Execute the serverstats command (slash command version)
   * 
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction object
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async interactionExecute(interaction, config) {
    logger.info({ 
      userId: interaction.user.id, 
      username: interaction.user.username,
      options: {
        server: interaction.options.getString('server'),
        eloMode: interaction.options.getInteger('elomode')
      }
    }, 'Server stats slash command used');
    
    try {
      // Defer reply to show the bot is processing
      await interaction.deferReply();
      
      // Get and validate options from the interaction
      const serverArg = interaction.options.getString('server');
      const validatedServer = validateServerInput(serverArg);
      
      if (serverArg && !validatedServer.isValid) {
        await interaction.editReply('⚠️ Invalid server name or IP address provided. Please try again with a valid input.');
        return;
      }
      
      // Validate ELO mode
      const eloModeArg = interaction.options.getInteger('elomode');
      const validatedEloMode = validateEloMode(eloModeArg);
      
      if (eloModeArg !== null && !validatedEloMode.isValid) {
        await interaction.editReply('⚠️ Invalid ELO mode. Please use 0 (off), 1 (categories), or 2 (values).');
        return;
      }
      
      // Track API call in health check system
      trackApiCall('quake');
      
      // Get server stats with optional server filter and ELO mode
      const serverStats = await lookupQuakeServer(validatedServer.value, validatedEloMode.value);
      
      // Send the sanitized server stats as a reply
      await interaction.editReply(sanitizeDiscordMessage(serverStats));
    } catch (error) {
      logger.error({ error }, 'Error executing server stats slash command');
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'An error occurred while retrieving server statistics.', ephemeral: true });
      } else {
        await interaction.editReply('An error occurred while retrieving server statistics.');
      }
    }
  }
};
