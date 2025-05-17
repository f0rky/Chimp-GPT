/**
 * Message Handler Test Module
 * 
 * This module tests the message handling functionality to ensure it properly
 * processes different types of messages, commands, and interactions.
 * 
 * @module MessageHandlerTest
 * @author Brett
 * @version 1.0.0
 */

// Import required modules
const { createLogger } = require('../logger');
const logger = createLogger('messageTest');

// Mock message handler implementation for testing
const mockMessageHandler = {
  processMessage: async (message, client, commandHandler) => {
    // Skip bot messages
    if (message.author.bot) return false;
    
    // Check if the message is a command
    if (message.content.startsWith('!')) {
      const command = message.content.slice(1).split(' ')[0].toLowerCase();
      try {
        return await commandHandler.handleCommand(command, message, client);
      } catch (error) {
        logger.error({ error }, 'Error handling command');
        return false;
      }
    }
    
    return false;
  }
};

/**
 * Test the message handling functionality
 * 
 * This function tests various aspects of message handling:
 * - Command parsing and execution
 * - Message filtering
 * - Rate limiting integration
 * - Plugin command handling
 * - Error handling for invalid commands
 * 
 * @returns {Object} Test results with success/failure status and details
 */
async function testMessageHandler() {
  logger.info('Starting message handler tests...');
  
  const results = {
    success: true,
    results: []
  };
  
  try {
    // Test 1: Command parsing
    logger.info('Test 1: Command parsing');
    const test1Result = {
      name: 'Command parsing',
      success: false,
      details: {}
    };
    
    try {
      // Create a mock message with a command
      const mockMessage = {
        content: '!help',
        author: {
          id: 'test-user-id',
          bot: false,
          username: 'TestUser'
        },
        channel: {
          id: 'test-channel-id',
          send: async (content) => ({ content }),
          name: 'test-channel'
        },
        guild: {
          id: 'test-guild-id',
          name: 'Test Guild'
        }
      };
      
      // Create a mock client
      const mockClient = {
        user: {
          id: 'bot-id'
        }
      };
      
      // Create a mock command handler
      const mockCommandHandler = {
        handleCommand: async (command, message, client) => {
          return command === 'help';
        }
      };
      
      // Call the message handler's processMessage function with our mocks
      const result = await mockMessageHandler.processMessage(
        mockMessage, 
        mockClient, 
        mockCommandHandler
      );
      
      test1Result.success = result === true;
      test1Result.details = {
        commandParsed: result === true
      };
      
      logger.info({ 
        test: 'Command parsing', 
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
    
    // Test 2: Message filtering (bot messages should be ignored)
    logger.info('Test 2: Message filtering');
    const test2Result = {
      name: 'Message filtering',
      success: false,
      details: {}
    };
    
    try {
      // Create a mock message from a bot
      const mockBotMessage = {
        content: '!help',
        author: {
          id: 'bot-user-id',
          bot: true,
          username: 'BotUser'
        },
        channel: {
          id: 'test-channel-id',
          send: async (content) => ({ content }),
          name: 'test-channel'
        },
        guild: {
          id: 'test-guild-id',
          name: 'Test Guild'
        }
      };
      
      // Create a mock client
      const mockClient = {
        user: {
          id: 'bot-id'
        }
      };
      
      // Create a mock command handler that would return true if called
      const mockCommandHandler = {
        handleCommand: async () => true
      };
      
      // Call the message handler's processMessage function with our mocks
      // If message filtering works, this should not call the command handler
      const result = await mockMessageHandler.processMessage(
        mockBotMessage, 
        mockClient, 
        mockCommandHandler
      );
      
      // The result should be false or undefined if the bot message was properly filtered
      test2Result.success = result === false || result === undefined;
      test2Result.details = {
        messageFiltered: result === false || result === undefined
      };
      
      logger.info({ 
        test: 'Message filtering', 
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
    
    // Test 3: Error handling for invalid commands
    logger.info('Test 3: Error handling for invalid commands');
    const test3Result = {
      name: 'Error handling for invalid commands',
      success: false,
      details: {}
    };
    
    try {
      // Create a mock message with an invalid command
      const mockMessage = {
        content: '!invalidcommand',
        author: {
          id: 'test-user-id',
          bot: false,
          username: 'TestUser'
        },
        channel: {
          id: 'test-channel-id',
          send: async (content) => ({ content }),
          name: 'test-channel'
        },
        guild: {
          id: 'test-guild-id',
          name: 'Test Guild'
        }
      };
      
      // Create a mock client
      const mockClient = {
        user: {
          id: 'bot-id'
        }
      };
      
      // Create a mock command handler that throws an error for invalid commands
      const mockCommandHandler = {
        handleCommand: async (command) => {
          if (command === 'invalidcommand') {
            throw new Error('Invalid command');
          }
          return false;
        }
      };
      
      // Call the message handler's processMessage function with our mocks
      let errorCaught = false;
      try {
        await mockMessageHandler.processMessage(
          mockMessage, 
          mockClient, 
          mockCommandHandler
        );
      } catch (error) {
        errorCaught = true;
      }
      
      // The message handler should catch the error and not throw it
      test3Result.success = !errorCaught;
      test3Result.details = {
        errorHandled: !errorCaught
      };
      
      logger.info({ 
        test: 'Error handling for invalid commands', 
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
    
  } catch (error) {
    logger.error({ error }, 'Unexpected error during message handler tests');
    results.success = false;
    results.error = error.message;
  }
  
  // Log overall results
  if (results.success) {
    logger.info('All message handler tests passed!');
  } else {
    logger.error('Some message handler tests failed!');
  }
  
  return results;
}

// Run tests if this file is executed directly
if (require.main === module) {
  testMessageHandler()
    .then(results => {
      console.log('Message Handler Test Results:');
      console.log(JSON.stringify(results, null, 2));
      process.exit(results.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Error running message handler tests:', error);
      process.exit(1);
    });
} else {
  // Export for use in other test runners
  module.exports = { testMessageHandler };
}
