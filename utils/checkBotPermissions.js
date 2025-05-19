require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

// Import logger
const { createLogger } = require('../logger');
const logger = createLogger('permissions');

// Initialize Discord client with proper intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.on('ready', async () => {
  logger.info(`Logged in as ${client.user.tag}`);

  // Get all guilds the bot is in
  const guilds = client.guilds.cache;

  logger.info(`Bot is in ${guilds.size} servers`);

  for (const [guildId, guild] of guilds) {
    logger.info(`Server: ${guild.name} (${guildId})`);

    // Get the bot's member object in this guild
    const botMember = guild.members.cache.get(client.user.id);

    if (!botMember) {
      logger.warn('Bot is not a member of this guild?');
      continue;
    }

    // Check permissions
    const permissions = botMember.permissions.toArray();
    logger.info('Permissions:');
    permissions.forEach(perm => logger.info(`- ${perm}`));

    // Check application command permissions
    logger.info('Application Command Permissions:');
    try {
      logger.info('- Can create application commands: Yes');
    } catch (error) {
      logger.warn('- Can create application commands: No');
      logger.error({ error }, 'Error with application commands');
    }

    // Check if bot has the applications.commands scope
    logger.info('Note: Cannot directly check if bot has applications.commands scope.');
    logger.info('This requires checking the OAuth2 URL used to add the bot.');
  }

  // Check global application commands
  logger.info('Global Application Commands:');
  try {
    const globalCommands = await client.application.commands.fetch();
    logger.info(`Found ${globalCommands.size} global commands:`);

    globalCommands.forEach(command => {
      logger.info(`- ${command.name}: ${command.description}`);
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching global commands');
  }

  // Exit after checking
  logger.info('Permission check complete. Exiting...');
  client.destroy();
  process.exit(0);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN).catch(error => {
  const { discord: discordLogger } = require('../logger');
  discordLogger.error({ error }, 'Failed to log in to Discord');
  process.exit(1);
});
