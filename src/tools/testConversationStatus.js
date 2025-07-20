/**
 * Test Conversation Status Tool
 *
 * This script tests the PocketFlow conversation system by:
 * 1. Checking PocketFlow status
 * 2. Testing conversation management
 * 3. Displaying storage status
 *
 * @module TestConversationStatus
 * @author Brett
 * @version 2.0.0
 */

require('dotenv').config();
const { createLogger } = require('../core/logger');
const logger = createLogger('testConversationStatus');
const {
  manageConversation,
  clearConversation,
  loadConversationsFromStorage,
  saveConversationsToStorage,
  getConversationStorageStatus,
} = require('../conversation/conversationManagerSelector');

/**
 * Test conversation storage functionality
 */
async function testConversationStorage() {
  try {
    logger.info('Starting conversation storage test...');

    // Test PocketFlow status
    const initialStatus = getConversationStorageStatus();
    logger.info({ status: initialStatus }, 'PocketFlow initial status');

    // Create test conversations
    const testUserId1 = 'test-user-1';
    const testUserId2 = 'test-user-2';

    // Clear any existing conversations for these test users
    clearConversation(testUserId1);
    clearConversation(testUserId2);

    // Add test messages to conversations with timestamps
    const now = Date.now();
    logger.info('Creating test conversations...');

    manageConversation(testUserId1, {
      role: 'system',
      content: 'You are a helpful assistant',
      timestamp: now,
    });
    manageConversation(testUserId1, { role: 'user', content: 'Hello, bot!', timestamp: now });
    manageConversation(testUserId1, {
      role: 'assistant',
      content: 'Hello, human!',
      timestamp: now,
    });

    manageConversation(testUserId2, {
      role: 'system',
      content: 'You are a helpful assistant',
      timestamp: now,
    });
    manageConversation(testUserId2, { role: 'user', content: 'How are you?', timestamp: now });
    manageConversation(testUserId2, {
      role: 'assistant',
      content: 'I am fine, thank you!',
      timestamp: now,
    });

    // Get status before saving
    const statusBeforeSave = getConversationStorageStatus();
    logger.info({ status: statusBeforeSave }, 'Conversation storage status before saving');

    // Save conversations to disk
    logger.info('Saving conversations to disk...');
    const saveResult = await saveConversationsToStorage(true);
    logger.info({ saveResult }, 'Conversations saved to disk');

    // Clear conversations from memory
    clearConversation(testUserId1);
    clearConversation(testUserId2);
    logger.info('Cleared conversations from memory');

    // Get status after clearing
    const statusAfterClear = getConversationStorageStatus();
    logger.info({ status: statusAfterClear }, 'Conversation storage status after clearing');

    // Load conversations from disk
    logger.info('Loading conversations from disk...');
    const loadResult = await loadConversationsFromStorage();
    logger.info({ loadResult }, 'Conversations loaded from disk');

    // Get status after loading
    const statusAfterLoad = getConversationStorageStatus();
    logger.info({ status: statusAfterLoad }, 'Conversation storage status after loading');

    // Check if the loaded conversations match the original ones
    const loadedConversation1 = manageConversation(testUserId1);
    const loadedConversation2 = manageConversation(testUserId2);

    logger.info(
      {
        user1: testUserId1,
        conversation1: loadedConversation1,
        user2: testUserId2,
        conversation2: loadedConversation2,
      },
      'Loaded conversations'
    );

    // Print final status
    const finalStatus = getConversationStorageStatus();
    logger.info({ status: finalStatus }, 'Final conversation storage status');

    return {
      success: true,
      statusBeforeSave,
      statusAfterClear,
      statusAfterLoad,
      finalStatus,
    };
  } catch (error) {
    logger.error({ error }, 'Error testing conversation storage');
    return {
      success: false,
      error: error.message,
    };
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testConversationStorage()
    .then(result => {
      console.log('Conversation Storage Test Results:');
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Error running conversation storage test:', error);
      process.exit(1);
    });
}
