const { discord: discordLogger } = require('../logger');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const commandHandler = require('../../commands/commandHandler');
const { generateImage } = require('../../services/imageGeneration');

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
      // Handle button interactions
      if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
        return;
      }

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

  async handleButtonInteraction(interaction) {
    const { customId } = interaction;

    if (customId.startsWith('hd_upgrade:')) {
      await this.handleHdUpgrade(interaction);
      return;
    }

    // Unknown button — ignore
    discordLogger.debug({ customId }, 'Unhandled button interaction');
  }

  async handleHdUpgrade(interaction) {
    // Extract the original prompt from the customId
    const encodedPrompt = interaction.customId.slice('hd_upgrade:'.length);
    const originalPrompt = decodeURIComponent(encodedPrompt);

    discordLogger.info(
      { promptPreview: originalPrompt.substring(0, 60), messageId: interaction.message.id },
      'HD upgrade requested'
    );

    try {
      // Immediately defer the update so the button doesn't time out
      await interaction.deferUpdate();

      // Show "Generating HD..." disabled button while we work
      const pendingRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('hd_upgrade_pending')
          .setLabel('⏳ Generating HD...')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      await interaction.editReply({ components: [pendingRow] });

      // Generate HD image: chatgpt-image-latest (points to best available model), 1024×1024, high quality
      const hdGenStart = Date.now();
      const imageResult = await generateImage(originalPrompt, {
        model: 'chatgpt-image-latest',
        size: '1024x1024',
        quality: 'high',
      });
      const hdElapsedSec = ((Date.now() - hdGenStart) / 1000).toFixed(1);

      if (!imageResult.success) {
        discordLogger.warn(
          { error: imageResult.error, prompt: originalPrompt.substring(0, 60) },
          'HD image generation failed'
        );

        // Show error state — remove button
        await interaction.editReply({
          content: `${interaction.message.content}\n\n⚠️ HD upgrade failed: ${imageResult.error}`,
          components: [],
        });
        return;
      }

      // imageResult.images[0] contains either b64_json or url
      const hdImage = imageResult.images[0];
      let imageBuffer;

      if (hdImage.b64_json) {
        // Base64 response — convert to Buffer directly
        imageBuffer = Buffer.from(hdImage.b64_json, 'base64');
      } else if (hdImage.url) {
        // URL response — download
        imageBuffer = await this.downloadImageBuffer(hdImage.url);
      }

      if (!imageBuffer) {
        throw new Error('No image data in HD generation response');
      }

      const fileName = `hd_image_${Date.now()}.png`;
      const hdMetaLine = `\n_Model: chatgpt-image-latest (high) · ${hdElapsedSec}s_`;

      // Edit the original message to remove the button, keep original image intact
      await interaction.editReply({
        content: `${interaction.message.content}\n⬆️ HD version below ↓`,
        components: [],
      });

      // Post HD image as a new follow-up so users can compare
      await interaction.followUp({
        content: `🖼️ **HD Version** — ${originalPrompt.substring(0, 100)}${originalPrompt.length > 100 ? '...' : ''}${hdMetaLine}`,
        files: [{ attachment: imageBuffer, name: fileName }],
      });

      discordLogger.info(
        { messageId: interaction.message.id, bufferSize: imageBuffer.length },
        'HD upgrade completed successfully'
      );
    } catch (error) {
      discordLogger.error({ error, prompt: originalPrompt.substring(0, 60) }, 'HD upgrade error');

      try {
        // Remove the button on error so the user isn't stuck
        await interaction.editReply({
          content: `${interaction.message.content}\n\n❌ HD upgrade failed. Please try again.`,
          components: [],
        });
      } catch (editError) {
        discordLogger.error({ editError }, 'Failed to update message after HD upgrade error');
      }
    }
  }

  /**
   * Download an image from a URL and return a Buffer.
   * @param {string} url
   * @returns {Promise<Buffer>}
   */
  downloadImageBuffer(url) {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const http = require('http');
      const client = url.startsWith('https') ? https : http;

      client
        .get(url, response => {
          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download HD image: HTTP ${response.statusCode}`));
            return;
          }
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
        })
        .on('error', reject);
    });
  }
}

module.exports = InteractionEventHandler;
