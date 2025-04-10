require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const logger = createLogger('deployToGuild');

// Get configuration
const config = require('./configValidator');

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
    
    console.log(`Deploying commands to guild: ${guildId}`);
    
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
        console.log(`Loaded slash command: ${command.name}`);
      } catch (error) {
        console.error(`Error loading command file ${file}:`, error);
      }
    }
    
    console.log(`Deploying ${slashCommands.length} slash commands to guild ${guildId}`);
    
    // Deploy commands to the specific guild
    const data = await rest.put(
      Routes.applicationGuildCommands(config.CLIENT_ID, guildId),
      { body: slashCommands }
    );
    
    console.log(`Successfully deployed ${data.length} commands to guild ${guildId}`);
    
    // Print out the deployed commands
    console.log('\nDeployed commands:');
    data.forEach(cmd => {
      console.log(`- ${cmd.name}: ${cmd.description}`);
    });
    
    return {
      success: true,
      deployedCommands: data.length,
      commands: data
    };
  } catch (error) {
    console.error('Error deploying commands:', error);
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
      console.log('Command deployment completed successfully!');
    } else {
      console.error('Command deployment failed:', result.error);
    }
  })
  .catch(error => {
    console.error('Unexpected error:', error);
  });
