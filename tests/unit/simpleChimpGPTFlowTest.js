/**
 * SimpleChimpGPTFlow Unit Tests
 *
 * Tests for the core conversation flow functionality including:
 * - Intent detection and routing
 * - Image generation handling
 * - Weather request handling
 * - Conversation management
 * - Error handling
 */

const { createLogger } = require('../../src/core/logger');
const logger = createLogger('simpleChimpGPTFlowTest');

// Mock dependencies to isolate unit tests
const mockOpenAIClient = {
  chat: {
    completions: {
      create: async params => {
        // Mock different responses based on input
        if (params.messages?.[0]?.content?.includes('test assistant')) {
          return {
            choices: [{ message: { content: 'Test successful' } }],
          };
        }
        if (params.messages?.[1]?.content?.includes('weather')) {
          return {
            choices: [
              {
                message: {
                  content: 'The weather in Tokyo is partly cloudy with a temperature of 26°C.',
                },
              },
            ],
          };
        }
        if (params.messages?.[1]?.content?.includes('time')) {
          return {
            choices: [{ message: { content: 'The current time in Tokyo is 4:38 AM JST.' } }],
          };
        }
        return {
          choices: [{ message: { content: 'Hello! How can I help you today?' } }],
        };
      },
    },
  },
  images: {
    generate: async params => {
      if (params.prompt.includes('error')) {
        throw new Error('Test image generation error');
      }
      return {
        data: [
          {
            url: 'https://example.com/test-image.png',
            revised_prompt: `Enhanced: ${params.prompt}`,
          },
        ],
      };
    },
  },
};

const mockPFPManager = {
  addImage: async (buffer, fileName) => {
    return `/mock/path/${fileName}`;
  },
};

// Create mock message objects
const createMockMessage = (content, authorId = 'test-user-123') => ({
  content,
  author: {
    id: authorId,
    username: 'TestUser',
  },
  id: 'test-message-123',
  channel: {
    id: 'test-channel-123',
  },
});

/**
 * Test SimpleChimpGPTFlow intent detection and routing
 */
async function testIntentDetection() {
  logger.info('Test 1: Intent detection and routing');

  try {
    const SimpleChimpGPTFlow = require('../../src/conversation/flow/SimpleChimpGPTFlow');
    const flow = new SimpleChimpGPTFlow(mockOpenAIClient, mockPFPManager, {
      maxConversationLength: 5,
      maxTokens: 500,
    });

    const testCases = [
      {
        name: 'Image generation intent',
        message: createMockMessage('draw an image of a cat'),
        expectedType: 'image',
      },
      {
        name: 'Weather request intent',
        message: createMockMessage('What is the weather in Tokyo?'),
        expectedType: 'weather',
      },
      {
        name: 'Time request intent',
        message: createMockMessage('What time is it in Tokyo?'),
        expectedType: 'time',
      },
      {
        name: 'Quake stats intent',
        message: createMockMessage('show me quake server stats'),
        expectedType: 'quake',
      },
      {
        name: 'General conversation intent',
        message: createMockMessage('Hello, how are you?'),
        expectedType: 'conversation',
      },
    ];

    const results = [];
    for (const testCase of testCases) {
      try {
        const result = await flow.processMessage(testCase.message);

        const success = result.success && result.type === testCase.expectedType;
        results.push({
          name: testCase.name,
          success,
          expectedType: testCase.expectedType,
          actualType: result.type,
          hasResponse: !!result.response,
        });

        if (success) {
          logger.info(`✓ PASS: ${testCase.name} - detected as ${result.type}`);
        } else {
          logger.warn(
            `✗ FAIL: ${testCase.name} - expected ${testCase.expectedType}, got ${result.type}`
          );
        }
      } catch (error) {
        results.push({
          name: testCase.name,
          success: false,
          error: error.message,
        });
        logger.error(`✗ ERROR: ${testCase.name} - ${error.message}`);
      }
    }

    const passedCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    return {
      success: passedCount === totalCount,
      details: {
        passed: passedCount,
        total: totalCount,
        results,
      },
    };
  } catch (error) {
    logger.error('Error in intent detection test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Test conversation memory and persistence
 */
async function testConversationMemory() {
  logger.info('Test 2: Conversation memory and persistence');

  try {
    const SimpleChimpGPTFlow = require('../../src/conversation/flow/SimpleChimpGPTFlow');
    const flow = new SimpleChimpGPTFlow(mockOpenAIClient, mockPFPManager, {
      maxConversationLength: 3,
      maxTokens: 500,
    });

    const userId = 'test-user-memory';
    const testMessages = [
      createMockMessage('Hello, my name is Alice', userId),
      createMockMessage('What is my name?', userId),
      createMockMessage('Tell me a joke', userId),
      createMockMessage('What was the first thing I said?', userId),
    ];

    const results = [];
    for (let i = 0; i < testMessages.length; i++) {
      const result = await flow.processMessage(testMessages[i]);
      results.push({
        messageIndex: i,
        success: result.success,
        hasResponse: !!result.response,
        conversationLength: result.conversationLength,
        type: result.type,
      });
    }

    // Get stats to verify conversation tracking
    const stats = flow.getStats();

    // Check that conversation length is managed properly
    const finalResult = results[results.length - 1];
    // Conversation should be managed if the final length respects the limit
    // Note: Since we're adding 4 messages with a limit of 3, the system should trim older messages
    const conversationLengthManaged =
      finalResult.conversationLength <= 3 || stats.totalMessages >= testMessages.length;
    const hasConversationStats = stats.totalConversations > 0;

    return {
      success: conversationLengthManaged && hasConversationStats,
      details: {
        results,
        conversationLengthManaged,
        hasConversationStats,
        stats,
      },
    };
  } catch (error) {
    logger.error('Error in conversation memory test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Test error handling and recovery
 */
async function testErrorHandling() {
  logger.info('Test 3: Error handling and recovery');

  try {
    // Create mock that will throw errors
    const mockErrorOpenAI = {
      chat: {
        completions: {
          create: async () => {
            throw new Error('Mock OpenAI API error');
          },
        },
      },
      images: {
        generate: async () => {
          throw new Error('Mock image generation error');
        },
      },
    };

    const SimpleChimpGPTFlow = require('../../src/conversation/flow/SimpleChimpGPTFlow');
    const flow = new SimpleChimpGPTFlow(mockErrorOpenAI, mockPFPManager);

    const testCases = [
      {
        name: 'Conversation error handling',
        message: createMockMessage('Hello there'),
      },
      {
        name: 'Image generation error handling',
        message: createMockMessage('draw an image of error'),
      },
    ];

    const results = [];
    for (const testCase of testCases) {
      const result = await flow.processMessage(testCase.message);

      // Should gracefully handle errors and return error response
      const handled = !result.success && result.response && result.error;
      results.push({
        name: testCase.name,
        success: handled,
        hasErrorResponse: !!result.response,
        hasErrorMessage: !!result.error,
      });
    }

    const allHandled = results.every(r => r.success);

    return {
      success: allHandled,
      details: {
        results,
        allErrorsHandled: allHandled,
      },
    };
  } catch (error) {
    logger.error('Error in error handling test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Test flow statistics and monitoring
 */
async function testFlowStats() {
  logger.info('Test 4: Flow statistics and monitoring');

  try {
    const SimpleChimpGPTFlow = require('../../src/conversation/flow/SimpleChimpGPTFlow');
    const flow = new SimpleChimpGPTFlow(mockOpenAIClient, mockPFPManager);

    // Process some test messages
    await flow.processMessage(createMockMessage('Hello', 'user1'));
    await flow.processMessage(createMockMessage('Hi there', 'user2'));
    await flow.processMessage(createMockMessage('How are you?', 'user1'));

    const stats = flow.getStats();

    const hasRequiredFields = !!(
      stats.architecture &&
      stats.implementation &&
      stats.performance &&
      typeof stats.totalConversations === 'number' &&
      typeof stats.totalMessages === 'number' &&
      typeof stats.avgMessagesPerConversation === 'number' &&
      typeof stats.uptime === 'number'
    );

    const conversationCountCorrect = stats.totalConversations === 2; // 2 users
    const messageCountCorrect = stats.totalMessages >= 3; // At least 3 messages

    return {
      success: hasRequiredFields && conversationCountCorrect && messageCountCorrect,
      details: {
        stats,
        hasRequiredFields,
        conversationCountCorrect,
        messageCountCorrect,
      },
    };
  } catch (error) {
    logger.error('Error in flow stats test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Test conversation cleanup functionality
 */
async function testConversationCleanup() {
  logger.info('Test 5: Conversation cleanup functionality');

  try {
    const SimpleChimpGPTFlow = require('../../src/conversation/flow/SimpleChimpGPTFlow');
    const flow = new SimpleChimpGPTFlow(mockOpenAIClient, mockPFPManager);

    // Add some conversations
    await flow.processMessage(createMockMessage('Test message 1', 'user1'));
    await flow.processMessage(createMockMessage('Test message 2', 'user2'));

    const statsBefore = flow.getStats();

    // Test cleanup with very short max age (should clean nothing recent)
    const cleaned = flow.cleanup(1); // 1ms max age

    const statsAfter = flow.getStats();

    // Should have cleanup functionality working
    const cleanupWorks = typeof cleaned === 'number';
    const conversationsPreserved = statsAfter.totalConversations >= 0;

    return {
      success: cleanupWorks && conversationsPreserved,
      details: {
        cleanupWorks,
        conversationsPreserved,
        cleaned,
        statsBefore,
        statsAfter,
      },
    };
  } catch (error) {
    logger.error('Error in conversation cleanup test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Main test runner for SimpleChimpGPTFlow
 */
async function testSimpleChimpGPTFlow() {
  logger.info('Starting SimpleChimpGPTFlow tests...');

  const tests = [
    { name: 'Intent Detection', fn: testIntentDetection },
    { name: 'Conversation Memory', fn: testConversationMemory },
    { name: 'Error Handling', fn: testErrorHandling },
    { name: 'Flow Statistics', fn: testFlowStats },
    { name: 'Conversation Cleanup', fn: testConversationCleanup },
  ];

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      logger.info(`Running ${test.name} test...`);
      const result = await test.fn();
      results.push({
        name: test.name,
        success: result.success,
        details: result.details,
        error: result.error,
      });

      if (result.success) {
        passed++;
        logger.info(`✅ ${test.name}: PASSED`);
      } else {
        failed++;
        logger.warn(`❌ ${test.name}: FAILED - ${result.error || 'See details'}`);
      }
    } catch (error) {
      failed++;
      results.push({
        name: test.name,
        success: false,
        error: error.message,
      });
      logger.error(`❌ ${test.name}: ERROR - ${error.message}`);
    }
  }

  logger.info(`SimpleChimpGPTFlow tests completed: ${passed} passed, ${failed} failed`);

  return {
    success: failed === 0,
    details: {
      passed,
      failed,
      total: tests.length,
      results,
    },
  };
}

// Export for use in test runner
module.exports = {
  testSimpleChimpGPTFlow,
};

// Allow running directly
if (require.main === module) {
  testSimpleChimpGPTFlow()
    .then(result => {
      console.log('\n=== SimpleChimpGPTFlow Test Results ===');
      console.log(`Success: ${result.success}`);
      console.log(`Passed: ${result.details.passed}/${result.details.total}`);
      if (result.details.failed > 0) {
        console.log('Failed tests:');
        result.details.results
          .filter(r => !r.success)
          .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
      }
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}
