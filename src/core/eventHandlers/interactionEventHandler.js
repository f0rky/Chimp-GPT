const { discord: discordLogger } = require('../logger');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const commandHandler = require('../../commands/commandHandler');
const { generateImage } = require('../../services/imageGeneration');
const { downloadImage } = require('../../utils/imageDownloader');
const maliciousUserManager = require('../../utils/maliciousUserManager');
const performanceMonitor = require('../../middleware/performanceMonitor');
const {
  checkUserRateLimit,
  checkImageGenerationRateLimit,
} = require('../../middleware/rateLimiter');

// Every image action button costs a billable provider request, so they are owner-only.
const IMAGE_ACTION_PREFIXES = ['image_upscale:', 'image_remix:', 'hd_upgrade:'];
const OWNER_ID_PATTERN = /^\d+$/;

/**
 * Source-message claims shared by image_upscale, image_remix and legacy hd_upgrade.
 * messageId -> { state: 'in_flight' | 'consumed', dispatched: boolean }
 *
 * A claim is taken synchronously before the first await, so concurrent clicks on the
 * same message (same or different action) cannot both reach the provider. Once a
 * provider request has been dispatched the claim is NEVER released - not on success,
 * error, timeout, or refusal - because the request may already have been billed. This
 * is a deliberate fail-closed billing guard. Claims are only released when the action
 * fails locally before dispatch (malformed/empty prompt, failed defer, etc.).
 *
 * Memory is bounded by pruning the oldest consumed claims; in-flight claims are never
 * pruned. Claims live in process memory only and do not survive a restart.
 */
const imageActionClaims = new Map();
const MAX_CONSUMED_IMAGE_ACTION_CLAIMS = 5000;

function resolveOwnerId(config) {
  const raw = config?.OWNER_ID || process.env.OWNER_ID;
  const ownerId = typeof raw === 'string' ? raw.replaceAll('"', '').trim() : '';
  return OWNER_ID_PATTERN.test(ownerId) ? ownerId : null;
}

function claimImageActionMessage(messageId) {
  if (imageActionClaims.has(messageId)) return null;
  const claim = { state: 'in_flight', dispatched: false };
  imageActionClaims.set(messageId, claim);
  return claim;
}

function settleImageActionClaim(messageId, claim) {
  if (!claim.dispatched) {
    imageActionClaims.delete(messageId);
    return;
  }
  claim.state = 'consumed';
  let excess = imageActionClaims.size - MAX_CONSUMED_IMAGE_ACTION_CLAIMS;
  for (const [id, entry] of imageActionClaims) {
    if (excess <= 0) break;
    if (entry.state === 'consumed' && id !== messageId) {
      imageActionClaims.delete(id);
      excess -= 1;
    }
  }
}

async function replyEphemeral(interaction, content) {
  try {
    await interaction.reply({ content, ephemeral: true });
  } catch (error) {
    discordLogger.error({ error }, 'Failed to send ephemeral image action response');
  }
}

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
    let timerId;
    try {
      const imageButton =
        interaction.isButton() &&
        ['image_upscale:', 'image_remix:', 'hd_upgrade:'].some(prefix =>
          interaction.customId.startsWith(prefix)
        );
      if (!imageButton && !interaction.isChatInputCommand()) return;

      const denial = await this.getInteractionDenial(interaction, imageButton);
      if (denial) {
        await interaction.reply({ content: denial, ephemeral: true });
        return;
      }

      timerId = performanceMonitor.startTimer(
        imageButton || interaction.commandName === 'image' ? 'image_interaction' : 'slash_command',
        { command: imageButton ? 'image_button' : interaction.commandName }
      );

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
    } finally {
      if (timerId) performanceMonitor.stopTimer(timerId);
    }
  }

  async getInteractionDenial(interaction, imageButton) {
    if (maliciousUserManager.isUserBlocked(interaction.user.id)) {
      return 'You are not permitted to use this bot.';
    }
    if (
      !interaction.channel?.isDMBased() &&
      !this.config.CHANNEL_ID?.includes(interaction.channelId)
    ) {
      return 'This bot is not enabled in this channel.';
    }
    const limit = await checkUserRateLimit(interaction.user.id, 1, {
      points: 30,
      duration: 30,
    });
    if (limit.limited) return limit.message;
    if (imageButton || interaction.commandName === 'image') {
      const imageLimit = await checkImageGenerationRateLimit(interaction.user.id);
      if (imageLimit.limited) return imageLimit.message;
    }
    return null;
  }

  async handleButtonInteraction(interaction) {
    const { customId } = interaction;
    const prefix = IMAGE_ACTION_PREFIXES.find(p => customId.startsWith(p));

    if (!prefix) {
      // Unknown button — ignore
      discordLogger.debug({ customId }, 'Unhandled button interaction');
      return;
    }

    // Authorization, source validation and the claim all run synchronously before any
    // await, so neither unauthorized nor concurrent clicks can reach the provider.
    const ownerId = resolveOwnerId(this.config);
    if (!ownerId || interaction.user?.id !== ownerId) {
      discordLogger.warn(
        { userId: interaction.user?.id, customPrefix: prefix, ownerConfigured: !!ownerId },
        'Denied unauthorized image action'
      );
      await replyEphemeral(interaction, '🔒 Only the bot owner can use image actions.');
      return;
    }

    const messageId = interaction.message?.id;
    if (!messageId || typeof interaction.message.content !== 'string') {
      discordLogger.warn({ customPrefix: prefix }, 'Image action missing source message');
      await replyEphemeral(interaction, '❌ This image action is no longer available.');
      return;
    }

    const claim = claimImageActionMessage(messageId);
    if (!claim) {
      await replyEphemeral(
        interaction,
        '⏳ An image action for this message is already processing or has already been used.'
      );
      return;
    }

    try {
      if (prefix === 'image_remix:') {
        await this.handleRemix(interaction, claim);
      } else {
        // hd_upgrade: is kept for image messages created before the action buttons.
        await this.handleHdUpgrade(interaction, prefix, claim);
      }
    } finally {
      settleImageActionClaim(messageId, claim);
    }
  }

  /**
   * Shared by upscale and remix: rejects malformed or empty prompts before any
   * defer, so the caller's claim is released and the source controls stay intact.
   */
  async decodeActionPrompt(interaction, prefix, failureMessage) {
    const encodedPrompt = interaction.customId.slice(prefix.length);
    let prompt;
    try {
      prompt = decodeURIComponent(encodedPrompt);
    } catch (decodeError) {
      discordLogger.error(
        { encodedPrompt, error: decodeError.message },
        'Failed to decode image action prompt'
      );
    }
    if (!prompt?.trim()) {
      await replyEphemeral(interaction, failureMessage);
      return null;
    }
    return prompt;
  }

  async handleHdUpgrade(interaction, prefix, claim) {
    // Extract the original prompt from the custom ID.
    const originalPrompt = await this.decodeActionPrompt(
      interaction,
      prefix,
      '❌ HD upgrade failed — invalid prompt data.'
    );
    if (originalPrompt === null) return;

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

      // Generate HD image with gpt-image-2, 1024×1024, medium quality.
      // quality:'high' measured 182s end to end here, in line with its ~195s
      // median - too long to sit behind a button. Medium runs closer to 80s and
      // is still a clear step up from the conversational fast path.
      const hdGenStart = Date.now();
      claim.dispatched = true; // From here the request may be billed; never release.
      const imageResult = await generateImage(originalPrompt, {
        provider: 'openai',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'medium',
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
      const hdMetaLine = `\n_Model: ${imageResult.model || 'gpt-image-2'} (${imageResult.quality || 'medium'}) · ${hdElapsedSec}s_`;

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
          content: `${interaction.message.content}\n\n❌ HD upgrade failed.`,
          components: [],
        });
      } catch (editError) {
        discordLogger.error({ editError }, 'Failed to update message after HD upgrade error');
      }
    }
  }
  async handleRemix(interaction, claim) {
    const originalPrompt = await this.decodeActionPrompt(
      interaction,
      'image_remix:',
      '❌ Remix failed — invalid prompt data.'
    );
    if (originalPrompt === null) return;

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
      claim.dispatched = true; // From here the request may be billed; never release.
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
          content: `${interaction.message.content}\n\n❌ Remix failed.`,
          components: [],
        });
      } catch (editError) {
        discordLogger.error({ editError }, 'Failed to update message after remix error');
      }
    }
  }
}

module.exports = InteractionEventHandler;
