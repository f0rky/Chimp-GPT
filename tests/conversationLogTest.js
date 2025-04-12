/**
 * Conversation Log Test Module
 * 
 * This module tests the conversation log management system to ensure
 * it properly maintains conversation context, handles message limits,
 * and preserves system messages.
 * 
 * @module ConversationLogTest
 * @author Brett
 * @version 1.0.0
 */

// Import required modules
const config = require('../configValidator');
const { manageConversation, userConversations, MAX_CONVERSATION_LENGTH } = require('../conversationManager');

/**
 * Test the conversation log management system
 * 
 * This function tests various aspects of the conversation log:
 * - Initialization with system message
 * - Adding user and assistant messages
 * - Length management (removing oldest messages)
 * - Context preservation across multiple exchanges
 * 
 * @returns {Object} Test results with success/failure status
 */
function testConversationLog() {
  console.log('Starting conversation log tests...');
  
  // Create a mock user ID
  const testUserId = 'test-user-123';
  
  // Clear any existing conversation for this test user
  userConversations.delete(testUserId);
  
  // Test 1: Initialize conversation
  console.log('Test 1: Initialize conversation');
  const initialLog = manageConversation(testUserId);
  const test1 = initialLog.length === 1 && 
                initialLog[0].role === 'system' && 
                initialLog[0].content === config.BOT_PERSONALITY;
  console.log(`  Result: ${test1 ? 'PASS' : 'FAIL'}`);
  if (!test1) {
    console.log(`  Expected: system message with content "${config.BOT_PERSONALITY}"`);
    console.log(`  Actual: ${JSON.stringify(initialLog)}`);
  }
  
  // Test 2: Add user message
  console.log('Test 2: Add user message');
  const userMsg = { role: 'user', content: 'Test message' };
  const logWithUser = manageConversation(testUserId, userMsg);
  const test2 = logWithUser.length === 2 && 
                logWithUser[1].role === 'user' && 
                logWithUser[1].content === 'Test message';
  console.log(`  Result: ${test2 ? 'PASS' : 'FAIL'}`);
  if (!test2) {
    console.log(`  Expected: log with 2 messages, last one being user message`);
    console.log(`  Actual: ${JSON.stringify(logWithUser)}`);
  }
  
  // Test 3: Add assistant message
  console.log('Test 3: Add assistant message');
  const assistantMsg = { role: 'assistant', content: 'Test response' };
  const logWithAssistant = manageConversation(testUserId, assistantMsg);
  const test3 = logWithAssistant.length === 3 && 
                logWithAssistant[2].role === 'assistant' && 
                logWithAssistant[2].content === 'Test response';
  console.log(`  Result: ${test3 ? 'PASS' : 'FAIL'}`);
  if (!test3) {
    console.log(`  Expected: log with 3 messages, last one being assistant message`);
    console.log(`  Actual: ${JSON.stringify(logWithAssistant)}`);
  }
  
  // Test 4: Length management (add enough messages to exceed MAX_CONVERSATION_LENGTH)
  console.log(`Test 4: Length management (max length: ${MAX_CONVERSATION_LENGTH})`);
  for (let i = 0; i < MAX_CONVERSATION_LENGTH + 2; i++) {
    manageConversation(testUserId, { 
      role: i % 2 === 0 ? 'user' : 'assistant', 
      content: `Message ${i}` 
    });
  }
  
  const finalLog = manageConversation(testUserId);
  const test4 = finalLog.length === MAX_CONVERSATION_LENGTH;
  console.log(`  Result: ${test4 ? 'PASS' : 'FAIL'}`);
  if (!test4) {
    console.log(`  Expected: log with ${MAX_CONVERSATION_LENGTH} messages`);
    console.log(`  Actual: ${finalLog.length} messages`);
  }
  
  // Test 5: Verify system message is preserved (should always be at index 0)
  console.log('Test 5: System message preservation');
  const test5 = finalLog[0].role === 'system' && 
                finalLog[0].content === config.BOT_PERSONALITY;
  console.log(`  Result: ${test5 ? 'PASS' : 'FAIL'}`);
  if (!test5) {
    console.log(`  Expected: system message at index 0`);
    console.log(`  Actual: ${JSON.stringify(finalLog[0])}`);
  }
  
  // Test 6: Verify oldest non-system messages are removed first
  console.log('Test 6: Oldest message removal order');
  // Check that the second message is not the original test message
  const test6 = finalLog[1].content !== 'Test message';
  console.log(`  Result: ${test6 ? 'PASS' : 'FAIL'}`);
  if (!test6) {
    console.log(`  Expected: original test message to be removed`);
    console.log(`  Actual: ${JSON.stringify(finalLog[1])}`);
  }
  
  // Test 7: System message recovery if accidentally removed
  console.log('Test 7: System message recovery');
  // Create a conversation without a system message
  userConversations.delete(testUserId);
  userConversations.set(testUserId, [
    { role: 'user', content: 'First message' },
    { role: 'assistant', content: 'First response' }
  ]);
  
  // Add a new message which should trigger system message recovery
  const recoveredLog = manageConversation(testUserId, { role: 'user', content: 'New message' });
  
  // Check that system message was restored at index 0
  const test7 = recoveredLog[0].role === 'system' && 
                recoveredLog[0].content === config.BOT_PERSONALITY;
  console.log(`  Result: ${test7 ? 'PASS' : 'FAIL'}`);
  if (!test7) {
    console.log(`  Expected: system message at index 0`);
    console.log(`  Actual: ${JSON.stringify(recoveredLog[0])}`);
  }
  
  // Clean up
  userConversations.delete(testUserId);
  
  const allTestsPassed = test1 && test2 && test3 && test4 && test5 && test6 && test7;
  
  console.log(`\nTest Summary: ${allTestsPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  
  return {
    success: allTestsPassed,
    results: {
      initialization: test1,
      addUserMessage: test2,
      addAssistantMessage: test3,
      lengthManagement: test4,
      systemMessagePreservation: test5,
      messageRemovalOrder: test6
    }
  };
}

// Run tests if this file is executed directly
if (require.main === module) {
  testConversationLog();
}

module.exports = {
  testConversationLog
};
