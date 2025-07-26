/**
 * Debug Skip Status Command
 *
 * This command allows the bot owner to check the current status of the debug skip functionality
 * and manually deactivate it if needed.
 *
 * @module DebugSkipStatusCommand
 * @author Brett
 * @version 1.0.0
 */

const { getSkipState, manualDeactivate, SKIP_EMOJI } = require('../../utils/debugSkipManager');

module.exports = {
  name: 'debugskip',
  aliases: ['ds', 'skipstatus'],
  description: 'Check or manage debug skip status (owner only)',
  ownerOnly: true,
  dmAllowed: true,

  async execute(message, args, _client, _config) {
    const skipState = getSkipState();

    // Handle subcommands
    const subcommand = args[0]?.toLowerCase();

    if (subcommand === 'off' || subcommand === 'disable' || subcommand === 'clear') {
      const wasActive = manualDeactivate();
      if (wasActive) {
        await message.reply('✅ Debug skip mode has been manually deactivated.');
      } else {
        await message.reply('ℹ️ Debug skip mode was not active.');
      }
      return;
    }

    // Show current status
    let statusMessage = `**Debug Skip Status:**\n`;

    if (skipState.isActive) {
      const timeRemaining = Math.ceil(skipState.autoResetIn / 1000 / 60);
      statusMessage += `🟢 **Active** - Will skip next log checking operation\n`;
      statusMessage += `⏰ **Auto-reset in:** ${timeRemaining} minutes\n`;
      statusMessage += `📅 **Activated at:** <t:${Math.floor(skipState.activatedAt.getTime() / 1000)}:R>\n`;
      if (skipState.messageId) {
        statusMessage += `📝 **Message ID:** ${skipState.messageId}\n`;
      }
      statusMessage += `\n*Use \`!debugskip off\` to manually deactivate*`;
    } else {
      statusMessage += `🔴 **Inactive** - Log checking will proceed normally\n`;
      statusMessage += `\n*React with ${SKIP_EMOJI} to any bot message to activate skip mode*`;
    }

    await message.reply(statusMessage);
  },
};
