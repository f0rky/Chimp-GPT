/**
 * Image Generation Command for ChimpGPT
 *
 * This command allows users to generate images using GPT Image-1 directly from Discord.
 * It supports various options for customizing the generated images.
 *
 * @module ImageCommand
 * @author Brett
 * @version 1.0.0
 */

const { SlashCommandBuilder } = require('@discordjs/builders');

// Import the module as a whole instead of destructuring to avoid circular dependency issues
const imageGeneration = require('../../imageGeneration');
const MODELS = imageGeneration.MODELS;
const SIZES = imageGeneration.SIZES;
const QUALITY = imageGeneration.QUALITY;
const FORMAT = imageGeneration.FORMAT;
const BACKGROUND = imageGeneration.BACKGROUND;
const { createLogger } = require('../../logger');
const logger = createLogger('commands:image');
const axios = require('axios');
const retryWithBreaker = require('../../utils/retryWithBreaker');
const breakerManager = require('../../breakerManager');

// Circuit breaker configuration for image downloads
const IMAGE_DOWNLOAD_BREAKER_CONFIG = {
  maxRetries: 2,
  breakerLimit: 5, // Open breaker after 5 consecutive failures
  breakerTimeoutMs: 120000, // 2 minutes timeout
  onBreakerOpen: error => {
    logger.error({ error }, 'Image download circuit breaker opened');
    breakerManager.notifyOwnerBreakerTriggered(
      'Image download circuit breaker opened: ' + error.message
    );
  },
};

module.exports = {
  name: 'image',
  description: 'Generate an image using GPT Image-1 AI',
  aliases: ['img', 'gptimage'],
  dmAllowed: true,

  // Define slash command
  slashCommand: new SlashCommandBuilder()
    .setName('image')
    .setDescription('Generate an image using GPT Image-1 AI')
    .addStringOption(option =>
      option
        .setName('prompt')
        .setDescription('What would you like to see in the image?')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('model')
        .setDescription('Which GPT Image-1 model to use')
        .setRequired(false)
        .addChoices({ name: 'GPT Image-1 (Latest model)', value: MODELS.GPT_IMAGE_1 })
    )
    .addStringOption(option =>
      option
        .setName('size')
        .setDescription('Image size')
        .setRequired(false)
        .addChoices(
          { name: 'Square (1024x1024) - Default', value: SIZES.SQUARE },
          { name: 'Landscape (1792x1024)', value: SIZES.LANDSCAPE },
          { name: 'Portrait (1024x1792)', value: SIZES.PORTRAIT }
        )
    )
    .addStringOption(option =>
      option
        .setName('quality')
        .setDescription('Image quality')
        .setRequired(false)
        .addChoices(
          { name: 'Auto (Default)', value: QUALITY.AUTO },
          { name: 'Low', value: QUALITY.LOW },
          { name: 'Medium', value: QUALITY.MEDIUM },
          { name: 'High', value: QUALITY.HIGH }
        )
    )
    .addStringOption(option =>
      option
        .setName('format')
        .setDescription('Image format')
        .setRequired(false)
        .addChoices(
          { name: 'PNG (Default)', value: FORMAT.PNG },
          { name: 'JPEG', value: FORMAT.JPEG },
          { name: 'WebP', value: FORMAT.WEBP }
        )
    )
    .addStringOption(option =>
      option
        .setName('background')
        .setDescription('Background type (transparent only works with PNG and WebP)')
        .setRequired(false)
        .addChoices(
          { name: 'Opaque (Default)', value: BACKGROUND.DEFAULT },
          { name: 'Transparent', value: BACKGROUND.TRANSPARENT },
          { name: 'Auto', value: BACKGROUND.AUTO }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('compression')
        .setDescription('Compression level (0-100) for JPEG and WebP formats')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(100)
    )
    .addBooleanOption(option =>
      option
        .setName('enhance')
        .setDescription('Enhance your prompt with AI for better results')
        .setRequired(false)
    ),

  /**
   * Execute the image generation command (for message commands)
   *
   * @param {Object} message - Discord message object
   * @returns {Promise<void>}
   */
  async execute(message) {
    // Not implemented for message commands yet
    return message.reply('Please use the slash command version of this command for now.');
  },

  /**
   * Execute the image generation command for slash commands
   *
   * @param {Object} interaction - Discord interaction object
   * @returns {Promise<void>}
   */
  async interactionExecute(interaction) {
    try {
      // Defer the reply to give us time to generate the image
      await interaction.deferReply();

      // Get command options
      const prompt = interaction.options.getString('prompt');
      const model = interaction.options.getString('model') || MODELS.GPT_IMAGE_1;

      // Get size from options or use default
      const size = interaction.options.getString('size') || SIZES.SQUARE;

      // Get quality from options or use default
      const quality = interaction.options.getString('quality') || QUALITY.AUTO;

      // Get format from options or use default
      const format = interaction.options.getString('format') || FORMAT.PNG;

      // Get background from options or use default
      const background = interaction.options.getString('background') || BACKGROUND.DEFAULT;

      // Get compression from options (if specified)
      const compression = interaction.options.getInteger('compression');

      // Get enhance option
      const enhance = interaction.options.getBoolean('enhance') || false;

      // Log the request
      logger.info(
        {
          userId: interaction.user.id,
          prompt,
          model,
          size,
          quality,
          format,
          background,
          compression: compression || 'default',
          enhance,
        },
        'Image generation requested'
      );

      // Send initial response with more details about the configuration
      await interaction.editReply(
        `🎨 Generating ${size} image with ${quality} quality for: "${prompt}"${enhance ? ' (with enhanced prompt)' : ''}...`
      );

      // Enhance the prompt if requested
      let finalPrompt = prompt;
      if (enhance) {
        try {
          finalPrompt = await imageGeneration.enhanceImagePrompt(prompt);
          logger.info({ originalPrompt: prompt, enhancedPrompt: finalPrompt }, 'Prompt enhanced');
        } catch (error) {
          logger.error({ error }, 'Failed to enhance prompt, using original');
        }
      }

      // Generate the image with all parameters
      const result = await imageGeneration.generateImage(finalPrompt, {
        model,
        size,
        quality,
        format,
        background,
        compression,
        enhance,
      });

      if (!result.success) {
        logger.error({ error: result.error }, 'Image generation failed');
        return interaction.editReply(`❌ Failed to generate image: ${result.error}`);
      }

      // Format cost information for display
      const costInfo = result.estimatedCost
        ? `(Estimated cost: $${result.estimatedCost.toFixed(3)})`
        : '';

      // Get the first image URL
      const imageUrl = result.images[0].url;
      const revisedPrompt = result.images[0].revisedPrompt || finalPrompt;

      // Download the image using retryWithBreaker for better reliability
      logger.debug('Using retryWithBreaker for image download');
      const response = await retryWithBreaker(async () => {
        logger.debug(`Downloading image from ${imageUrl}`);
        return await axios.get(imageUrl, { responseType: 'arraybuffer' });
      }, IMAGE_DOWNLOAD_BREAKER_CONFIG);
      const buffer = Buffer.from(response.data, 'binary');

      // Create attachment
      const attachment = { attachment: buffer, name: 'gpt-image.png' };

      // Send the image with information about the prompt and cost
      const modelName = 'GPT Image-1';

      await interaction.editReply({
        content: `🖼️ Image generated by ${modelName} (${size}) ${costInfo}
📝 ${enhance ? 'Enhanced prompt' : 'Prompt'}: "${revisedPrompt}"`,
        files: [attachment],
      });

      logger.info(
        {
          userId: interaction.user.id,
          success: true,
        },
        'Image generated and sent successfully'
      );
    } catch (error) {
      logger.error({ error }, 'Error executing image command');

      // Handle errors gracefully
      if (interaction.deferred) {
        await interaction.editReply(
          '❌ An error occurred while generating the image. Please try again later.'
        );
      } else {
        await interaction.reply({
          content: '❌ An error occurred while generating the image. Please try again later.',
          ephemeral: true,
        });
      }
    }
  },
};
