const { createLogger } = require('../../logger');
const logger = createLogger('commands:clear');
const { 
  userConversations, 
  clearConversation, 
  getConversationStorageStatus,
  loadConversationsFromStorage
} = require('../../conversationManager');
const fs = require('fs').promises;
const path = require('path');
const { formatBytes, formatNumber } = require('../../utils/formatters');

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
      botReady: message.client.isReady(),
    });

    try {
      try {
        // Get conversation storage status
        const storageStatus = getConversationStorageStatus();
        
        // Get in-memory conversation status
        const inMemoryStatus = {
          hasConversation: userConversations.has(userId),
          totalConversations: userConversations.size,
          userId,
          userIdType: typeof userId,
        };

        // Try to clear the conversation
        const wasCleared = clearConversation(userId);

        // Get storage file info if it exists
        let fileStats = null;
        try {
          const filePath = path.join(__dirname, '../../data/conversations.json');
          const stats = await fs.stat(filePath);
          fileStats = {
            exists: true,
            size: formatBytes(stats.size),
            modified: stats.mtime.toISOString(),
            path: filePath
          };
          
          // Try to read the file to check if the user's conversation exists
          const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
          fileStats.userInFile = userId in (data.conversations || {});
          fileStats.totalUsers = data.conversations ? Object.keys(data.conversations).length : 0;
        } catch (fileError) {
          fileStats = {
            exists: false,
            error: fileError.message
          };
        }

        // Create a detailed status message
        const statusMessage = [
          '### Conversation Status',
          '**In-Memory:**',
          `- Has conversation: ${inMemoryStatus.hasConversation ? '✅' : '❌'}`,
          `- Total active conversations: ${inMemoryStatus.totalConversations}`,
          `- User ID type: ${inMemoryStatus.userIdType}`,
          '',
          '**Storage File:**',
          `- Exists: ${fileStats.exists ? '✅' : '❌'}${fileStats.error ? ` (${fileStats.error})` : ''}`,
          fileStats.exists ? `- Size: ${fileStats.size}` : '',
          fileStats.exists ? `- Modified: ${new Date(fileStats.modified).toLocaleString()}` : '',
          fileStats.exists ? `- User in file: ${fileStats.userInFile ? '✅' : '❌'}` : '',
          fileStats.exists ? `- Total users in file: ${fileStats.totalUsers}` : '',
          '',
          `**Action:** ${wasCleared ? '✅ Cleared conversation' : 'ℹ️ No conversation found to clear'}`,
          '',
          'Use `!clear --force` to force reload conversations from disk.'
        ].filter(Boolean).join('\n');

        logger.info('Clear command executed', {
          userId,
          username,
          wasCleared,
          inMemoryStatus,
          fileStats,
          storageStatus
        });

        await message.reply(statusMessage);
        
        // If user used --force flag, reload conversations from disk
        if (args.includes('--force')) {
          try {
            await loadConversationsFromStorage();
            await message.reply('🔄 Successfully reloaded conversations from disk.');
          } catch (reloadError) {
            logger.error({ error: reloadError }, 'Failed to reload conversations');
            await message.reply('❌ Failed to reload conversations from disk.');
          }
        }
      } catch (error) {
        logger.error(
          {
            error: error.message,
            stack: error.stack,
            userId,
            username,
            channelId,
            userConversationsSize: userConversations.size,
            userConversationsKeys: Array.from(userConversations.keys()),
          },
          'Failed to clear conversation'
        );
        await message.reply('❌ Failed to clear conversation history. Please try again.');
      }
    } catch (error) {
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          userId,
          username,
          channelId,
          userConversationsSize: userConversations.size,
          userConversationsKeys: Array.from(userConversations.keys()),
        },
        'Failed to clear conversation'
      );
      await message.reply('❌ Failed to clear conversation history. Please try again.');
    }
  },
};
