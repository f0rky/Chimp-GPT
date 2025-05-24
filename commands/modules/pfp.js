/**
 * PFP Update Command for ChimpGPT (Owner Only)
 *
 * This command allows the bot owner to manually trigger an update
 * of the bot's profile picture.
 *
 * @module PFPCommand
 * @author Cascade
 * @version 1.0.0
 */

const { createLogger } = require('../../logger');
const logger = createLogger('commands:pfp');

module.exports = {
  name: 'pfp',
  description: "Manually updates the bot's profile picture (Owner Only).",
  aliases: ['setpfp', 'updatepfp', 'newpfp'],
  ownerOnly: true, // Ensures only the bot owner can use this command
  dmAllowed: true, // Allow this command in DMs
  cooldown: 300, // 5 minute cooldown to prevent spamming PFP updates

  /**
   * Execute the PFP update command
   *
   * @param {import('discord.js').Message} message - Discord message object
   * @param {string[]} args - Command arguments (not used in this command)
   * @param {import('discord.js').Client} client - The Discord client instance
   * @param {Object} config - The bot's configuration object
   * @returns {Promise<void>}
   */
  async execute(message, args, client, config) {
    // Diagnostic log for pfpManager status at command execution
    if (client.pfpManager) {
      logger.info(
        {
          pfpManagerStatus: 'Exists on client at command execution',
          typeof: typeof client.pfpManager,
          constructorName: client.pfpManager.constructor
            ? client.pfpManager.constructor.name
            : 'N/A',
          methods:
            typeof client.pfpManager === 'object'
              ? Object.getOwnPropertyNames(client.pfpManager.constructor.prototype)
              : 'N/A',
        },
        'PFP Manager diagnostic in command execute'
      );
    } else {
      logger.error(
        {
          pfpManagerStatus: 'MISSING on client at command execution',
          clientKeys: Object.keys(client), // Log available keys on client to see what's there
        },
        'PFP Manager diagnostic in command execute - IT IS MISSING'
      );
    }

    if (!client.pfpManager) {
      logger.error('PFPManager not found on client object during pfp command execution.');
      await message.reply('❌ An internal error occurred: PFPManager is not available.');
      return;
    }

    try {
      const reply = await message.reply(
        '🔄 Attempting to update profile picture... This may take a moment.'
      );

      // Trigger the PFP update
      const result = await client.pfpManager.updateBotAvatar();

      if (result.success) {
        let successMessage = '✅ Profile picture updated successfully!';
        if (result.newAvatarURL) {
          // Note: Discord might take a bit to show the new PFP in the client.
          // The URL provided by PFPManager might be a direct link to the image file, not necessarily the Discord CDN URL.
          successMessage += ` Check my profile!`;
        }
        await reply.edit(successMessage);
        logger.info({ userId: message.author.id }, 'PFP updated successfully by owner.');
      } else {
        let errorMessage = '⚠️ Failed to update profile picture.';
        if (result.error) {
          errorMessage += ` Reason: ${result.error}`;
        }
        if (result.ratelimited) {
          errorMessage += ' (Rate-limited by Discord)';
        }
        await reply.edit(errorMessage);
        logger.warn(
          { userId: message.author.id, error: result.error, ratelimited: result.ratelimited },
          'PFP update failed for owner.'
        );
      }
    } catch (error) {
      logger.error(
        { error, command: 'pfp', userId: message.author.id },
        'Error executing pfp command'
      );
      await message.reply(
        '❌ An unexpected error occurred while trying to update the profile picture.'
      );
    }
  },
};
