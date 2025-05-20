/**
 * Toggle Image Generation Command
 * 
 * This command allows administrators to enable or disable the image generation feature.
 * 
 * @module ToggleImageGenCommand
 * @author Brett
 * @version 1.0.0
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createLogger } = require('../../../logger');
const logger = createLogger('cmd-toggle-img');

// Get config
const config = require('../../configValidator');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Path to the .env file
const envPath = path.join(__dirname, '../../.env');

/**
 * Toggle the image generation setting
 * @returns {Promise<{newState: boolean, success: boolean}>} The new state and success status
 */
async function toggleImageGeneration() {
  try {
    // Read current state from .env
    let envConfig = {};
    if (fs.existsSync(envPath)) {
      const envFile = fs.readFileSync(envPath, 'utf8');
      envConfig = dotenv.parse(envFile);
    }
    
    // Toggle the state
    const currentState = envConfig.ENABLE_IMAGE_GENERATION === 'true';
    const newState = !currentState;
    
    // Update the .env file
    envConfig.ENABLE_IMAGE_GENERATION = newState.toString();
    
    const envContent = Object.entries(envConfig)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    
    fs.writeFileSync(envPath, envContent);
    
    // Update in-memory config
    process.env.ENABLE_IMAGE_GENERATION = newState.toString();
    config.ENABLE_IMAGE_GENERATION = newState; // Update the live config object
    
    return { newState, success: true };
  } catch (error) {
    logger.error({ error }, 'Error toggling image generation');
    return { newState: false, success: false };
  }
}

/**
 * Command data for the /toggleimage command
 * @type {import('discord.js').SlashCommandBuilder}
 */
const data = new SlashCommandBuilder()
  .setName('toggleimage')
  .setDescription('Toggle image generation feature on/off')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

/**
 * Execute the /toggleimage command
 * 
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction that triggered the command
 * @returns {Promise<void>}
 */
async function execute(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });
    
    const { newState, success } = await toggleImageGeneration();
    
    if (success) {
      await interaction.editReply({
        content: `✅ Image generation has been ${newState ? 'enabled' : 'disabled'}.`
      });
      logger.info(`Image generation ${newState ? 'enabled' : 'disabled'} by ${interaction.user.tag}`);
    } else {
      throw new Error('Failed to update configuration');
    }
  } catch (error) {
    logger.error({ error }, 'Error in toggleimage command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while toggling image generation.',
        ephemeral: true
      });
    } else {
      await interaction.editReply({
        content: '❌ An error occurred while toggling image generation.'
      });
    }
  }
}

// Create the command definition
const command = {
  name: 'toggleimage',
  description: 'Toggle the image generation feature on/off (Admin only)',
  usage: '!toggleimage',
  category: 'admin',
  permissions: ['Administrator'],
  dmAllowed: false,
  adminOnly: true,
  execute: async (message) => {
    try {
      const { newState, success } = await toggleImageGeneration();
      
      if (success) {
        await message.reply({
          content: `✅ Image generation has been ${newState ? 'enabled' : 'disabled'}.`,
          allowedMentions: { repliedUser: false }
        });
        logger.info(`Image generation ${newState ? 'enabled' : 'disabled'} via prefix command by ${message.author.tag}`);
      } else {
        throw new Error('Failed to update configuration');
      }
    } catch (error) {
      logger.error({ error }, 'Error in toggleimage prefix command');
      await message.reply({
        content: '❌ An error occurred while toggling image generation.',
        allowedMentions: { repliedUser: false }
      });
    }
  },
  // Add slash command data
  slashCommand: data,
  interactionExecute: execute
};

// Register the command with the command handler
const { registerCommand } = require('../../commandHandler');
if (!registerCommand(command)) {
  logger.warn('Failed to register toggleimage command - it may already be registered');
}

// Export the command for module loading
module.exports = command;
