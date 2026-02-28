/**
 * /cleanupdm — Delete bot's own messages from the owner's DM channel.
 * Owner-only slash command.
 *
 * @module cleanupDm
 */

const { SlashCommandBuilder } = require('discord.js');
const { createLogger } = require('../../core/logger');
const logger = createLogger('commands:cleanupdm');

async function cleanupOwnerDMs(client) {
  const dmChannel = await client.users.cache
    .get(client.application?.owner?.id)
    ?.createDM()
    .catch(() => null);

  if (!dmChannel) return 0;

  let deleted = 0;
  let lastId;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const messages = await dmChannel.messages.fetch(options);
    if (!messages.size) break;

    const botMessages = messages.filter(m => m.author.id === client.user.id);
    for (const msg of botMessages.values()) {
      try {
        await msg.delete();
        deleted++;
      } catch (e) {
        logger.warn({ msgId: msg.id, error: e.message }, 'Could not delete DM message');
      }
    }

    lastId = messages.last()?.id;
    if (messages.size < 100) break;
  }

  return deleted;
}

module.exports = {
  name: 'cleanupdm',
  description: "Delete the bot's own messages from your DM with it (owner only)",
  aliases: [],
  dmAllowed: true,
  ownerOnly: true,

  slashCommand: new SlashCommandBuilder()
    .setName('cleanupdm')
    .setDescription("Clean up the bot's own messages from your DM channel"),

  async execute(message, _args, _config) {
    try {
      const ownerId = message.author.id;
      const dmChannel = await message.author.createDM();
      let deleted = 0;
      let lastId;

      while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;
        const messages = await dmChannel.messages.fetch(options);
        if (!messages.size) break;
        const botMessages = messages.filter(m => m.author.id === message.client.user.id);
        for (const msg of botMessages.values()) {
          try {
            await msg.delete();
            deleted++;
          } catch (e) {
            /* skip */
          }
        }
        lastId = messages.last()?.id;
        if (messages.size < 100) break;
      }

      logger.info({ deleted }, 'cleanupdm completed');
      await message.reply(
        `🧹 Cleaned up **${deleted}** message${deleted !== 1 ? 's' : ''} from our DMs.`
      );
    } catch (error) {
      logger.error({ error: error.message }, 'cleanupdm failed');
      await message.reply('❌ Failed to clean up DMs.');
    }
  },

  async executeSlash(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const dmChannel = await interaction.user.createDM();
      let deleted = 0;
      let lastId;

      while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;
        const messages = await dmChannel.messages.fetch(options);
        if (!messages.size) break;
        const botMessages = messages.filter(m => m.author.id === interaction.client.user.id);
        for (const msg of botMessages.values()) {
          try {
            await msg.delete();
            deleted++;
          } catch (e) {
            /* skip */
          }
        }
        lastId = messages.last()?.id;
        if (messages.size < 100) break;
      }

      logger.info({ deleted }, '/cleanupdm completed');
      await interaction.editReply(
        `🧹 Cleaned up **${deleted}** message${deleted !== 1 ? 's' : ''} from our DMs.`
      );
    } catch (error) {
      logger.error({ error: error.message }, '/cleanupdm failed');
      await interaction.editReply('❌ Failed to clean up DMs. Check bot permissions.');
    }
  },
};
