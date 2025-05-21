/**
 * Command Handler System for ChimpGPT
 *
 * This module provides a structured way to register, discover, and execute
 * commands. It supports multiple command prefixes, slash commands, and provides
 * a unified interface for command execution.
 *
 * @module CommandHandler
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../logger');
const logger = createLogger('commands');
const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');

// Import slash command deployment function
const deploySlashCommands = require('./deploySlashCommands');

// Import plugin manager
const pluginManager = require('../pluginManager');

/**
 * Command registry to store all registered commands
 * @type {Map<string, Object>}
 */
const commands = new Map();

/**
 * Slash command registry to store all registered slash commands
 * @type {Collection<string, Object>}
 */
const slashCommands = new Collection();

/**
 * Command prefixes that the bot will recognize
 * @type {string[]}
 */
const prefixes = ['!', '.', '/']; // Default command prefixes

/**
 * Register a command with the command handler
 *
 * @param {Object} command - Command object
 * @param {string} command.name - Primary command name
 * @param {string[]} [command.aliases=[]] - Alternative names for the command
 * @param {string} command.description - Description of what the command does
 * @param {Function} command.execute - Function to execute when command is called
 * @param {boolean} [command.ownerOnly=false] - Whether the command is restricted to the bot owner
 * @param {boolean} [command.adminOnly=false] - Whether the command is restricted to server admins
 * @param {boolean} [command.dmAllowed=false] - Whether the command can be used in DMs
 * @param {import('discord.js').SlashCommandBuilder} [command.slashCommand] - Slash command data if this command supports slash commands
 * @returns {boolean} Whether the command was registered successfully
 */
function registerCommand(command) {
  try {
    if (!command.name) {
      logger.error({ command }, 'Command missing name property');
      return false;
    }

    if (!command.execute || typeof command.execute !== 'function') {
      logger.error({ commandName: command.name }, 'Command missing execute function');
      return false;
    }

    // Register the command under its primary name
    commands.set(command.name.toLowerCase(), command);

    // Register any aliases
    if (command.aliases && Array.isArray(command.aliases)) {
      for (const alias of command.aliases) {
        commands.set(alias.toLowerCase(), command);
      }
    }

    // Register slash command if available (check both slashCommand and data properties)
    if (command.slashCommand || command.data) {
      slashCommands.set(command.name, command);
    }

    logger.info(
      {
        commandName: command.name,
        aliases: command.aliases || [],
        ownerOnly: command.ownerOnly || false,
        adminOnly: command.adminOnly || false,
        dmAllowed: command.dmAllowed || false,
        hasSlashCommand: !!command.slashCommand,
      },
      'Command registered'
    );

    return true;
  } catch (error) {
    logger.error({ error, commandName: command?.name }, 'Error registering command');
    return false;
  }
}

/**
 * Load all command modules from the commands directory and plugins
 *
 * @param {string} [commandsPath=path.join(__dirname, 'modules')] - Path to commands directory
 * @returns {Promise<number>} Number of commands loaded
 */
async function loadCommands(commandsPath = path.join(__dirname, 'modules')) {
  try {
    let loadedCount = 0;

    // 1. Load commands from the commands directory
    if (fs.existsSync(commandsPath)) {
      const commandFiles = fs
        .readdirSync(commandsPath)
        .filter(file => file.endsWith('.js') && !file.startsWith('_'));

      for (const file of commandFiles) {
        try {
          const filePath = path.join(commandsPath, file);
          // Clear cache to ensure we get the latest version
          delete require.cache[require.resolve(filePath)];

          const command = require(filePath);

          if (registerCommand(command)) {
            loadedCount++;
          }
        } catch (error) {
          logger.error({ error, file }, 'Error loading command file');
        }
      }

      logger.info({ loadedCount, totalFiles: commandFiles.length }, 'Core commands loaded');
    } else {
      logger.warn({ commandsPath }, 'Commands directory does not exist');
    }

    // 2. Load commands from plugins
    try {
      const pluginCommands = pluginManager.getAllCommands();
      const pluginCommandCount = Object.keys(pluginCommands).length;

      if (pluginCommandCount > 0) {
        // Register each plugin command
        for (const [, command] of Object.entries(pluginCommands)) {
          if (registerCommand(command)) {
            loadedCount++;
          }
        }

        logger.info({ pluginCommandCount }, 'Plugin commands loaded');
      }
    } catch (error) {
      logger.error({ error }, 'Error loading plugin commands');
    }

    logger.info({ totalLoadedCount: loadedCount }, 'All commands loaded');
    return loadedCount;
  } catch (error) {
    logger.error({ error, commandsPath }, 'Error loading commands');
    return 0;
  }
}

/**
 * Set the command prefixes that the bot will recognize
 *
 * @param {string[]} newPrefixes - Array of prefix strings
 */
function setPrefixes(newPrefixes) {
  if (Array.isArray(newPrefixes) && newPrefixes.length > 0) {
    prefixes.length = 0; // Clear the array
    prefixes.push(...newPrefixes);
    logger.info({ prefixes }, 'Command prefixes updated');
  } else {
    logger.warn({ newPrefixes }, 'Invalid prefixes provided, keeping existing prefixes');
  }
}

/**
 * Parse a message to extract command and arguments
 *
 * @param {string} content - Message content to parse
 * @returns {Object|null} Parsed command object or null if not a command
 * @returns {string} .prefix - The prefix used
 * @returns {string} .commandName - The name of the command
 * @returns {string[]} .args - Array of command arguments
 */
function parseCommand(content) {
  if (!content || typeof content !== 'string') return null;

  const trimmedContent = content.trim();

  // Check if the message starts with any of our prefixes
  const prefix = prefixes.find(p => trimmedContent.startsWith(p));
  if (!prefix) return null;

  // Remove the prefix and split into command and arguments
  const withoutPrefix = trimmedContent.slice(prefix.length).trim();
  const args = withoutPrefix.split(/\s+/);
  const commandName = args.shift().toLowerCase();

  if (!commandName) return null;

  return {
    prefix,
    commandName,
    args,
  };
}

/**
 * Handle a slash command interaction
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction object
 * @param {Object} config - Bot configuration
 * @returns {Promise<void>}
 */
async function handleSlashCommand(interaction, config) {
  try {
    const commandName = interaction.commandName;
    const command = slashCommands.get(commandName);

    if (!command) {
      logger.warn({ commandName }, 'Unknown slash command');
      await interaction.reply({ content: 'Unknown command', ephemeral: true });
      return;
    }

    // Check if the command is owner-only
    if (command.ownerOnly && interaction.user.id !== config.OWNER_ID) {
      logger.info(
        {
          commandName,
          userId: interaction.user.id,
          username: interaction.user.username,
        },
        'Owner-only slash command used by non-owner'
      );

      await interaction.reply({
        content: 'This command is restricted to the bot owner.',
        ephemeral: true,
      });
      return;
    }

    // Check if the command is admin-only
    if (command.adminOnly && !interaction.memberPermissions?.has('ADMINISTRATOR')) {
      logger.info(
        {
          commandName,
          userId: interaction.user.id,
          username: interaction.user.username,
        },
        'Admin-only slash command used by non-admin'
      );

      await interaction.reply({
        content: 'This command is restricted to server administrators.',
        ephemeral: true,
      });
      return;
    }

    // Check if the command is allowed in DMs
    if (interaction.channel.isDMBased() && !command.dmAllowed) {
      logger.info(
        {
          commandName,
          userId: interaction.user.id,
          username: interaction.user.username,
        },
        'Slash command not allowed in DMs'
      );

      await interaction.reply({ content: 'This command cannot be used in DMs.', ephemeral: true });
      return;
    }

    // Execute the command
    logger.info(
      {
        commandName,
        userId: interaction.user.id,
        username: interaction.user.username,
        channelId: interaction.channelId,
      },
      'Executing slash command'
    );

    // Check which method is available and use it
    if (typeof command.interactionExecute === 'function') {
      await command.interactionExecute(interaction, config);
    } else if (typeof command.executeSlash === 'function') {
      await command.executeSlash(interaction, config);
    } else {
      throw new Error(
        `Command ${commandName} does not have an interactionExecute or executeSlash method`
      );
    }
  } catch (error) {
    // Enhanced granular error logging for plugin/core slash commands
    const isPluginCommand = !!command.pluginId;
    logger.error(
      {
        error: error.message,
        stack: error.stack,
        commandName: interaction.commandName,
        userId: interaction.user.id,
        username: interaction.user.username,
        channelId: interaction.channelId,
        pluginId: isPluginCommand ? command.pluginId : undefined,
        pluginVersion: isPluginCommand ? command.pluginVersion || 'unknown' : undefined,
        source: isPluginCommand ? 'plugin' : 'core',
        args: interaction.options?.data || [],
      },
      'Error handling slash command'
    );

    // Reply with error if we haven't replied yet
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'An error occurred while executing that command.',
        ephemeral: true,
      });
    } else if (!interaction.replied) {
      await interaction.editReply({ content: 'An error occurred while executing that command.' });
    }
  }
}

/**
 * Check if a message is a command and execute it if it is
 *
 * @param {import('discord.js').Message} message - Discord message object
 * @param {Object} config - Bot configuration
 * @returns {Promise<boolean>} Whether a command was executed
 */
async function handleCommand(message, config) {
  // Define command variable outside try block so it's accessible in catch
  let command;
  let commandName;
  let args;

  try {
    // Debug: Log all registered commands
    logger.debug({ registeredCommands: Array.from(commands.keys()) }, 'Registered commands');
    
    // Parse the command from the message
    const parsedCommand = parseCommand(message.content);
    if (!parsedCommand) return false;

    logger.debug({ parsedCommand }, 'Parsed command');
    
    commandName = parsedCommand.commandName;
    args = parsedCommand.args;

    // Check if the command exists
    command = commands.get(commandName);
    if (!command) return false;

    // Check if the command is allowed in DMs
    if (message.channel.isDMBased() && !command.dmAllowed) {
      logger.info(
        {
          commandName,
          userId: message.author.id,
          username: message.author.username,
        },
        'Command not allowed in DMs'
      );

      await message.reply('This command cannot be used in DMs.');
      return true; // We handled it by rejecting it
    }

    // Check if the command is owner-only
    if (command.ownerOnly && message.author.id !== config.OWNER_ID) {
      logger.info(
        {
          commandName,
          userId: message.author.id,
          username: message.author.username,
        },
        'Owner-only command used by non-owner'
      );

      await message.reply('This command is restricted to the bot owner.');
      return true; // We handled it by rejecting it
    }

    // Check if the command is admin-only
    if (command.adminOnly && !message.member?.permissions.has('ADMINISTRATOR')) {
      logger.info(
        {
          commandName,
          userId: message.author.id,
          username: message.author.username,
        },
        'Admin-only command used by non-admin'
      );

      await message.reply('This command is restricted to server administrators.');
      return true; // We handled it by rejecting it
    }

    // Execute the command
    logger.info(
      {
        commandName,
        args,
        userId: message.author.id,
        username: message.author.username,
        channelId: message.channelId,
      },
      'Executing command'
    );

    await command.execute(message, args, config);
    return true;
  } catch (error) {
    // Enhanced granular error logging for plugin/core commands
    // Check if command exists before accessing its properties
    const isPluginCommand = command && !!command.pluginId;
    logger.error(
      {
        error,
        commandName,
        args,
        userId: message.author.id,
        username: message.author.username,
        channelId: message.channelId,
        pluginId: isPluginCommand ? command.pluginId : undefined,
        pluginVersion: isPluginCommand ? command.pluginVersion || 'unknown' : undefined,
        source: isPluginCommand ? 'plugin' : 'core',
        content: message.content,
      },
      'Error handling command'
    );
    await message.reply('An error occurred while executing that command.');
    return true; // We attempted to handle it
  }
}

/**
 * Get a list of all registered commands
 *
 * @param {boolean} [uniqueOnly=true] - Whether to only include unique commands (no aliases)
 * @returns {Object[]} Array of command objects
 */
function getCommands(uniqueOnly = true) {
  if (uniqueOnly) {
    // Create a Set of unique command objects
    const uniqueCommands = new Set();
    for (const command of commands.values()) {
      uniqueCommands.add(command);
    }
    return Array.from(uniqueCommands);
  }

  return Array.from(commands.values());
}

/**
 * Get information about a specific command
 *
 * @param {string} commandName - Name of the command to get
 * @returns {Object|null} Command object or null if not found
 */
function getCommand(commandName) {
  return commands.get(commandName.toLowerCase()) || null;
}

/**
 * Deploy slash commands to Discord
 *
 * @param {Object} config - Bot configuration
 * @param {string[]} [guildIds=[]] - Array of guild IDs to deploy commands to (for testing)
 * @returns {Promise<Object>} Result of the deployment
 */
async function deployCommands(config, guildIds = []) {
  return await deploySlashCommands(config, guildIds);
}

module.exports = {
  registerCommand,
  loadCommands,
  setPrefixes,
  parseCommand,
  handleCommand,
  handleSlashCommand,
  getCommands,
  getCommand,
  deployCommands,
  prefixes,
  slashCommands,
};
