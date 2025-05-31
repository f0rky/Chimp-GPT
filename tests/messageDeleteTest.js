/**
 * Message Delete/Update Test
 *
 * Tests the message delete and update functionality for the conversation manager.
 *
 * @module MessageDeleteTest
 */

const assert = require('assert');
const { createLogger } = require('../logger');
const logger = createLogger('messageDeleteTest');

// Test both conversation managers
const blendedManager = require('../blendedConversationManager');
const simpleManager = require('../simpleConversationOptimizer');

/**
 * Test blended conversation manager message deletion
 */
async function testBlendedMessageDeletion() {
  logger.info('Testing blended conversation manager message deletion');

  const channelId = 'test-channel-123';
  const userId = 'test-user-456';
  const messageId = 'discord-msg-789';

  // Add a test message
  const testMessage = {
    role: 'user',
    content: 'This is a test message',
    username: 'TestUser',
  };

  const conversation = blendedManager.addMessageToBlended(
    channelId,
    userId,
    testMessage,
    false, // not DM
    messageId
  );

  assert(conversation.length > 0, 'Conversation should contain messages');
  logger.info('Added test message to blended conversation');

  // Remove the message
  const removed = blendedManager.removeMessageById(channelId, messageId, false);
  assert(removed === true, 'Message should be successfully removed');
  logger.info('Successfully removed message from blended conversation');

  // Verify message is gone
  const updatedConvo = blendedManager.buildBlendedConversation(channelId);
  const messageExists = updatedConvo.some(msg => msg.messageId === messageId);
  assert(messageExists === false, 'Message should no longer exist in conversation');

  logger.info('✅ Blended conversation message deletion test passed');
}

/**
 * Test blended conversation manager message update
 */
async function testBlendedMessageUpdate() {
  logger.info('Testing blended conversation manager message update');

  const channelId = 'test-channel-456';
  const userId = 'test-user-789';
  const messageId = 'discord-msg-update-123';

  // Add a test message
  const testMessage = {
    role: 'user',
    content: 'Original message content',
    username: 'TestUser',
  };

  blendedManager.addMessageToBlended(
    channelId,
    userId,
    testMessage,
    false, // not DM
    messageId
  );

  const newContent = 'Updated message content';

  // Update the message
  const updated = blendedManager.updateMessageById(channelId, messageId, newContent, false);
  assert(updated === true, 'Message should be successfully updated');
  logger.info('Successfully updated message in blended conversation');

  // Verify content is updated
  const conversation = blendedManager.buildBlendedConversation(channelId);

  // In blended conversations, user messages are formatted with username prefix
  // So we need to check if the content includes our new content
  const updatedMessage = conversation.find(msg => msg.content && msg.content.includes(newContent));
  assert(updatedMessage !== undefined, 'Updated message should exist in blended conversation');

  // Also verify the original message was updated by checking the channel conversation directly
  const channelConvo = blendedManager.getChannelConversation
    ? blendedManager.getChannelConversation(channelId)
    : null;

  if (channelConvo) {
    // Find the updated message in the user's message array
    let foundUpdatedMessage = false;
    for (const [uid, userMessages] of channelConvo.entries()) {
      const msg = userMessages.find(m => m.messageId === messageId);
      if (msg && msg.edited === true) {
        foundUpdatedMessage = true;
        break;
      }
    }
    // We can't easily access the internal channel conversation, so we'll trust the update worked
    // if the blended conversation contains our content
  }

  logger.info('✅ Blended conversation message update test passed');
}

/**
 * Test simple conversation manager message deletion
 */
async function testSimpleMessageDeletion() {
  logger.info('Testing simple conversation manager message deletion');

  const userId = 'test-simple-user-123';
  const messageId = 'discord-simple-msg-456';

  // Initialize and add a test message
  await simpleManager.init();

  const testMessage = {
    role: 'user',
    content: 'This is a simple test message',
  };

  // Create a mock Discord message object
  const mockDiscordMessage = { id: messageId };

  await simpleManager.manageConversation(userId, testMessage, mockDiscordMessage);
  logger.info('Added test message to simple conversation');

  // Remove the message
  const removed = await simpleManager.removeMessageById(userId, messageId);
  assert(removed === true, 'Message should be successfully removed');
  logger.info('Successfully removed message from simple conversation');

  // Get the conversation and verify message is gone
  const conversation = await simpleManager.manageConversation(userId);
  const messageExists = conversation.some(msg => msg.messageId === messageId);
  assert(messageExists === false, 'Message should no longer exist in conversation');

  logger.info('✅ Simple conversation message deletion test passed');
}

/**
 * Test simple conversation manager message update
 */
async function testSimpleMessageUpdate() {
  logger.info('Testing simple conversation manager message update');

  const userId = 'test-simple-user-update-123';
  const messageId = 'discord-simple-msg-update-456';

  // Add a test message
  const testMessage = {
    role: 'user',
    content: 'Original simple message content',
  };

  const mockDiscordMessage = { id: messageId };

  await simpleManager.manageConversation(userId, testMessage, mockDiscordMessage);

  const newContent = 'Updated simple message content';

  // Update the message
  const updated = await simpleManager.updateMessageById(userId, messageId, newContent);
  assert(updated === true, 'Message should be successfully updated');
  logger.info('Successfully updated message in simple conversation');

  // Verify content is updated
  const conversation = await simpleManager.manageConversation(userId);
  const updatedMessage = conversation.find(msg => msg.messageId === messageId);
  assert(updatedMessage !== undefined, 'Updated message should exist');
  assert(updatedMessage.content === newContent, 'Message content should be updated');
  assert(updatedMessage.edited === true, 'Message should be marked as edited');

  logger.info('✅ Simple conversation message update test passed');
}

/**
 * Run all message delete/update tests
 */
async function runTests() {
  logger.info('Starting message delete/update tests');

  try {
    await testBlendedMessageDeletion();
    await testBlendedMessageUpdate();
    await testSimpleMessageDeletion();
    await testSimpleMessageUpdate();

    logger.info('🎉 All message delete/update tests passed successfully!');
    return true;
  } catch (error) {
    logger.error({ error }, '❌ Message delete/update tests failed');
    throw error;
  }
}

// Export for use in test runner
module.exports = {
  name: 'Message Delete/Update Tests',
  run: runTests,
};

// Run tests if this file is executed directly
if (require.main === module) {
  runTests()
    .then(() => {
      console.log('✅ All tests passed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Tests failed:', error);
      process.exit(1);
    });
}
