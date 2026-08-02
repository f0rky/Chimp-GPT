const { discord: discordLogger } = require('../logger');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const commandHandler = require('../../commands/commandHandler');
const { generateImage } = require('../../services/imageGeneration');
const { downloadImage } = require('../../utils/imageDownloader');

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

    if (customId.startsWith('image_upscale:')) {
      await this.handleHdUpgrade(interaction, 'image_upscale:');
      return;
    }

    if (customId.startsWith('image_remix:')) {
      await this.handleRemix(interaction);
      return;
    }

    // Backward compatibility for image messages created before the action buttons.
    if (customId.startsWith('hd_upgrade:')) {
      await this.handleHdUpgrade(interaction, 'hd_upgrade:');
      return;
    }

    // Unknown button — ignore
    discordLogger.debug({ customId }, 'Unhandled button interaction');
  }

  async handleHdUpgrade(interaction, prefix = 'image_upscale:') {
    // Extract the original prompt from the custom ID.
    const encodedPrompt = interaction.customId.slice(prefix.length);
    let originalPrompt;
    try {
      originalPrompt = decodeURIComponent(encodedPrompt);
    } catch (decodeError) {
      discordLogger.error(
        { encodedPrompt, error: decodeError.message },
        'Failed to decode HD upgrade prompt'
      );
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ HD upgrade failed — invalid prompt data.',
          ephemeral: true,
        });
      } else {
        await interaction.editReply('❌ HD upgrade failed — invalid prompt data.');
      }
      return;
    }

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

      // Generate HD image with gpt-image-2, 1024×1024, high quality
      const hdGenStart = Date.now();
      const imageResult = await generateImage(originalPrompt, {
        provider: 'openai',
        model: 'gpt-image-2',
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
        imageBuffer = await downloadImage(hdImage.url);
      }

      if (!imageBuffer) {
        throw new Error('No image data in HD generation response');
      }

      const fileName = `hd_image_${Date.now()}.png`;
      const hdMetaLine = `\n_Model: ${imageResult.model || 'gpt-image-2'} (${imageResult.quality || 'high'}) · ${hdElapsedSec}s_`;

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
  async handleRemix(interaction) {
    const encodedPrompt = interaction.customId.slice('image_remix:'.length);
    let originalPrompt;
    try {
      originalPrompt = decodeURIComponent(encodedPrompt);
    } catch (error) {
      discordLogger.error({ error, encodedPrompt }, 'Failed to decode remix prompt');
      await interaction.reply({
        content: '❌ Remix failed — invalid prompt data.',
        ephemeral: true,
      });
      return;
    }

    const remixPrompt = `${originalPrompt}\n\nCreate a clearly distinct creative remix of this concept. Preserve the main subject and intent, but vary the composition, visual details, lighting, and artistic interpretation. Do not add text unless the original prompt asks for it.`;

    try {
      await interaction.deferUpdate();
      const pendingRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('image_remix_pending')
          .setLabel('🔀 Creating remix...')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
      await interaction.editReply({ components: [pendingRow] });

      const startedAt = Date.now();
      const imageResult = await generateImage(remixPrompt, {
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'low',
        enhance: false,
      });
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (!imageResult.success) {
        await interaction.editReply({
          content: `${interaction.message.content}\n\n⚠️ Remix failed: ${imageResult.error}`,
          components: [],
        });
        return;
      }

      const remixedImage = imageResult.images[0];
      const imageBuffer = remixedImage.b64_json
        ? Buffer.from(remixedImage.b64_json, 'base64')
        : remixedImage.url
          ? await downloadImage(remixedImage.url)
          : null;
      if (!imageBuffer) throw new Error('No image data in remix generation response');

      await interaction.editReply({
        content: `${interaction.message.content}\n🔀 Remix version below ↓`,
        components: [],
      });
      await interaction.followUp({
        content: `🔀 **Remix** — ${originalPrompt.substring(0, 100)}${originalPrompt.length > 100 ? '...' : ''}\n_Model: ${imageResult.model || 'gpt-image-2'} (${imageResult.quality || 'low'}) · ${elapsedSec}s_`,
        files: [{ attachment: imageBuffer, name: `remix_image_${Date.now()}.png` }],
      });
      discordLogger.info(
        { messageId: interaction.message.id, promptPreview: originalPrompt.substring(0, 60) },
        'Image remix completed successfully'
      );
    } catch (error) {
      discordLogger.error(
        { error, promptPreview: originalPrompt.substring(0, 60) },
        'Image remix error'
      );
      try {
        await interaction.editReply({
          content: `${interaction.message.content}\n\n❌ Remix failed. Please try again.`,
          components: [],
        });
      } catch (editError) {
        discordLogger.error({ editError }, 'Failed to update message after remix error');
      }
    }
  }
}

module.exports = InteractionEventHandler;
