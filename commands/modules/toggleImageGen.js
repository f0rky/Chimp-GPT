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

// Path to the .env file - use absolute path from project root
const envPath = path.resolve(process.cwd(), '.env');

// Get the image generation module
const imageGenerationModule = require('../../imageGeneration');

// Log the resolved path for debugging
logger.debug({ envPath }, 'Resolved .env path');

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
    } else {
      logger.warn(`Env file not found at ${envPath}`);
      // Create a basic env config if it doesn't exist
      envConfig = { ENABLE_IMAGE_GENERATION: process.env.ENABLE_IMAGE_GENERATION || 'false' };
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
    
    // Update in-memory config in all relevant places
    process.env.ENABLE_IMAGE_GENERATION = newState.toString();
    config.ENABLE_IMAGE_GENERATION = newState; // Update the live config object
    
    // Force reload the config in the imageGeneration module
    try {
      // Get the path to the config module
      const configPath = require.resolve('../../configValidator');
      
      // Clear the require cache for the config module
      delete require.cache[configPath];
      
      // Re-require the config module
      const freshConfig = require('../../configValidator');
      
      // Verify the config was updated
      logger.info(`Config reloaded. Image generation is now ${freshConfig.ENABLE_IMAGE_GENERATION ? 'enabled' : 'disabled'}`);
    } catch (configError) {
      logger.error({ error: configError }, 'Error reloading config module');
    }
    
    // Log the change
    logger.info(`Image generation toggled to ${newState ? 'enabled' : 'disabled'} in config`);
    logger.debug({ 
      envPath, 
      newState, 
      configValue: config.ENABLE_IMAGE_GENERATION,
      envValue: process.env.ENABLE_IMAGE_GENERATION 
    }, 'Updated image generation configuration');
    
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
      logger.info({ userId: message.author.id, username: message.author.tag }, 'Executing toggleimage command');
      
      // Log current state before toggling
      logger.debug({ 
        currentEnvValue: process.env.ENABLE_IMAGE_GENERATION,
        currentConfigValue: config.ENABLE_IMAGE_GENERATION 
      }, 'Current image generation state before toggle');
      
      const { newState, success } = await toggleImageGeneration();
      
      if (success) {
        // Log the new state after toggling
        logger.debug({ 
          newState,
          newEnvValue: process.env.ENABLE_IMAGE_GENERATION,
          newConfigValue: config.ENABLE_IMAGE_GENERATION 
        }, 'New image generation state after toggle');
        
        await message.reply({
          content: `✅ Image generation has been ${newState ? 'enabled' : 'disabled'}. The change will take effect immediately.`,
          allowedMentions: { repliedUser: false }
        });
        logger.info(`Image generation ${newState ? 'enabled' : 'disabled'} via prefix command by ${message.author.tag}`);
      } else {
        throw new Error('Failed to update configuration');
      }
    } catch (error) {
      logger.error({ error, envPath }, 'Error in toggleimage prefix command');
      await message.reply({
        content: `❌ An error occurred while toggling image generation: ${error.message}`,
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
