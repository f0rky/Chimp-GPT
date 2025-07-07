const { discord: discordLogger } = require('../logger');
const commandHandler = require('../../commands/commandHandler');

class InteractionEventHandler {
  constructor(client, config) {
    this.client = client;
    this.config = config;

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.on('interactionCreate', this.handleInteractionCreate.bind(this));
  }

  async handleInteractionCreate(interaction) {
    try {
      // Only handle chat input commands (slash commands)
      if (!interaction.isChatInputCommand()) return;

      // Use the command handler to process the interaction
      await commandHandler.handleSlashCommand(interaction, this.config);
    } catch (error) {
      discordLogger.error({ error }, 'Error handling interaction');

      // Reply with error if we haven't replied yet
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing this command.',
          ephemeral: true,
        });
      } else if (!interaction.replied) {
        await interaction.editReply('An error occurred while processing this command.');
      }
    }
  }
}

module.exports = InteractionEventHandler;
