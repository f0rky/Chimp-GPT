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

const { createLogger } = require('../../core/logger');
const { trackApiCall } = require('../../core/healthCheck');
const { validateServerInput, validateEloMode } = require('../../utils/inputValidator');
const { limitQuakeContent } = require('../../utils/quakeContentLimit');
const {
  scheduleMessageDeletion,
  scheduleQuakeResultLifecycle,
} = require('../../utils/temporaryMessage');
const logger = createLogger('commands:serverstats');
const { SlashCommandBuilder } = require('discord.js');

function lookupQuakeServer(...args) {
  return require('../../services/quakeLookup')(...args);
}

function scheduleQuakeLifecycle(resultMessage, serverFilter, eloMode, options) {
  if (options.scheduleDeletion) return options.scheduleDeletion(resultMessage);

  return (options.scheduleLifecycle || scheduleQuakeResultLifecycle)(
    resultMessage,
    async message => {
      (options.trackApiCall || trackApiCall)('quake');
      const refreshedStats = await (options.lookup || lookupQuakeServer)(serverFilter, eloMode, {
        forceRefresh: true,
      });
      await message.edit(limitQuakeContent(refreshedStats));
    }
  );
}

function parseTextArguments(args) {
  if (args.length === 0) return { serverFilter: null, eloMode: null };
  const possibleElo = args.length > 1 ? validateEloMode(args.at(-1)) : { isValid: false };
  const serverParts = possibleElo.isValid ? args.slice(0, -1) : args;
  return {
    serverFilter: serverParts.join(' ') || null,
    eloMode: possibleElo.isValid ? possibleElo.value : null,
  };
}

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
      option.setName('server').setDescription('Server name or IP address').setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName('elomode')
        .setDescription('ELO display mode (0=off, 1=categories, 2=values)')
        .setRequired(false)
        .addChoices(
          { name: 'Off', value: 0 },
          { name: 'Categories', value: 1 },
          { name: 'Values', value: 2 }
        )
    ),

  /**
   * Execute the serverstats command (text command version)
   *
   * @param {import('discord.js').Message} message - Discord message object
   * @param {string[]} args - Command arguments
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async execute(message, args, options = {}) {
    logger.info(
      {
        userId: message.author.id,
        username: message.author.username,
        args,
      },
      'Server stats command used'
    );

    let resultMessage;
    try {
      resultMessage = await message.reply('🔍 Checking server stats...');

      // Validate server argument
      const parsed = parseTextArguments(args);
      const serverArg = parsed.serverFilter;
      const validatedServer = validateServerInput(serverArg);

      if (serverArg && !validatedServer.isValid) {
        await resultMessage.edit('⚠️ Invalid server name or IP address provided.');
        (options.scheduleDeletion || scheduleMessageDeletion)(resultMessage);
        return;
      }

      // Validate ELO mode argument
      const eloMode = parsed.eloMode;

      (options.trackApiCall || trackApiCall)('quake');
      const serverStats = await (options.lookup || lookupQuakeServer)(
        validatedServer.value,
        eloMode
      );
      await resultMessage.edit(limitQuakeContent(serverStats));
      scheduleQuakeLifecycle(resultMessage, validatedServer.value, eloMode, options);
    } catch (error) {
      logger.error({ error }, 'Error executing server stats command');
      if (resultMessage) {
        await resultMessage.edit('An error occurred while retrieving server statistics.');
        (options.scheduleDeletion || scheduleMessageDeletion)(resultMessage);
      } else {
        const errorMessage = await message.reply(
          'An error occurred while retrieving server statistics.'
        );
        (options.scheduleDeletion || scheduleMessageDeletion)(errorMessage);
      }
    }
  },

  /**
   * Execute the serverstats command (slash command version)
   *
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction object
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async executeSlash(interaction, options) {
    return this.interactionExecute(interaction, options);
  },

  /**
   * Execute the serverstats command (slash command version)
   *
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction object
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async interactionExecute(interaction, options = {}) {
    logger.info(
      {
        userId: interaction.user.id,
        username: interaction.user.username,
        options: {
          server: interaction.options.getString('server'),
          eloMode: interaction.options.getInteger('elomode'),
        },
      },
      'Server stats slash command used'
    );

    try {
      await interaction.deferReply();

      // Get and validate options from the interaction
      const serverArg = interaction.options.getString('server');
      const validatedServer = validateServerInput(serverArg);

      if (serverArg && !validatedServer.isValid) {
        const resultMessage = await interaction.editReply(
          '⚠️ Invalid server name or IP address provided. Please try again with a valid input.'
        );
        (options.scheduleDeletion || scheduleMessageDeletion)(resultMessage);
        return;
      }

      // Validate ELO mode
      const eloModeArg = interaction.options.getInteger('elomode');
      const validatedEloMode = validateEloMode(eloModeArg);

      if (eloModeArg !== null && !validatedEloMode.isValid) {
        const resultMessage = await interaction.editReply(
          '⚠️ Invalid ELO mode. Please use 0 (off), 1 (categories), or 2 (values).'
        );
        (options.scheduleDeletion || scheduleMessageDeletion)(resultMessage);
        return;
      }

      (options.trackApiCall || trackApiCall)('quake');
      const serverStats = await (options.lookup || lookupQuakeServer)(
        validatedServer.value,
        validatedEloMode.value
      );
      const resultMessage = await interaction.editReply(limitQuakeContent(serverStats));
      scheduleQuakeLifecycle(resultMessage, validatedServer.value, validatedEloMode.value, options);
    } catch (error) {
      logger.error({ error }, 'Error executing server stats slash command');

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while retrieving server statistics.',
        });
        const resultMessage =
          typeof interaction.fetchReply === 'function' ? await interaction.fetchReply() : null;
        (options.scheduleDeletion || scheduleMessageDeletion)(resultMessage);
      } else {
        const resultMessage = await interaction.editReply(
          'An error occurred while retrieving server statistics.'
        );
        (options.scheduleDeletion || scheduleMessageDeletion)(resultMessage);
      }
    }
  },
};

module.exports.parseTextArguments = parseTextArguments;
