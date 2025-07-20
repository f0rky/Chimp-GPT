const PocketFlowConversationManager = require('../../src/conversation/flow/PocketFlowConversationManager');

// Mock implementations
const mockOpenAIClient = {
  chat: {
    completions: {
      create: async params => {
        return {
          choices: [
            {
              message: {
                content: 'This is a mock response',
              },
              finish_reason: 'stop',
            },
          ],
        };
      },
    },
  },
};

const mockFunctionCallProcessor = {
  processFunction: async ({ functionName, functionArgs }) => {
    return {
      success: true,
      result: `Mock result for ${functionName}`,
    };
  },
};

const mockCommandHandler = {
  executeCommand: async (commandName, context) => {
    return {
      response: `Mock command response for ${commandName}`,
    };
  },
};

const createTestMessage = content => ({
  id: `msg-${Date.now()}`,
  content: content,
  createdTimestamp: Date.now(),
  author: {
    id: 'test-user',
    username: 'TestUser',
    displayName: 'Test User',
  },
  channel: {
    id: 'test-channel',
    type: 'GUILD_TEXT',
  },
});

async function runSimpleTest() {
  console.log('🧪 Running simple PocketFlow test...');

  const manager = new PocketFlowConversationManager(
    mockOpenAIClient,
    mockFunctionCallProcessor,
    mockCommandHandler,
    { flows: { individual: { logLevel: 'info' } } }
  );

  try {
    const message = createTestMessage('Hello bot!');
    const result = await manager.processMessage(message);

    console.log('✅ Test result:', {
      success: result.success,
      flowType: result.flowType,
      hasResponse: !!result.result?.response,
      executionTime: result.executionTime,
    });

    if (!result.success) {
      console.error('❌ Test failed:', result.error);
    }

    await manager.shutdown();
    return result.success;
  } catch (error) {
    console.error('❌ Test threw error:', error.message);
    await manager.shutdown();
    return false;
  }
}

if (require.main === module) {
  runSimpleTest()
    .then(success => {
      console.log(success ? '✨ Simple test passed!' : '💥 Simple test failed!');
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Test suite error:', error);
      process.exit(1);
    });
}

module.exports = runSimpleTest;
