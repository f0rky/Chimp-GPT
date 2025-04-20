/**
 * Image Generation Command for ChimpGPT
 * 
 * This command allows users to generate images using DALL-E directly from Discord.
 * It supports various options for customizing the generated images.
 * 
 * @module ImageCommand
 * @author Brett
 * @version 1.0.0
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageAttachment } = require('discord.js');
const { generateImage, enhanceImagePrompt, MODELS, SIZES, QUALITY } = require('../../imageGeneration');
const { createLogger } = require('../../logger');
const logger = createLogger('commands:image');
const axios = require('axios');

module.exports = {
  name: 'image',
  description: 'Generate an image using DALL-E AI',
  aliases: ['img', 'dalle'],
  dmAllowed: true,
  
  // Define slash command
  slashCommand: new SlashCommandBuilder()
    .setName('image')
    .setDescription('Generate an image using DALL-E AI')
    .addStringOption(option => 
      option.setName('prompt')
        .setDescription('What would you like to see in the image?')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('model')
        .setDescription('Which DALL-E model to use')
        .setRequired(false)
        .addChoices(
          { name: 'DALL-E 3 (Better quality, slower)', value: MODELS.DALLE_3 },
          { name: 'DALL-E 2 (Faster, less detailed)', value: MODELS.DALLE_2 }
        ))
    .addStringOption(option => 
      option.setName('size')
        .setDescription('Image size')
        .setRequired(false)
        .addChoices(
          { name: 'Square (1024x1024)', value: SIZES.LARGE },
          { name: 'Wide (1792x1024)', value: SIZES.WIDE },
          { name: 'Tall (1024x1792)', value: SIZES.TALL },
          { name: 'Medium (512x512, DALL-E 2 only)', value: SIZES.MEDIUM },
          { name: 'Small (256x256, DALL-E 2 only)', value: SIZES.SMALL }
        ))
    .addStringOption(option => 
      option.setName('quality')
        .setDescription('Image quality (HD only available for DALL-E 3)')
        .setRequired(false)
        .addChoices(
          { name: 'Standard', value: QUALITY.STANDARD },
          { name: 'HD', value: QUALITY.HD }
        ))
    .addBooleanOption(option => 
      option.setName('enhance')
        .setDescription('Enhance your prompt with AI for better results')
        .setRequired(false)),
  
  /**
   * Execute the image generation command (for message commands)
   * 
   * @param {Object} message - Discord message object
   * @param {Array<string>} args - Command arguments
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async execute(message, args, config) {
    // Not implemented for message commands yet
    return message.reply('Please use the slash command version of this command for now.');
  },

  /**
   * Execute the image generation command for slash commands
   * 
   * @param {Object} interaction - Discord interaction object
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async interactionExecute(interaction, config) {
    try {
      // Defer the reply to give us time to generate the image
      await interaction.deferReply();
      
      // Get command options
      const prompt = interaction.options.getString('prompt');
      const model = interaction.options.getString('model') || MODELS.DALLE_3;
      const size = interaction.options.getString('size') || SIZES.LARGE;
      const quality = interaction.options.getString('quality') || QUALITY.STANDARD;
      const enhance = interaction.options.getBoolean('enhance') || false;
      
      // Log the request
      logger.info({
        userId: interaction.user.id,
        prompt,
        model,
        size,
        quality,
        enhance
      }, 'Image generation requested');
      
      // Send initial response
      await interaction.editReply(`🎨 Generating image for: "${prompt}"${enhance ? ' (with enhanced prompt)' : ''}...`);
      
      // Enhance the prompt if requested
      let finalPrompt = prompt;
      if (enhance) {
        try {
          finalPrompt = await enhanceImagePrompt(prompt);
          logger.info({ originalPrompt: prompt, enhancedPrompt: finalPrompt }, 'Prompt enhanced');
        } catch (error) {
          logger.error({ error }, 'Failed to enhance prompt, using original');
        }
      }
      
      // Generate the image
      const result = await generateImage(finalPrompt, {
        model,
        size,
        quality
      });
      
      if (!result.success) {
        logger.error({ error: result.error }, 'Image generation failed');
        return interaction.editReply(`❌ Failed to generate image: ${result.error}`);
      }
      
      // Get the first image URL
      const imageUrl = result.images[0].url;
      const revisedPrompt = result.images[0].revisedPrompt || finalPrompt;
      
      // Download the image
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data, 'binary');
      
      // Create attachment
      const attachment = { attachment: buffer, name: 'dalle-image.png' };
      
      // Send the image with information about the prompt
      await interaction.editReply({
        content: `🖼️ Image generated by DALL-E ${model === MODELS.DALLE_3 ? '3' : '2'}\n📝 ${enhance ? 'Enhanced prompt' : 'Prompt'}: "${revisedPrompt}"`,
        files: [attachment]
      });
      
      logger.info({
        userId: interaction.user.id,
        success: true
      }, 'Image generated and sent successfully');
    } catch (error) {
      logger.error({ error }, 'Error executing image command');
      
      // Handle errors gracefully
      if (interaction.deferred) {
        await interaction.editReply('❌ An error occurred while generating the image. Please try again later.');
      } else {
        await interaction.reply({
          content: '❌ An error occurred while generating the image. Please try again later.',
          ephemeral: true
        });
      }
    }
  }
};
