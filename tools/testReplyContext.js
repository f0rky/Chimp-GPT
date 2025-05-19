/**
 * Test script for the reply context enhancement feature.
 *
 * This script simulates different message reference scenarios
 * to verify that the reference resolver and conversation manager
 * correctly handle message references.
 *
 * Usage: node tools/testReplyContext.js
 */

require('dotenv').config();
const { createLogger } = require('../logger');
const referenceResolver = require('../utils/messageReferenceResolver');
const conversationManager = require('../conversationManager');

const logger = createLogger('test-reply-context');

// Create mock user and bot
const mockUser = { id: '123456789', name: 'TestUser', isBot: false };
const mockBot = { id: '987654321', name: 'ChimpGPT', isBot: true };

// Create a series of mock messages that reference each other
const mockMessages = [];

// Helper function to create a message with a fetch method
function createMessage(id, content, author, reference = null) {
  const message = {
    id,
    content,
    author: { id: author.id, username: author.name, bot: author.isBot },
    reference,
    channel: {
      messages: {
        fetch: async messageId => {
          const msg = mockMessages.find(m => m.id === messageId);
          if (!msg) throw new Error(`Message ${messageId} not found`);
          return msg;
        },
      },
    },
  };

  // Add message to the mockMessages array
  mockMessages.push(message);
  return message;
}

// Create the mock messages
createMessage('msg1', 'Hello ChimpGPT!', mockUser);
createMessage('msg2', 'Hi there! How can I help you today?', mockBot, {
  messageId: 'msg1',
  channelId: 'test-channel',
  guildId: 'test-guild',
});
createMessage('msg3', 'I want to know about the weather in New York.', mockUser, {
  messageId: 'msg2',
  channelId: 'test-channel',
  guildId: 'test-guild',
});
createMessage('msg4', 'The weather in New York is currently sunny with a high of 75°F.', mockBot, {
  messageId: 'msg3',
  channelId: 'test-channel',
  guildId: 'test-guild',
});
createMessage('msg5', 'What about tomorrow?', mockUser, {
  messageId: 'msg4',
  channelId: 'test-channel',
  guildId: 'test-guild',
});

// Set up references in the mock messages
for (let i = 1; i < mockMessages.length; i++) {
  const referenceId = mockMessages[i].reference.messageId;
  const referencedMessage = mockMessages.find(m => m.id === referenceId);
  if (!referencedMessage) {
    throw new Error(`Referenced message ${referenceId} not found`);
  }
}

// Test the reference resolver
async function testReferenceResolver() {
  logger.info('Testing reference resolver...');

  try {
    // Test single reference resolution
    const singleRef = await referenceResolver.resolveReference(mockMessages[1]);
    logger.info(
      {
        messageId: mockMessages[1].id,
        referencedMessageId: singleRef.id,
        referencedContent: singleRef.content,
      },
      'Resolved single reference'
    );

    // Test reference chain resolution
    const refChain = await referenceResolver.resolveReferenceChain(mockMessages[4]);
    logger.info(
      {
        messageId: mockMessages[4].id,
        chainLength: refChain.length,
        chain: refChain.map(m => ({ id: m.id, content: m.content })),
      },
      'Resolved reference chain'
    );

    // Test context extraction
    const context = await referenceResolver.extractReferenceContext(mockMessages[4]);
    logger.info(
      {
        messageId: mockMessages[4].id,
        contextSize: context.length,
        context: context.map(m => ({ role: m.role, content: m.content })),
      },
      'Extracted reference context'
    );

    logger.info('Reference resolver tests completed successfully');
  } catch (error) {
    logger.error({ error }, 'Reference resolver test failed');
  }
}

// Test the conversation manager with references
async function testConversationManager() {
  logger.info('Testing conversation manager with references...');

  try {
    // Clear any existing conversations
    conversationManager.clearConversation(mockUser.id);

    // Add initial message without references
    let conversation = await conversationManager.manageConversation(mockUser.id, {
      role: 'user',
      content: mockMessages[0].content,
    });

    logger.info(
      {
        userId: mockUser.id,
        conversationLength: conversation.length,
        conversation: conversation.map(m => ({ role: m.role, content: m.content })),
      },
      'Initial conversation state'
    );

    // Now add a message that has a reference chain
    conversation = await conversationManager.manageConversation(
      mockUser.id,
      {
        role: 'user',
        content: mockMessages[4].content,
      },
      mockMessages[4]
    );

    logger.info(
      {
        userId: mockUser.id,
        conversationLength: conversation.length,
        conversation: conversation.map(m => ({ role: m.role, content: m.content })),
      },
      'Conversation with references'
    );

    logger.info('Conversation manager tests completed successfully');
  } catch (error) {
    logger.error({ error }, 'Conversation manager test failed');
  }
}

// Run the tests
async function runTests() {
  logger.info('Starting reply context enhancement tests...');

  await testReferenceResolver();
  await testConversationManager();

  logger.info('All tests completed');
}

// Run the tests and handle any uncaught errors
runTests().catch(error => {
  logger.error({ error }, 'Uncaught error in tests');
  process.exit(1);
});
