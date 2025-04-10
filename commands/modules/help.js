/**
 * Help Command Module
 * 
 * This command provides information about available commands,
 * including their descriptions, aliases, and usage restrictions.
 * 
 * @module HelpCommand
 * @author Brett
 * @version 1.0.0
 */

const { getCommands, getCommand, prefixes } = require('../commandHandler');
const { createLogger } = require('../../logger');
const logger = createLogger('commands:help');
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'help',
  aliases: ['commands', 'info'],
  description: 'Display information about available commands',
  dmAllowed: true, // This command can be used in DMs
  
  // Define slash command
  slashCommand: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Display information about available commands')
    .addStringOption(option =>
      option.setName('command')
        .setDescription('Get help for a specific command')
        .setRequired(false)),
  
  /**
   * Execute the help command (text command version)
   * 
   * @param {import('discord.js').Message} message - Discord message object
   * @param {string[]} args - Command arguments
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async execute(message, args, config) {
    logger.info({ 
      userId: message.author.id, 
      username: message.author.username
    }, 'Help command used');
    
    try {
      // Get all commands from the command handler
      const allCommands = getCommands();
      
      // Check if we're looking for help on a specific command
      if (args.length > 0) {
        const commandName = args[0].toLowerCase();
        const command = getCommand(commandName);
        
        if (command) {
          // Format specific command help
          const commandHelp = this.formatCommandHelp(command, config);
          await message.reply(commandHelp);
        } else {
          await message.reply(`Command \`${commandName}\` not found. Use \`${prefixes[0]}help\` to see all available commands.`);
        }
        return;
      }
      
      // Format general help message
      const helpMessage = this.formatHelpMessage(allCommands, config);
      await message.reply(helpMessage);
    } catch (error) {
      logger.error({ error }, 'Error executing help command');
      await message.reply('An error occurred while retrieving help information.');
    }
  },
  
  /**
   * Execute the help command (slash command version)
   * 
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction object
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async showCommandHelp(message, commandName, isOwner, isAdmin) {
    const command = getCommand(commandName);
    
    if (!command) {
      await message.reply(`Command \`${commandName}\` not found. Use \`${prefixes[0]}help\` to see all available commands.`);
      return;
    }
    
    // Check if user has permission to see this command
    if ((command.ownerOnly && !isOwner) || (command.adminOnly && !isAdmin && !isOwner)) {
      await message.reply(`You don't have permission to view information about the \`${commandName}\` command.`);
      return;
    }
    
    const helpEmbed = {
      title: `Command: ${prefixes[0]}${command.name}`,
      color: 0x3498db,
      description: command.description || 'No description available',
      fields: []
    };
    
    // Add aliases if any
    if (command.aliases && command.aliases.length > 0) {
      helpEmbed.fields.push({
        name: 'Aliases',
        value: command.aliases.map(alias => `\`${prefixes[0]}${alias}\``).join(', ')
      });
    }
    
    // Add usage restrictions
    const restrictions = [];
    if (command.ownerOnly) restrictions.push('Bot Owner Only');
    if (command.adminOnly) restrictions.push('Server Admins Only');
    if (!command.dmAllowed) restrictions.push('Cannot be used in DMs');
    
    if (restrictions.length > 0) {
      helpEmbed.fields.push({
        name: 'Restrictions',
        value: restrictions.join(', ')
      });
    }
    
    // Add usage examples if available
    if (command.examples && command.examples.length > 0) {
      helpEmbed.fields.push({
        name: 'Examples',
        value: command.examples.map(example => `\`${prefixes[0]}${command.name} ${example}\``).join('\n')
      });
    }
    
    await message.reply({ embeds: [helpEmbed] });
  },
  
  /**
   * Show general help with a list of available commands
   * 
   * @param {import('discord.js').Message} message - Discord message object
   * @param {boolean} isOwner - Whether the user is the bot owner
   * @param {boolean} isAdmin - Whether the user is a server admin
   * @returns {Promise<void>}
   */
  async showGeneralHelp(message, isOwner, isAdmin) {
    const commands = getCommands(true); // Get unique commands only
    
    // Filter commands based on user permissions
    const availableCommands = commands.filter(cmd => {
      if (cmd.ownerOnly && !isOwner) return false;
      if (cmd.adminOnly && !isAdmin && !isOwner) return false;
      if (message.channel.isDMBased() && !cmd.dmAllowed) return false;
      return true;
    });
    
    // Group commands by category if available
    const categories = {};
    
    for (const cmd of availableCommands) {
      const category = cmd.category || 'General';
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(cmd);
    }
    
    const helpEmbed = {
      title: 'ChimpGPT Help',
      color: 0x3498db,
      description: `Here are the commands you can use. Type \`${prefixes[0]}help <command>\` for detailed information about a specific command.`,
      fields: []
    };
    
    // Add each category and its commands
    for (const [category, cmds] of Object.entries(categories)) {
      helpEmbed.fields.push({
        name: category,
        value: cmds.map(cmd => `\`${prefixes[0]}${cmd.name}\` - ${cmd.description || 'No description'}`).join('\n')
      });
    }
    
    // Add note about prefixes
    helpEmbed.fields.push({
      name: 'Command Prefixes',
      value: `You can use any of these prefixes: ${prefixes.map(p => `\`${p}\``).join(', ')}`
    });
    
    await message.reply({ embeds: [helpEmbed] });
  },
  
  /**
   * Execute the help command (slash command version)
   * 
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction object
   * @param {Object} config - Bot configuration
   * @returns {Promise<void>}
   */
  async interactionExecute(interaction, config) {
    logger.info({ 
      userId: interaction.user.id, 
      username: interaction.user.username
    }, 'Help command used via slash command');
    
    try {
      // Check if the user is the bot owner or admin
      const isOwner = interaction.user.id === config.OWNER_ID;
      const isAdmin = interaction.member?.permissions?.has('ADMINISTRATOR') || false;
      
      // Get the command argument if provided
      const commandName = interaction.options.getString('command');
      
      if (commandName) {
        // Show help for specific command
        const command = getCommand(commandName.toLowerCase());
        
        if (command) {
          // Check if user has permission to see this command
          if ((command.ownerOnly && !isOwner) || (command.adminOnly && !isAdmin && !isOwner)) {
            await interaction.reply({ content: `You don't have permission to view information about the \`${commandName}\` command.`, ephemeral: true });
            return;
          }
          
          const helpEmbed = {
            title: `Command: /${command.name}`,
            color: 0x3498db,
            description: command.description || 'No description available',
            fields: []
          };
          
          // Add usage restrictions
          const restrictions = [];
          if (command.ownerOnly) restrictions.push('Bot Owner Only');
          if (command.adminOnly) restrictions.push('Server Admins Only');
          if (!command.dmAllowed) restrictions.push('Cannot be used in DMs');
          
          if (restrictions.length > 0) {
            helpEmbed.fields.push({
              name: 'Restrictions',
              value: restrictions.join(', ')
            });
          }
          
          await interaction.reply({ embeds: [helpEmbed], ephemeral: false });
        } else {
          await interaction.reply({ content: `Command \`${commandName}\` not found. Use \`/help\` to see all available commands.`, ephemeral: true });
        }
      } else {
        // Show general help
        const commands = getCommands(true); // Get unique commands only
        
        // Filter commands based on user permissions
        const availableCommands = commands.filter(cmd => {
          if (cmd.ownerOnly && !isOwner) return false;
          if (cmd.adminOnly && !isAdmin && !isOwner) return false;
          if (!interaction.guild && !cmd.dmAllowed) return false;
          return true;
        });
        
        // Group commands by category if available
        const categories = {};
        
        for (const cmd of availableCommands) {
          const category = cmd.category || 'General';
          if (!categories[category]) {
            categories[category] = [];
          }
          categories[category].push(cmd);
        }
        
        const helpEmbed = {
          title: 'ChimpGPT Help',
          color: 0x3498db,
          description: 'Here are the commands you can use:',
          fields: []
        };
        
        // Add each category and its commands
        for (const [category, cmds] of Object.entries(categories)) {
          helpEmbed.fields.push({
            name: category,
            value: cmds.map(cmd => `\`/${cmd.name}\` - ${cmd.description || 'No description'}`).join('\n')
          });
        }
        
        await interaction.reply({ embeds: [helpEmbed], ephemeral: false });
      }
    } catch (error) {
      logger.error({ error }, 'Error executing help slash command');
      await interaction.reply({ content: 'An error occurred while retrieving help information.', ephemeral: true });
    }
  }
};
