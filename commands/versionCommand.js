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
const { generateVersionResponse } = require('../utils/versionSelfQuery');
const { trackApiCall } = require('../healthCheck');

// Create the command definition
const versionCommand = {
  data: new SlashCommandBuilder()
    .setName('version')
    .setDescription('Get information about the bot version')
    .addBooleanOption(option =>
      option.setName('detailed').setDescription('Show detailed information').setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('technical')
        .setDescription('Show technical system information')
        .setRequired(false)
    ),

  /**
   * Execute the version command
   *
   * @param {Object} interaction - The Discord interaction
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async execute(interaction, config) {
    // Get options
    const detailed = interaction.options.getBoolean('detailed') || false;
    const technical = interaction.options.getBoolean('technical') || false;

    // Track this as a successful API call for stats
    trackApiCall('version_command', true);

    // Generate the version response
    const response = generateVersionResponse({
      detailed,
      technical,
      config,
    });

    // Send the response
    await interaction.reply({
      content: response,
      ephemeral: false, // Make it visible to everyone
    });
  },
};

module.exports = versionCommand;
