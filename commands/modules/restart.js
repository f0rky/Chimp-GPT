// commands/modules/restart.js
/**
 * Restart Command Module
 *
 * Allows the bot owner to remotely restart the bot process.
 * Only the owner (config.OWNER_ID) can use this command.
 */
const config = require('../../src/core/configValidator');

module.exports = {
  name: 'restart',
  description: 'Restart the bot (owner only)',
  aliases: ['reboot', 'reset-bot'],
  dmAllowed: true,
  ownerOnly: true,
  requiresApproval: true,
  // eslint-disable-next-line consistent-return
  async execute(message) {
    if (message.author.id !== config.OWNER_ID) {
      return message.reply('Sorry, only the bot owner can use this command.');
    }
    await message.reply('Restarting the bot...');
    process.exit(0); // Assumes process manager will restart the bot
  },
  // eslint-disable-next-line consistent-return
  async executeSlash(interaction) {
    if (interaction.user.id !== config.OWNER_ID) {
      return interaction.reply({
        content: 'Sorry, only the bot owner can use this command.',
        ephemeral: true,
      });
    }
    await interaction.reply({
      content: 'Restarting the bot...',
      ephemeral: true,
    });
    process.exit(0); // Assumes process manager will restart the bot
  },
};
