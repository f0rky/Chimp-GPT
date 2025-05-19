const { createLogger } = require('../../logger');
const logger = createLogger('commands:clear');
const { userConversations, clearConversation } = require('../../conversationManager');

/**
 * Clear command - Clears the conversation history for the current channel
 * @param {import('discord.js').Message} message - The Discord message object
 * @param {string[]} args - Command arguments (unused)
 * @param {Object} config - Bot configuration
 * @returns {Promise<void>}
 */
module.exports = {
  name: 'clear',
  description: 'Clear the conversation history for this channel',
  aliases: ['reset'],
  usage: '!clear',
  dmAllowed: true,
  adminOnly: false,
  ownerOnly: false,
  async execute(message, args, config) {
    const userId = message.author.id;
    const channelId = message.channelId;
    const username = message.author.username;
    
    logger.info('Clear command executed', { 
      userId, 
      username, 
      channelId,
      botReady: message.client.isReady()
    });
    
    try {
      // Log detailed state before clearing
      const stateBefore = {
        hasUser: userConversations.has(userId),
        userConversationsSize: userConversations.size,
        userConversationsKeys: Array.from(userConversations.keys()),
        userId,
        userIdType: typeof userId
      };
      
      logger.debug('State before clear:', stateBefore);
      
      // Clear the conversation
      const wasCleared = clearConversation(userId);
      
      // Log state after clearing
      const stateAfter = {
        hasUser: userConversations.has(userId),
        userConversationsSize: userConversations.size,
        wasCleared
      };
      
      logger.debug('State after clear:', stateAfter);
      
      if (wasCleared) {
        logger.info('Successfully cleared conversation', { userId, username });
        await message.reply('✅ Conversation history has been cleared.');
      } else {
        logger.info('No conversation found to clear', { userId, username });
        await message.reply('ℹ️ No conversation history found to clear.');
      }
    } catch (error) {
      logger.error(
        { 
          error: error.message, 
          stack: error.stack,
          userId, 
          username,
          channelId,
          userConversationsSize: conversationManager.userConversations.size,
          userConversationsKeys: Array.from(conversationManager.userConversations.keys())
        },
        'Failed to clear conversation'
      );
      await message.reply('❌ Failed to clear conversation history. Please try again.');
    }
  },
};
