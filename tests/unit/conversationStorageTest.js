/**
 * Conversation Storage Test Module
 *
 * This module tests the persistent conversation storage system to ensure
 * it properly saves and loads conversations to/from disk.
 *
 * @module ConversationStorageTest
 * @author Brett
 * @version 1.0.0
 */

// Import required modules
const conversationStorage = require('../conversationStorage');
const { createLogger } = require('../logger');
const logger = createLogger('conversationStorageTest');
const fs = require('fs');
const path = require('path');

/**
 * Test the conversation storage system
 *
 * This function tests various aspects of the conversation storage:
 * - Saving conversations to disk
 * - Loading conversations from disk
 * - Pruning old conversations
 * - Error handling
 *
 * @returns {Object} Test results with success/failure status and details
 */
async function testConversationStorage() {
  logger.info('Starting conversation storage tests...');

  const results = {
    success: true,
    results: [],
  };

  try {
    // Create test data
    const testConversations = new Map();
    const testUserId1 = 'test-user-1';
    const testUserId2 = 'test-user-2';

    testConversations.set(testUserId1, [
      { role: 'system', content: 'Test system message' },
      { role: 'user', content: 'Test user message 1' },
      { role: 'assistant', content: 'Test assistant message 1' },
    ]);

    testConversations.set(testUserId2, [
      { role: 'system', content: 'Test system message' },
      { role: 'user', content: 'Test user message 2' },
      { role: 'assistant', content: 'Test assistant message 2' },
    ]);

    // Test 1: Save conversations to disk
    logger.info('Test 1: Save conversations to disk');
    const test1Result = {
      name: 'Save conversations to disk',
      success: false,
      details: {},
    };

    try {
      const saveResult = await conversationStorage.saveConversations(testConversations);

      test1Result.success = saveResult === true;
      test1Result.details = {
        saved: test1Result.success ? 'Yes' : 'No',
        conversationCount: testConversations.size,
      };

      if (!test1Result.success) {
        logger.warn('Failed to save conversations in Test 1');
      } else {
        logger.info('Conversations saved successfully');
      }
    } catch (error) {
      test1Result.success = false;
      test1Result.error = error.message;
      logger.error({ error }, 'Error in Test 1: Save conversations');
    }

    results.results.push(test1Result);

    // Test 2: Load conversations from disk
    logger.info('Test 2: Load conversations from disk');
    const test2Result = {
      name: 'Load conversations from disk',
      success: false,
      details: {},
    };

    try {
      const loadedConversations = await conversationStorage.loadConversations();

      // Verify loaded data matches test data
      const loadedUser1 = loadedConversations.get(testUserId1);
      const loadedUser2 = loadedConversations.get(testUserId2);

      const user1Matches =
        loadedUser1 &&
        loadedUser1.length === 3 &&
        loadedUser1[0].role === 'system' &&
        loadedUser1[1].role === 'user' &&
        loadedUser1[2].role === 'assistant';

      const user2Matches =
        loadedUser2 &&
        loadedUser2.length === 3 &&
        loadedUser2[0].role === 'system' &&
        loadedUser2[1].role === 'user' &&
        loadedUser2[2].role === 'assistant';

      test2Result.success = user1Matches && user2Matches;
      test2Result.details = {
        loaded: test2Result.success ? 'Yes' : 'No',
        conversationCount: loadedConversations.size,
        user1Matches: user1Matches ? 'Yes' : 'No',
        user2Matches: user2Matches ? 'Yes' : 'No',
      };

      if (!test2Result.success) {
        logger.warn(
          {
            user1Matches,
            user2Matches,
            loadedSize: loadedConversations.size,
            expectedSize: testConversations.size,
          },
          'Loaded conversations do not match expected data in Test 2'
        );
      } else {
        logger.info('Conversations loaded successfully');
      }
    } catch (error) {
      test2Result.success = false;
      test2Result.error = error.message;
      logger.error({ error }, 'Error in Test 2: Load conversations');
    }

    results.results.push(test2Result);

    // Test 3: Prune old conversations
    logger.info('Test 3: Prune old conversations');
    const test3Result = {
      name: 'Prune old conversations',
      success: false,
      details: {},
    };

    try {
      // Create a map with both recent and old conversations
      const mixedConversations = new Map(testConversations);

      // Prune with a very short max age (1ms) to force pruning
      const prunedConversations = await conversationStorage.pruneOldConversations(
        mixedConversations,
        1
      );

      // All conversations should be pruned with such a short max age
      test3Result.success = prunedConversations.size === 0;
      test3Result.details = {
        originalCount: mixedConversations.size,
        prunedCount: prunedConversations.size,
        allPruned: test3Result.success ? 'Yes' : 'No',
      };

      if (!test3Result.success) {
        logger.warn(
          {
            originalSize: mixedConversations.size,
            prunedSize: prunedConversations.size,
          },
          'Pruning did not work as expected in Test 3'
        );
      } else {
        logger.info('Conversation pruning worked successfully');
      }
    } catch (error) {
      test3Result.success = false;
      test3Result.error = error.message;
      logger.error({ error }, 'Error in Test 3: Prune conversations');
    }

    results.results.push(test3Result);

    // Test 4: Clear all conversations
    logger.info('Test 4: Clear all conversations');
    const test4Result = {
      name: 'Clear all conversations',
      success: false,
      details: {},
    };

    try {
      const clearResult = await conversationStorage.clearAllConversations();

      // Verify conversations were cleared
      const conversationsAfterClear = await conversationStorage.loadConversations();

      test4Result.success = clearResult === true && conversationsAfterClear.size === 0;
      test4Result.details = {
        cleared: test4Result.success ? 'Yes' : 'No',
        conversationCountAfterClear: conversationsAfterClear.size,
      };

      if (!test4Result.success) {
        logger.warn(
          {
            clearResult,
            sizeAfterClear: conversationsAfterClear.size,
          },
          'Failed to clear conversations in Test 4'
        );
      } else {
        logger.info('Conversations cleared successfully');
      }
    } catch (error) {
      test4Result.success = false;
      test4Result.error = error.message;
      logger.error({ error }, 'Error in Test 4: Clear conversations');
    }

    results.results.push(test4Result);

    // Calculate overall success
    const failedTests = results.results.filter(test => !test.success);
    results.success = failedTests.length === 0;
    results.summary = {
      total: results.results.length,
      passed: results.results.length - failedTests.length,
      failed: failedTests.length,
    };

    logger.info(
      {
        passed: results.summary.passed,
        failed: results.summary.failed,
        total: results.summary.total,
      },
      'Conversation storage tests completed'
    );
  } catch (error) {
    results.success = false;
    results.error = error.message;
    logger.error({ error }, 'Unexpected error in conversation storage tests');
  }

  return results;
}

// Run tests if this file is executed directly
if (require.main === module) {
  testConversationStorage()
    .then(results => {
      console.log(JSON.stringify(results, null, 2));
      process.exit(results.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution error:', error);
      process.exit(1);
    });
}

module.exports = { testConversationStorage };
