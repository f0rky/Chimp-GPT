/**
 * Conversation Persistence Test Module
 * 
 * This module tests the conversation persistence functionality to ensure it properly
 * handles saving, loading, pruning, and error recovery.
 * 
 * @module ConversationPersistenceTest
 * @author Brett
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../logger');
const logger = createLogger('conversationPersistenceTest');
const conversationStorage = require('../conversationStorage');
const { 
  manageConversation, 
  clearConversation, 
  loadConversationsFromStorage,
  saveConversationsToStorage,
  getConversationStorageStatus
} = require('../conversationManager');

/**
 * Test the conversation persistence functionality
 * 
 * This function tests various aspects of the conversation persistence:
 * - Saving conversations to disk
 * - Loading conversations from disk
 * - Pruning old conversations
 * - Error recovery from corrupted files
 * - Conversation status reporting
 * 
 * @returns {Object} Test results with success/failure status and details
 */
async function testConversationPersistence() {
  logger.info('Starting conversation persistence tests...');
  
  const results = {
    success: true,
    results: []
  };
  
  try {
    // Test 1: Save and load conversations
    logger.info('Test 1: Save and load conversations');
    const test1Result = {
      name: 'Save and load conversations',
      success: false,
      details: {}
    };
    
    try {
      // First, ensure we have a clean state
      await conversationStorage.clearAllConversations();
      
      // Create test conversations
      const testUserId1 = 'test-user-1';
      const testUserId2 = 'test-user-2';
      
      // Clear any existing conversations for these test users
      clearConversation(testUserId1);
      clearConversation(testUserId2);
      
      // Add test messages to conversations with timestamps
      const now = Date.now();
      const conversation1 = [
        { role: 'system', content: 'You are a helpful assistant', timestamp: now },
        { role: 'user', content: 'Hello, bot!', timestamp: now },
        { role: 'assistant', content: 'Hello, human!', timestamp: now }
      ];
      
      const conversation2 = [
        { role: 'system', content: 'You are a helpful assistant', timestamp: now },
        { role: 'user', content: 'How are you?', timestamp: now },
        { role: 'assistant', content: 'I am fine, thank you!', timestamp: now }
      ];
      
      // Manually set the conversations in the map
      const userConversationsMap = new Map();
      userConversationsMap.set(testUserId1, conversation1);
      userConversationsMap.set(testUserId2, conversation2);
      
      // Save conversations to disk directly using the storage module
      const saveResult = await conversationStorage.saveConversations(userConversationsMap);
      
      // Get storage status before loading
      const statusBeforeLoad = getConversationStorageStatus();
      
      // Load conversations from disk directly using the storage module
      const loadedConversationsMap = await conversationStorage.loadConversations();
      
      // Get storage status after loading
      const statusAfterLoad = getConversationStorageStatus();
      
      // Verify the conversations were loaded correctly
      const conversation1Loaded = loadedConversationsMap.has(testUserId1) && 
        loadedConversationsMap.get(testUserId1).some(msg => msg.role === 'user' && msg.content === 'Hello, bot!') &&
        loadedConversationsMap.get(testUserId1).some(msg => msg.role === 'assistant' && msg.content === 'Hello, human!');
      
      const conversation2Loaded = loadedConversationsMap.has(testUserId2) && 
        loadedConversationsMap.get(testUserId2).some(msg => msg.role === 'user' && msg.content === 'How are you?') &&
        loadedConversationsMap.get(testUserId2).some(msg => msg.role === 'assistant' && msg.content === 'I am fine, thank you!');
      
      test1Result.success = saveResult && conversation1Loaded && conversation2Loaded;
      test1Result.details = {
        saveResult,
        conversation1Loaded,
        conversation2Loaded,
        statusBeforeLoad,
        statusAfterLoad,
        loadedUsers: Array.from(loadedConversationsMap.keys())
      };
      
      logger.info({ 
        test: 'Save and load conversations', 
        success: test1Result.success 
      }, 'Test completed');
    } catch (error) {
      test1Result.success = false;
      test1Result.details = {
        error: error.message
      };
      logger.error({ error }, 'Test 1 failed');
    }
    
    results.results.push(test1Result);
    results.success = results.success && test1Result.success;
    
    // Test 2: Pruning old conversations
    logger.info('Test 2: Pruning old conversations');
    const test2Result = {
      name: 'Pruning old conversations',
      success: false,
      details: {}
    };
    
    try {
      // Create a map with conversations of different ages
      const conversationsMap = new Map();
      
      // Current conversation
      conversationsMap.set('current-user', [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello', timestamp: Date.now() }
      ]);
      
      // Old conversation (8 days ago)
      const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);
      conversationsMap.set('old-user', [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Old message', timestamp: eightDaysAgo }
      ]);
      
      // Prune conversations older than 7 days
      const prunedConversations = await conversationStorage.pruneOldConversations(
        conversationsMap,
        7 * 24 * 60 * 60 * 1000 // 7 days
      );
      
      // Verify that only the current conversation remains
      const currentUserExists = prunedConversations.has('current-user');
      const oldUserRemoved = !prunedConversations.has('old-user');
      
      test2Result.success = currentUserExists && oldUserRemoved;
      test2Result.details = {
        originalSize: conversationsMap.size,
        prunedSize: prunedConversations.size,
        currentUserExists,
        oldUserRemoved
      };
      
      logger.info({ 
        test: 'Pruning old conversations', 
        success: test2Result.success 
      }, 'Test completed');
    } catch (error) {
      test2Result.success = false;
      test2Result.details = {
        error: error.message
      };
      logger.error({ error }, 'Test 2 failed');
    }
    
    results.results.push(test2Result);
    results.success = results.success && test2Result.success;
    
    // Test 3: Error recovery from corrupted files
    logger.info('Test 3: Error recovery from corrupted files');
    const test3Result = {
      name: 'Error recovery from corrupted files',
      success: false,
      details: {}
    };
    
    try {
      // Get the path to the conversations file
      const conversationsFile = conversationStorage.getStorageFilePath();
      const backupFile = `${conversationsFile}.backup`;
      
      // Create a valid backup file
      const validData = {
        conversations: {
          'recovery-test-user': [
            { role: 'system', content: 'You are a helpful assistant' },
            { role: 'user', content: 'Recovery test message' }
          ]
        },
        lastUpdated: new Date().toISOString(),
        version: '1.0'
      };
      
      // Write valid data to the backup file
      await fs.promises.writeFile(backupFile, JSON.stringify(validData, null, 2), 'utf8');
      
      // Write corrupted data to the main file
      await fs.promises.writeFile(conversationsFile, '{ "corrupted": "json', 'utf8');
      
      // Try to load conversations (should recover from backup)
      const loadedConversations = await conversationStorage.loadConversations();
      
      // Check if recovery was successful
      const recoverySuccessful = loadedConversations.has('recovery-test-user');
      
      test3Result.success = recoverySuccessful;
      test3Result.details = {
        recoverySuccessful,
        loadedSize: loadedConversations.size
      };
      
      logger.info({ 
        test: 'Error recovery from corrupted files', 
        success: test3Result.success 
      }, 'Test completed');
    } catch (error) {
      test3Result.success = false;
      test3Result.details = {
        error: error.message
      };
      logger.error({ error }, 'Test 3 failed');
    }
    
    results.results.push(test3Result);
    results.success = results.success && test3Result.success;
    
    // Test 4: Conversation status reporting
    logger.info('Test 4: Conversation status reporting');
    const test4Result = {
      name: 'Conversation status reporting',
      success: false,
      details: {}
    };
    
    try {
      // Get conversation storage status
      const status = getConversationStorageStatus();
      
      // Verify that the status contains the expected fields
      const hasActiveConversations = 'activeConversations' in status;
      const hasLoaded = 'loaded' in status;
      const hasDirty = 'dirty' in status;
      const hasSaveInterval = 'saveIntervalMs' in status;
      const hasMaxLength = 'maxConversationLength' in status;
      const hasStorageFile = 'storageFile' in status;
      
      test4Result.success = hasActiveConversations && hasLoaded && hasDirty && 
        hasSaveInterval && hasMaxLength && hasStorageFile;
      test4Result.details = {
        status,
        hasActiveConversations,
        hasLoaded,
        hasDirty,
        hasSaveInterval,
        hasMaxLength,
        hasStorageFile
      };
      
      logger.info({ 
        test: 'Conversation status reporting', 
        success: test4Result.success 
      }, 'Test completed');
    } catch (error) {
      test4Result.success = false;
      test4Result.details = {
        error: error.message
      };
      logger.error({ error }, 'Test 4 failed');
    }
    
    results.results.push(test4Result);
    results.success = results.success && test4Result.success;
    
  } catch (error) {
    logger.error({ error }, 'Unexpected error during conversation persistence tests');
    results.success = false;
    results.error = error.message;
  }
  
  // Log overall results
  if (results.success) {
    logger.info('All conversation persistence tests passed!');
  } else {
    logger.error('Some conversation persistence tests failed!');
  }
  
  return results;
}

// Run tests if this file is executed directly
if (require.main === module) {
  testConversationPersistence()
    .then(results => {
      console.log('Conversation Persistence Test Results:');
      console.log(JSON.stringify(results, null, 2));
      process.exit(results.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Error running conversation persistence tests:', error);
      process.exit(1);
    });
} else {
  // Export for use in other test runners
  module.exports = { testConversationPersistence };
}
