const { createLogger } = require('../../core/logger');
const { SlashCommandBuilder } = require('discord.js');
const logger = createLogger('commands:clear');
const ACTIVE_FLOW = Symbol.for('chimp-gpt.activeConversationFlow');

function getScope(source) {
  return {
    userId: source.author?.id || source.user?.id,
    channelId: source.channel?.id || source.channelId,
    guildId: source.guildId || source.guild?.id || null,
  };
}

async function clearFor(source, respond) {
  const scope = getScope(source);
  const flow = source.client?.[ACTIVE_FLOW];
  if (!flow || typeof flow.clearConversation !== 'function') {
    await respond('❌ No active conversation flow is available; history was not cleared.');
    return;
  }
  if (!scope.userId) {
    await respond('❌ Could not identify your account; history was not cleared.');
    return;
  }
  try {
    const cleared = await flow.clearConversation(scope);
    await respond(
      cleared
        ? '✅ Your conversation history was cleared.'
        : 'ℹ️ No conversation history was found to clear.'
    );
  } catch (error) {
    logger.error({ error, ...scope }, 'Failed to clear active conversation');
    await respond('❌ Failed to clear conversation history. Please try again.');
  }
}

module.exports = {
  name: 'clear',
  description: 'Clear your conversation history in this channel',
  aliases: ['reset'],
  usage: '!clear',
  dmAllowed: true,
  adminOnly: false,
  ownerOnly: false,
  slashCommand: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear your conversation history in this channel'),
  async execute(message) {
    await clearFor(message, content => message.reply(content));
  },
  async interactionExecute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await clearFor(interaction, content => interaction.editReply({ content }));
  },
};
