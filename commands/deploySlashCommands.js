/**
 * Slash Command Deployment Script for ChimpGPT
 *
 * This script registers slash commands with the Discord API.
 * It can be run separately to update the commands, or called from the main bot.
 *
 * @module DeploySlashCommands
 * @author Brett
 * @version 1.0.0
 */

const { REST, Routes } = require('discord.js');
const { createLogger } = require('../logger');
const logger = createLogger('slashCommands');
const fs = require('fs');
const path = require('path');

// Import plugin manager
const pluginManager = require('../pluginManager');

/**
 * Deploy slash commands to Discord
 *
 * @param {Object} config - Bot configuration
 * @param {string} config.DISCORD_TOKEN - Discord bot token
 * @param {string} config.CLIENT_ID - Discord application client ID
 * @param {string[]} [guildIds=[]] - Array of guild IDs to deploy commands to (for testing)
 * @returns {Promise<Object>} Result of the deployment
 */
async function deploySlashCommands(config, guildIds = []) {
  try {
    if (!config.DISCORD_TOKEN) {
      throw new Error('Missing Discord token in configuration');
    }

    if (!config.CLIENT_ID) {
      throw new Error('Missing client ID in configuration');
    }

    // Initialize REST API client
    const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

    // Get command modules directory
    const commandsPath = path.join(__dirname, 'modules');

    // Check if directory exists
    if (!fs.existsSync(commandsPath)) {
      throw new Error(`Commands directory not found: ${commandsPath}`);
    }

    // Load command files
    const commandFiles = fs
      .readdirSync(commandsPath)
      .filter(file => file.endsWith('.js') && !file.startsWith('_'));

    // Array to store slash command data
    const slashCommands = [];

    // Map to track command names for conflict detection
    const commandNameMap = new Map();

    // Load each command module
    for (const file of commandFiles) {
      try {
        const filePath = path.join(commandsPath, file);
        // Clear cache to ensure we get the latest version
        delete require.cache[require.resolve(filePath)];

        const command = require(filePath);

        // Check for slash command data in either slashCommand or data property
        const slashCommandData = command.slashCommand || command.data;

        // Skip commands that don't have slash command data
        if (!slashCommandData) {
          logger.warn({ commandName: command.name }, 'Command missing slash command data');
          continue;
        }

        // Check for command name conflicts
        const commandJson = slashCommandData.toJSON();
        const commandName = commandJson.name;

        if (commandNameMap.has(commandName)) {
          const existingSource = commandNameMap.get(commandName);
          logger.warn(
            {
              commandName,
              file,
              existingSource,
            },
            `Slash command name conflict: '${commandName}' already registered by ${existingSource}`
          );
          continue; // Skip this command due to conflict
        }

        // No conflict, add to the list
        commandNameMap.set(commandName, `core command (${file})`);
        slashCommands.push(commandJson);
        logger.info({ commandName: command.name }, 'Loaded core slash command');
      } catch (error) {
        logger.error({ error, file }, 'Error loading command file');
      }
    }

    // Load slash commands from plugins
    try {
      const pluginCommands = pluginManager.getAllCommands();

      for (const [, command] of Object.entries(pluginCommands)) {
        // Skip commands that don't have slash command data
        if (!command.slashCommand) {
          continue;
        }

        // Check for command name conflicts
        const commandJson = command.slashCommand.toJSON();
        const commandName = commandJson.name;

        if (commandNameMap.has(commandName)) {
          const existingSource = commandNameMap.get(commandName);
          logger.warn(
            {
              commandName,
              pluginId: command.pluginId,
              existingSource,
            },
            `Slash command name conflict: '${commandName}' from plugin '${command.pluginId}' conflicts with ${existingSource}`
          );

          // Track the conflict in plugin metadata
          pluginManager.trackPluginConflict(
            command.pluginId,
            'slashCommand',
            commandName,
            existingSource
          );
          continue; // Skip this command due to conflict
        }

        // No conflict, add to the list
        commandNameMap.set(commandName, `plugin '${command.pluginId}'`);
        slashCommands.push(commandJson);
        logger.info(
          {
            commandName: command.name,
            pluginId: command.pluginId,
          },
          'Loaded plugin slash command'
        );
      }
    } catch (error) {
      logger.error({ error }, 'Error loading plugin slash commands');
    }

    // Load plugins before collecting plugin slash commands
    try {
      await pluginManager.loadPlugins();
      const pluginCommands = pluginManager.getAllCommands();

      for (const [, command] of Object.entries(pluginCommands)) {
        // Skip commands that don't have slash command data
        if (!command.slashCommand) {
          continue;
        }

        slashCommands.push(command.slashCommand.toJSON());
        logger.info(
          {
            commandName: command.name,
            pluginId: command.pluginId,
          },
          'Loaded plugin slash command'
        );
      }
    } catch (error) {
      logger.error({ error }, 'Error loading plugin slash commands');
    }
    // Deduplicate slash commands by name
    const seenNames = new Set();
    const dedupedSlashCommands = [];
    for (const cmd of slashCommands) {
      if (!seenNames.has(cmd.name)) {
        dedupedSlashCommands.push(cmd);
        seenNames.add(cmd.name);
      }
    }
    logger.info({ commandCount: dedupedSlashCommands.length }, 'Deploying slash commands');

    // Deploy commands
    const results = {};

    // If guild IDs are provided, deploy to specific guilds (faster for testing)
    if (guildIds && guildIds.length > 0) {
      for (const guildId of guildIds) {
        try {
          logger.info({ guildId }, 'Deploying guild commands');
          const data = await rest.put(Routes.applicationGuildCommands(config.CLIENT_ID, guildId), {
            body: dedupedSlashCommands,
          });
          results[guildId] = data;
          logger.info({ guildId, commandCount: data.length }, 'Guild commands deployed');
        } catch (error) {
          logger.error({ error, guildId }, 'Error deploying guild commands');
          results[guildId] = { error: error.message };
        }
      }
    } else {
      // Otherwise deploy globally (takes up to an hour to propagate)
      try {
        logger.info('Deploying global commands');
        const data = await rest.put(Routes.applicationCommands(config.CLIENT_ID), {
          body: dedupedSlashCommands,
        });
        results.global = data;
        logger.info({ commandCount: data.length }, 'Global commands deployed');
      } catch (error) {
        logger.error({ error }, 'Error deploying global commands');
        results.global = { error: error.message };
      }
    }

    return {
      success: true,
      deployedCommands: slashCommands.length,
      results,
    };
  } catch (error) {
    logger.error({ error }, 'Error in deploySlashCommands');
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = deploySlashCommands;
