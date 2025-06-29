/**
 * Test Approval Command
 *
 * This command is used to test the human circuit breaker approval system.
 * It triggers an approval request without performing any actual actions.
 *
 * @module TestApprovalCommand
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../../src/core/logger');
const logger = createLogger('cmd-test-approval');

module.exports = {
  name: 'testapproval',
  description: 'Test the human circuit breaker approval system',
  aliases: ['approvaltest', 'testcircuitbreaker'],
  dmAllowed: true,
  ownerOnly: false, // Allow anyone to test, but only owner can approve
  requiresApproval: true,

  async execute(message, args) {
    logger.info(
      {
        userId: message.author.id,
        username: message.author.username,
        args: args,
      },
      'Test approval command triggered'
    );

    // This will only execute if approved
    await message.reply(`✅ Approval test successful! The command was approved and executed.`);

    // Log some test data
    logger.info(
      {
        testData: {
          timestamp: new Date().toISOString(),
          userId: message.author.id,
          username: message.author.username,
          channelId: message.channelId,
          guildId: message.guild?.id || 'DM',
          args: args.join(' ') || 'none',
        },
      },
      'Test approval command completed'
    );
  },
};
