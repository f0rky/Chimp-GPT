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

// Mock Discord message for testing
function createMockMessage({ id, content, author, reference = null }) {
  return {
    id,
    content,
    author: { id: author.id, username: author.name, bot: author.isBot },
    reference,
    channel: {
      messages: {
        // Mock fetch method that simulates fetching referenced messages
        fetch: async (messageId) => {
          // Look up the message in our mock message store
          const msg = mockMessages.find(m => m.id === messageId);
          if (!msg) {
            throw new Error(`Mock message with ID ${messageId} not found`);
          }
          return msg;
        }
      }
    }
  };
}

// Create mock user and bot
const mockUser = { id: '123456789', name: 'TestUser', isBot: false };
const mockBot = { id: '987654321', name: 'ChimpGPT', isBot: true };

// Create a series of mock messages that reference each other
const mockMessages = [
  createMockMessage({ 
    id: 'msg1', 
    content: 'Hello ChimpGPT!', 
    author: mockUser 
  }),
  createMockMessage({ 
    id: 'msg2', 
    content: 'Hi there! How can I help you today?', 
    author: mockBot,
    reference: { messageId: 'msg1', channelId: 'test-channel', guildId: 'test-guild' }
  }),
  createMockMessage({ 
    id: 'msg3', 
    content: 'I want to know about the weather in New York.', 
    author: mockUser,
    reference: { messageId: 'msg2', channelId: 'test-channel', guildId: 'test-guild' }
  }),
  createMockMessage({ 
    id: 'msg4', 
    content: 'The weather in New York is currently sunny with a high of 75°F.', 
    author: mockBot,
    reference: { messageId: 'msg3', channelId: 'test-channel', guildId: 'test-guild' }
  }),
  createMockMessage({ 
    id: 'msg5', 
    content: 'What about tomorrow?', 
    author: mockUser,
    reference: { messageId: 'msg4', channelId: 'test-channel', guildId: 'test-guild' }
  })
];

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
    logger.info({ 
      messageId: mockMessages[1].id,
      referencedMessageId: singleRef.id,
      referencedContent: singleRef.content
    }, 'Resolved single reference');
    
    // Test reference chain resolution
    const refChain = await referenceResolver.resolveReferenceChain(mockMessages[4]);
    logger.info({ 
      messageId: mockMessages[4].id,
      chainLength: refChain.length,
      chain: refChain.map(m => ({ id: m.id, content: m.content }))
    }, 'Resolved reference chain');
    
    // Test context extraction
    const context = await referenceResolver.extractReferenceContext(mockMessages[4]);
    logger.info({ 
      messageId: mockMessages[4].id,
      contextSize: context.length,
      context: context.map(m => ({ role: m.role, content: m.content }))
    }, 'Extracted reference context');
    
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
    let conversation = await conversationManager.manageConversation(
      mockUser.id,
      {
        role: 'user',
        content: mockMessages[0].content
      }
    );
    
    logger.info({ 
      userId: mockUser.id,
      conversationLength: conversation.length,
      conversation: conversation.map(m => ({ role: m.role, content: m.content }))
    }, 'Initial conversation state');
    
    // Now add a message that has a reference chain
    conversation = await conversationManager.manageConversation(
      mockUser.id,
      {
        role: 'user',
        content: mockMessages[4].content
      },
      mockMessages[4]
    );
    
    logger.info({ 
      userId: mockUser.id,
      conversationLength: conversation.length,
      conversation: conversation.map(m => ({ role: m.role, content: m.content }))
    }, 'Conversation with references');
    
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
