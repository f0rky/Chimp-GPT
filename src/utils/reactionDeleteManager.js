/**
 * Reaction Delete Manager
 *
 * Allows the bot owner to delete any bot message by reacting with 🗑️ (wastebasket).
 * This is a global handler — survives restarts, works on all bot messages.
 *
 * Behaviour:
 *  - Owner reacts with 🗑️ on a bot message → message is deleted
 *  - Only acts on bot messages (ignores reactions on other users' messages)
 *  - Only the owner can trigger deletion
 *
 * @module ReactionDeleteManager
 */

const { createLogger } = require('../core/logger');
const logger = createLogger('reactionDelete');

const WASTEBASKET_EMOJI = '🗑️';

/**
 * Initialise the global wastebasket reaction handler.
 *
 * @param {import('discord.js').Client} client
 * @param {Object} config - Bot config (must have OWNER_ID)
 */
function initReactionDelete(client, config) {
  const ownerId = config.OWNER_ID?.replace(/"/g, '');

  client.on('messageReactionAdd', async (reaction, user) => {
    try {
      // Only the owner
      if (user.id !== ownerId) return;

      // Only the wastebasket emoji
      if (reaction.emoji.name !== WASTEBASKET_EMOJI) return;

      // Fetch partial reaction/message if needed (post-restart cache miss)
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (err) {
          logger.warn({ err }, 'Failed to fetch partial reaction');
          return;
        }
      }

      const message = reaction.message;

      // Fetch partial message if needed
      if (message.partial) {
        try {
          await message.fetch();
        } catch (err) {
          logger.warn({ err }, 'Failed to fetch partial message');
          return;
        }
      }

      // Only delete bot messages
      if (message.author?.id !== client.user.id) return;

      await message.delete();
      logger.info(
        { messageId: message.id, channelId: message.channelId, userId: user.id },
        'Bot message deleted via wastebasket reaction'
      );
    } catch (err) {
      // Ignore "Unknown Message" (already deleted) errors
      if (err.code === 10008) return;
      logger.error({ err }, 'Error handling wastebasket reaction delete');
    }
  });

  logger.info('Wastebasket reaction delete handler initialised');
}

module.exports = { initReactionDelete, WASTEBASKET_EMOJI };
