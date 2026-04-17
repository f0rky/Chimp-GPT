/**
 * Discord message format conversion utility
 *
 * Normalises a discord.js Message into a plain object suitable for
 * PocketFlow / parallel-testing consumption.  Eliminates the duplicated
 * conversion logic that previously lived in pocketFlowAdapter.js and
 * parallelTestingAdapter.js.
 *
 * @module utils/discordMessage
 */

/**
 * Convert a discord.js Message to a plain-object representation.
 *
 * @param {import('discord.js').Message} message - Discord message object
 * @returns {Object} Plain message suitable for PocketFlow / parallel testing
 */
function toPocketFlowMessage(message) {
  return {
    id: message.id,
    content: message.content,
    createdTimestamp: message.createdTimestamp,
    author: {
      id: message.author.id,
      username: message.author.username,
      displayName: message.author.displayName || message.author.username,
    },
    channel: {
      id: message.channel.id,
      type: message.channel.isDMBased() ? 'DM' : 'GUILD_TEXT',
    },
    guild: message.guild ? { id: message.guild.id } : null,
    reference: message.reference,
  };
}

module.exports = { toPocketFlowMessage };
