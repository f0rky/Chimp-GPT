require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Get configuration
const config = require('./configValidator');

// Import logger
const { createLogger } = require('../logger');
const logger = createLogger('deploy');

// Get the guild ID from the command line or use a default
const guildId = process.argv[2] || '98265937441984512'; // F.E.S server ID

async function deployCommands() {
  try {
    if (!config.DISCORD_TOKEN) {
      throw new Error('Missing Discord token in configuration');
    }
    
    if (!config.CLIENT_ID) {
      throw new Error('Missing client ID in configuration');
    }
    
    logger.info(`Deploying commands to guild: ${guildId}`);
    
    // Initialize REST API client
    const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
    
    // Get command modules directory
    const commandsPath = path.join(__dirname, 'commands', 'modules');
    
    // Check if directory exists
    if (!fs.existsSync(commandsPath)) {
      throw new Error(`Commands directory not found: ${commandsPath}`);
    }
    
    // Load command files
    const commandFiles = fs.readdirSync(commandsPath)
      .filter(file => file.endsWith('.js') && !file.startsWith('_'));
    
    // Array to store slash command data
    const slashCommands = [];
    
    // Load each command module
    for (const file of commandFiles) {
      try {
        const filePath = path.join(commandsPath, file);
        // Clear cache to ensure we get the latest version
        delete require.cache[require.resolve(filePath)];
        
        const command = require(filePath);
        
        // Skip commands that don't have slash command data
        if (!command.slashCommand) {
          continue;
        }
        
        slashCommands.push(command.slashCommand.toJSON());
        logger.debug(`Loaded slash command: ${command.name}`);
      } catch (error) {
        const { discord: discordLogger } = require('../logger');
        discordLogger.error({ error, file }, 'Error loading command file');
      }
    }
    
    logger.info(`Deploying ${slashCommands.length} slash commands to guild ${guildId}`);
    
    // Deploy commands to the specific guild
    const data = await rest.put(
      Routes.applicationGuildCommands(config.CLIENT_ID, guildId),
      { body: slashCommands }
    );
    
    logger.info(`Successfully deployed ${data.length} commands to guild ${guildId}`);
    
    // Print out the deployed commands
    logger.info('Deployed commands:');
    for (const cmd of data) {
      logger.info(`- ${cmd.name}: ${cmd.description}`);
    }
    
    return {
      success: true,
      deployedCommands: data.length,
      commands: data
    };
  } catch (error) {
    const { discord: discordLogger } = require('../logger');
    discordLogger.error({ error }, 'Error deploying commands');
    return {
      success: false,
      error: error.message
    };
  }
}

// Execute the deployment
deployCommands()
  .then(result => {
    if (result.success) {
      logger.info('Command deployment completed successfully!');
    } else {
      const { discord: discordLogger } = require('../logger');
      discordLogger.error({ error: result.error }, 'Command deployment failed');
    }
  })
  .catch(error => {
    const { discord: discordLogger } = require('../logger');
    discordLogger.error({ error }, 'Unexpected error during deployment');
  });
