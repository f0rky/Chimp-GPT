/**
 * Malicious User Management Commands
 *
 * Admin commands to manage users who exhibit malicious behavior
 *
 * @module MaliciousUsersCommand
 */

const { createLogger } = require('../../logger');
const maliciousUserManager = require('../../utils/maliciousUserManager');

const logger = createLogger('maliciousUsersCommand');

/**
 * Check user deletion statistics
 * @param {Object} message - Discord message object
 * @param {Array} args - Command arguments
 */
async function checkUserStats(message, args) {
  try {
    if (!message.member?.permissions.has('ADMINISTRATOR')) {
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

    const stats = maliciousUserManager.getUserStats(userId);

    const embed = {
      title: '📊 User Deletion Statistics',
      fields: [
        { name: 'User ID', value: userId, inline: true },
        { name: 'Status', value: stats.isBlocked ? '🚫 Blocked' : '✅ Active', inline: true },
        { name: 'Total Deletions', value: stats.totalDeletions.toString(), inline: true },
        { name: 'Rapid Deletions', value: stats.rapidDeletions.toString(), inline: true },
        { name: 'Last Hour', value: stats.deletionsLastHour.toString(), inline: true },
        { name: 'Last Day', value: stats.deletionsLastDay.toString(), inline: true },
      ],
      color: stats.isBlocked ? 0xff0000 : stats.rapidDeletions > 5 ? 0xff9900 : 0x00ff00,
      timestamp: new Date(),
    };

    if (stats.recentDeletions.length > 0) {
      const recent = stats.recentDeletions
        .map(
          d =>
            `${new Date(d.timestamp).toLocaleString()}: "${d.content.substring(0, 50)}${d.content.length > 50 ? '...' : ''}"`
        )
        .join('\n');
      embed.fields.push({
        name: 'Recent Deletions',
        value: recent.substring(0, 1024),
        inline: false,
      });
    }

    await message.reply({ embeds: [embed] });
  } catch (error) {
    logger.error({ error }, 'Error in checkUserStats command');
    await message.reply('❌ An error occurred while checking user stats.');
  }
}

/**
 * Block a user
 * @param {Object} message - Discord message object
 * @param {Array} args - Command arguments
 */
async function blockUser(message, args) {
  try {
    if (!message.member?.permissions.has('ADMINISTRATOR')) {
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

    const reason = args.slice(1).join(' ') || 'Manual block by administrator';

    if (maliciousUserManager.isUserBlocked(userId)) {
      await message.reply('⚠️ User is already blocked.');
      return;
    }

    await maliciousUserManager.blockUser(userId, reason);

    const embed = {
      title: '🚫 User Blocked',
      fields: [
        { name: 'User ID', value: userId, inline: true },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Blocked By', value: message.author.tag, inline: true },
      ],
      color: 0xff0000,
      timestamp: new Date(),
    };

    await message.reply({ embeds: [embed] });
    logger.info({ userId, reason, blockedBy: message.author.id }, 'User manually blocked');
  } catch (error) {
    logger.error({ error }, 'Error in blockUser command');
    await message.reply('❌ An error occurred while blocking the user.');
  }
}

/**
 * Unblock a user
 * @param {Object} message - Discord message object
 * @param {Array} args - Command arguments
 */
async function unblockUser(message, args) {
  try {
    if (!message.member?.permissions.has('ADMINISTRATOR')) {
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
        { name: 'Unblocked By', value: message.author.tag, inline: true },
      ],
      color: 0x00ff00,
      timestamp: new Date(),
    };

    await message.reply({ embeds: [embed] });
    logger.info({ userId, unblockedBy: message.author.id }, 'User manually unblocked');
  } catch (error) {
    logger.error({ error }, 'Error in unblockUser command');
    await message.reply('❌ An error occurred while unblocking the user.');
  }
}

/**
 * List all blocked users
 * @param {Object} message - Discord message object
 * @param {Array} args - Command arguments
 */
async function listBlockedUsers(message, args) {
  try {
    if (!message.member?.permissions.has('ADMINISTRATOR')) {
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
    logger.error({ error }, 'Error in listBlockedUsers command');
    await message.reply('❌ An error occurred while listing blocked users.');
  }
}

/**
 * Get detection configuration
 * @param {Object} message - Discord message object
 * @param {Array} args - Command arguments
 */
async function getDetectionConfig(message, args) {
  try {
    if (!message.member?.permissions.has('ADMINISTRATOR')) {
      await message.reply('❌ This command requires administrator permissions.');
      return;
    }

    const config = maliciousUserManager.DETECTION_CONFIG;

    const embed = {
      title: '⚙️ Malicious User Detection Configuration',
      fields: [
        {
          name: 'Max Deletions/Hour',
          value: config.MAX_DELETIONS_PER_HOUR.toString(),
          inline: true,
        },
        { name: 'Max Deletions/Day', value: config.MAX_DELETIONS_PER_DAY.toString(), inline: true },
        {
          name: 'Rapid Delete Threshold',
          value: `${config.RAPID_DELETE_THRESHOLD_MS / 1000}s`,
          inline: true,
        },
        { name: 'Data Retention', value: `${config.CLEANUP_AFTER_DAYS} days`, inline: true },
      ],
      color: 0x0099ff,
      timestamp: new Date(),
    };

    await message.reply({ embeds: [embed] });
  } catch (error) {
    logger.error({ error }, 'Error in getDetectionConfig command');
    await message.reply('❌ An error occurred while getting detection config.');
  }
}

// Command definitions
const commands = {
  userstats: {
    execute: checkUserStats,
    description: 'Check deletion statistics for a user',
    usage: 'userstats <@user|userID>',
    aliases: ['deletestats', 'ustats'],
  },
  blockuser: {
    execute: blockUser,
    description: 'Block a user from being processed by the bot',
    usage: 'blockuser <@user|userID> [reason]',
    aliases: ['block'],
  },
  unblockuser: {
    execute: unblockUser,
    description: 'Unblock a previously blocked user',
    usage: 'unblockuser <@user|userID>',
    aliases: ['unblock'],
  },
  blocklist: {
    execute: listBlockedUsers,
    description: 'List all blocked users',
    usage: 'blocklist',
    aliases: ['blocked', 'listblocked'],
  },
  detectionconfig: {
    execute: getDetectionConfig,
    description: 'Show malicious user detection configuration',
    usage: 'detectionconfig',
    aliases: ['detectconfig', 'maliciousconfig'],
  },
};

module.exports = {
  name: 'maliciousUsers',
  commands,
};
