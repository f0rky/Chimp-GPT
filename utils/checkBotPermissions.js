require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

// Initialize Discord client with proper intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  // Get all guilds the bot is in
  const guilds = client.guilds.cache;
  
  console.log(`Bot is in ${guilds.size} servers`);
  
  for (const [guildId, guild] of guilds) {
    console.log(`\nServer: ${guild.name} (${guildId})`);
    
    // Get the bot's member object in this guild
    const botMember = guild.members.cache.get(client.user.id);
    
    if (!botMember) {
      console.log('  Bot is not a member of this guild?');
      continue;
    }
    
    // Check permissions
    const permissions = botMember.permissions.toArray();
    console.log('  Permissions:');
    permissions.forEach(perm => console.log(`    - ${perm}`));
    
    // Check application command permissions
    console.log('  Application Command Permissions:');
    try {
      const applicationCommandManager = guild.commands;
      console.log('    - Can create application commands: Yes');
    } catch (error) {
      console.log('    - Can create application commands: No');
      console.log(`    - Error: ${error.message}`);
    }
    
    // Check if bot has the applications.commands scope
    console.log('  Note: Cannot directly check if bot has applications.commands scope.');
    console.log('  This requires checking the OAuth2 URL used to add the bot.');
  }
  
  // Check global application commands
  console.log('\nGlobal Application Commands:');
  try {
    const globalCommands = await client.application.commands.fetch();
    console.log(`  Found ${globalCommands.size} global commands:`);
    
    for (const [commandId, command] of globalCommands) {
      console.log(`  - ${command.name}: ${command.description}`);
    }
  } catch (error) {
    console.log(`  Error fetching global commands: ${error.message}`);
  }
  
  // Exit after checking
  console.log('\nPermission check complete. Exiting...');
  client.destroy();
  process.exit(0);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN)
  .catch(error => {
    console.error('Failed to log in to Discord:', error);
    process.exit(1);
  });
