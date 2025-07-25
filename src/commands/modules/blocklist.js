/**
 * Blocklist Command
 *
 * Shows all blocked users in the malicious user detection system
 *
 * @module BlocklistCommand
 */

const { createLogger } = require('../../core/logger');
const maliciousUserManager = require('../../../utils/maliciousUserManager');

const logger = createLogger('commands:blocklist');

/**
 * List all blocked users
 * @param {Object} message - Discord message object
 * @param {Array} args - Command arguments
 */
async function execute(message, _args) {
  try {
    if (!message.member?.permissions.has('Administrator')) {
      await message.reply('❌ This command requires administrator permissions.');
      return;
    }

    const blockedUsers = maliciousUserManager.getBlockedUsers();

    if (blockedUsers.length === 0) {
      await message.reply('✅ No users are currently blocked.');
      return;
    }

    const userList = blockedUsers
      .slice(0, 20) // Limit to 20 users to avoid embed limits
      .map((userId, index) => `${index + 1}. <@${userId}> (${userId})`)
      .join('\n');

    const embed = {
      title: '🚫 Blocked Users',
      description: userList,
      color: 0xff0000,
      footer: {
        text:
          blockedUsers.length > 20
            ? `Showing first 20 of ${blockedUsers.length} blocked users`
            : `${blockedUsers.length} blocked user${blockedUsers.length === 1 ? '' : 's'}`,
      },
      timestamp: new Date(),
    };

    await message.reply({ embeds: [embed] });
  } catch (error) {
    logger.error({ error }, 'Error in blocklist command');
    await message.reply('❌ An error occurred while listing blocked users.');
  }
}

module.exports = {
  name: 'blocklist',
  aliases: ['blocked', 'listblocked'],
  description: 'List all blocked users',
  adminOnly: true,
  dmAllowed: false,
  execute,
};
