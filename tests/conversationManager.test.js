const assert = require('assert');
const { describe, it, before, after } = require('mocha');
const conversationManager = require('../conversationOptimizer');

// Test user ID
const TEST_USER_ID = 'test-user-' + Date.now(); // Make sure it's unique
const TEST_IMAGE_URL = 'https://example.com/image.png';

// Mock logger to reduce noise
const originalLoggers = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug
};

before(() => {
  // Only log errors during tests
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.warn = (message) => {
    if (process.env.DEBUG_TESTS) originalLoggers.warn(message);
  };
  console.error = (message) => {
    if (process.env.DEBUG_TESTS) originalLoggers.error(message);
  };
});

after(() => {
  // Restore original loggers
  Object.assign(console, originalLoggers);
});

describe('Enhanced Conversation Manager', function() {
  // Increase timeout for tests that might take longer
  this.timeout(5000);

  // Clean up before and after tests
  before(async () => {
    try {
      await conversationManager.shutdown(); // Clean up any existing instances
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
      await conversationManager.init(true); // Force reinitialization
      await conversationManager.clearConversation(TEST_USER_ID);
    } catch (error) {
      console.error('Setup failed:', error);
      throw error;
    }
  });

  after(async () => {
    try {
      await conversationManager.clearConversation(TEST_USER_ID);
      await conversationManager.shutdown();
    } catch (error) {
      console.error('Teardown failed:', error);
    }
  });

  it('should add a simple message with metadata', async () => {
    const message = {
      role: 'user',
      content: 'Hello, bot!'
    };

    const conversation = await conversationManager.addMessage(TEST_USER_ID, message, {
      username: 'testuser',
      messageId: 'msg_1'
    });

    assert.strictEqual(conversation.length, 2); // System message + our message
    const addedMessage = conversation[1];
    
    assert.strictEqual(addedMessage.role, 'user');
    assert.strictEqual(addedMessage.content, 'Hello, bot!');
    assert.strictEqual(addedMessage.name, 'testuser');
    assert.strictEqual(addedMessage.messageId, 'msg_1');
    assert.ok(addedMessage.timestamp);
  });

  it('should handle image generation context', async () => {
    // Add an image generation request
    const imageRequest = {
      role: 'user',
      content: 'Generate an image of a sunset'
    };

    await conversationManager.addMessage(TEST_USER_ID, imageRequest, {
      username: 'testuser',
      messageId: 'msg_2'
    });

    // Add the image generation result
    const imageResult = {
      role: 'function',
      name: 'generate_image',
      content: 'Generate an image of a sunset',
      result: {
        url: TEST_IMAGE_URL
      }
    };

    await conversationManager.addMessage(TEST_USER_ID, imageResult, {
      messageId: 'msg_3'
    });

    // Get the conversation
    const conversation = await conversationManager.getConversation(TEST_USER_ID);
    
    // Verify the image result was stored with metadata
    const imageMessage = conversation.find(msg => msg.messageId === 'msg_3');
    assert.ok(imageMessage);
    assert.strictEqual(imageMessage.metadata.type, 'image');
    assert.strictEqual(imageMessage.metadata.image.prompt, 'Generate an image of a sunset');
    assert.strictEqual(imageMessage.metadata.image.url, TEST_IMAGE_URL);

    // Test getting image context
    const imageContext = await conversationManager.getImageContext(TEST_USER_ID);
    assert.strictEqual(imageContext.length, 1);
    assert.strictEqual(imageContext[0].prompt, 'Generate an image of a sunset');
    assert.strictEqual(imageContext[0].url, TEST_IMAGE_URL);
  });

  it('should handle message threading', async () => {
    // Add a reply to the previous message
    const replyMessage = {
      role: 'user',
      content: 'Can you make it more colorful?'
    };

    await conversationManager.addMessage(TEST_USER_ID, replyMessage, {
      username: 'testuser',
      messageId: 'msg_4',
      inReplyTo: 'msg_3'  // Replying to the image generation
    });

    // Get the full conversation
    const conversation = await conversationManager.getConversation(TEST_USER_ID);
    
    // Find our messages in the conversation
    const message3 = conversation.find(msg => msg.messageId === 'msg_3');
    const message4 = conversation.find(msg => msg.messageId === 'msg_4');
    
    // Verify both messages exist and are in the correct order
    assert.ok(message3, 'Message 3 should exist');
    assert.ok(message4, 'Message 4 should exist');
    
    // Verify the reply relationship
    assert.strictEqual(message4.inReplyTo, 'msg_3', 'Message 4 should be a reply to message 3');
  });

  it('should preserve important context when pruning', async () => {
    // Clear the conversation first to ensure a clean state
    await conversationManager.clearConversation(TEST_USER_ID);
    
    // Add an initial message
    await conversationManager.addMessage(TEST_USER_ID, {
      role: 'user',
      content: 'Hello, bot!'
    }, {
      username: 'testuser',
      messageId: 'msg_init'
    });

    // Add an image generation
    const imageResult = {
      role: 'function',
      name: 'generate_image',
      content: 'Generate an image of mountains',
      result: {
        url: 'https://example.com/mountains.png'
      }
    };

    await conversationManager.addMessage(TEST_USER_ID, imageResult, {
      messageId: 'msg_img_2'
    });

    // Add some more messages to fill up the conversation
    for (let i = 0; i < 5; i++) {
      await conversationManager.addMessage(TEST_USER_ID, {
        role: 'user',
        content: `Filler message ${i}`
      }, {
        username: 'testuser',
        messageId: `filler_${i}`
      });
    }

    // Get the conversation
    const conversation = await conversationManager.getConversation(TEST_USER_ID);
    
    // Verify the conversation isn't too long (respecting MAX_CONVERSATION_LENGTH)
    assert(conversation.length <= 12, 'Conversation should not exceed MAX_CONVERSATION_LENGTH');
    
    // Verify the image context is still there
    const imageContext = await conversationManager.getImageContext(TEST_USER_ID);
    assert.strictEqual(imageContext.length, 1, 'Should have exactly one image in context');
    
    // The image prompt should match what we stored
    const expectedPrompt = 'Generate an image of mountains';
    assert.strictEqual(
      imageContext[0].prompt, 
      expectedPrompt,
      `Image prompt should be "${expectedPrompt}" but was "${imageContext[0].prompt}"`
    );
  });
});
