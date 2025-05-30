/**
 * Unblock User Command
 * 
 * Unblocks a user from the malicious user detection system
 * 
 * @module UnblockUserCommand
 */

const { createLogger } = require('../../logger');
const maliciousUserManager = require('../../utils/maliciousUserManager');

const logger = createLogger('commands:unblockuser');

/**
 * Unblock a user
 * @param {Object} message - Discord message object
 * @param {Array} args - Command arguments
 */
async function execute(message, args) {
  try {
    if (!message.member?.permissions.has('Administrator')) {
      await message.reply('❌ This command requires administrator permissions.');
      return;
    }
    
    if (args.length === 0) {
      await message.reply('❌ Please provide a user ID or mention a user.');
      return;
    }
    
    // Extract user ID from mention or direct ID
    let userId = args[0];
    const mentionMatch = userId.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
      userId = mentionMatch[1];
    }
    
    const wasBlocked = await maliciousUserManager.unblockUser(userId);
    
    if (!wasBlocked) {
      await message.reply('⚠️ User was not blocked.');
      return;
    }
    
    const embed = {
      title: '✅ User Unblocked',
      fields: [
        { name: 'User ID', value: userId, inline: true },
        { name: 'Unblocked By', value: message.author.tag, inline: true }
      ],
      color: 0x00ff00,
      timestamp: new Date()
    };
    
    await message.reply({ embeds: [embed] });
    logger.info({ userId, unblockedBy: message.author.id }, 'User manually unblocked');
    
  } catch (error) {
    logger.error({ error }, 'Error in unblockuser command');
    await message.reply('❌ An error occurred while unblocking the user.');
  }
}

module.exports = {
  name: 'unblockuser',
  aliases: ['unblock'],
  description: 'Unblock a previously blocked user',
  adminOnly: true,
  dmAllowed: false,
  execute
};