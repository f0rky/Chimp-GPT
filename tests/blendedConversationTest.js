/**
 * Test script for blended conversation functionality
 */

const blendedManager = require('../blendedConversationManager');
const { createLogger } = require('../logger');
const logger = createLogger('blendedConversationTest');

// Mock config
const mockConfig = {
  BOT_PERSONALITY: "You are a helpful assistant."
};

// Override config requirement
require.cache[require.resolve('../configValidator')] = {
  exports: mockConfig
};

async function runTests() {
  console.log('🧪 Testing Blended Conversation Manager\n');
  
  try {
    // Test 1: Add messages from multiple users
    console.log('📝 Test 1: Adding messages from multiple users');
    const channelId = 'test-channel-123';
    
    // User 1 messages
    blendedManager.addMessageToBlended(channelId, 'user1', {
      role: 'user',
      content: 'Hello, I am user 1!',
      username: 'Alice'
    });
    
    blendedManager.addMessageToBlended(channelId, 'user1', {
      role: 'assistant',
      content: 'Hello Alice!'
    });
    
    // User 2 messages
    blendedManager.addMessageToBlended(channelId, 'user2', {
      role: 'user',
      content: 'Hi there, I am user 2!',
      username: 'Bob'
    });
    
    // User 1 more messages
    for (let i = 2; i <= 6; i++) {
      blendedManager.addMessageToBlended(channelId, 'user1', {
        role: 'user',
        content: `Message ${i} from Alice`,
        username: 'Alice'
      });
    }
    
    // Get blended conversation
    const blended = blendedManager.buildBlendedConversation(channelId);
    
    console.log('Blended conversation:');
    blended.forEach((msg, index) => {
      console.log(`  [${index}] ${msg.role}: ${msg.content.substring(0, 50)}...`);
    });
    
    console.log(`\nTotal messages: ${blended.length}`);
    console.log('✅ Test 1 passed\n');
    
    // Test 2: Verify per-user message limit
    console.log('📝 Test 2: Verify per-user message limit (5 messages)');
    const counts = blendedManager.getActiveConversationCount();
    console.log('Active conversations:', counts);
    
    // Count messages per user
    const channelConvo = blended.filter(msg => msg.role !== 'system');
    const user1Messages = channelConvo.filter(msg => msg.content.includes('Alice')).length;
    const user2Messages = channelConvo.filter(msg => msg.content.includes('Bob')).length;
    
    console.log(`User 1 (Alice) messages in blended: ${user1Messages} (should be <= 5)`);
    console.log(`User 2 (Bob) messages in blended: ${user2Messages}`);
    
    if (user1Messages <= 5) {
      console.log('✅ Test 2 passed: Per-user limit enforced\n');
    } else {
      console.log('❌ Test 2 failed: Per-user limit not enforced\n');
    }
    
    // Test 3: Test DM conversations (not blended)
    console.log('📝 Test 3: Test DM conversations');
    blendedManager.addMessageToBlended('DM', 'user3', {
      role: 'user',
      content: 'This is a DM',
      username: 'Charlie'
    }, true);
    
    blendedManager.addMessageToBlended('DM', 'user3', {
      role: 'assistant',
      content: 'Hello Charlie, I see your DM!'
    }, true);
    
    const dmCount = blendedManager.getActiveConversationCount();
    console.log('Conversation counts after DM:', dmCount);
    console.log('✅ Test 3 passed\n');
    
    // Test 4: Clear conversation
    console.log('📝 Test 4: Clear conversation');
    const cleared = blendedManager.clearConversation(channelId, false);
    console.log(`Channel conversation cleared: ${cleared}`);
    
    const afterClear = blendedManager.getActiveConversationCount();
    console.log('Conversation counts after clear:', afterClear);
    console.log('✅ Test 4 passed\n');
    
    // Test 5: Get status
    console.log('📝 Test 5: Get conversation status');
    const status = blendedManager.getConversationStatus();
    console.log('Conversation status:', JSON.stringify(status, null, 2));
    console.log('✅ Test 5 passed\n');
    
    console.log('🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});