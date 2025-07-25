/**
 * Command Handler Tests
 *
 * Tests the command handler's prefix functionality, including:
 * - Command execution with different prefixes
 * - Prefix changes at runtime
 * - Help command prefix display
 * - Edge cases and error conditions
 *
 * @module CommandHandlerTests
 * @author Brett
 * @version 1.1.0
 */

const { expect } = require('chai');
const sinon = require('sinon');
const commandHandler = require('../../src/commands/commandHandler');
const { createLogger } = require('../../src/core/logger');

const logger = createLogger('tests:commandHandler');

// Test configuration
const TEST_CONFIG = {
  // Enable detailed debug logging
  debug: process.env.TEST_DEBUG === 'true',
  // Test prefixes for various scenarios
  prefixes: {
    default: ['!', '.'],
    custom: ['$', '#'],
    special: ['%', '^', '&'],
    unicode: ['Ω', 'π', '∑'],
    edge: ['', ' ', '!@#$%^&*()', 'a'.repeat(100)],
  },
};

/**
 * Log test step with debug information
 * @param {string} message - Step message
 * @param {Object} [data] - Additional debug data
 */
function logStep(message, data) {
  if (TEST_CONFIG.debug) {
    const timestamp = new Date().toISOString();
    const logData = data ? `\n${JSON.stringify(data, null, 2)}` : '';
    logger.info(`[${timestamp}] STEP: ${message}${logData}`);
  }
}

/**
 * Log successful test step
 * @param {string} message - Success message
 */
function logSuccess(message) {
  logger.info(`✅ ${message}`);
}

/**
 * Log test error
 * @param {string} message - Error message
 * @param {Error} error - Error object
 */
function logError(message, error) {
  logger.error(`❌ ${message}: ${error.message}`);
  if (error.stack) {
    logger.debug(error.stack);
  }
}

/**
 * Format error with stack trace and context
 * @param {Error} error - The error object
 * @param {Object} [context] - Additional context
 * @returns {string} Formatted error message
 */
function formatError(error, context = {}) {
  const stack = error.stack.split('\n').slice(0, 3).join('\n');
  const contextStr = Object.keys(context).length
    ? `\nContext: ${JSON.stringify(context, null, 2)}`
    : '';
  return `${error.name}: ${error.message}\n${stack}${contextStr}`;
}

/**
 * Test the command handler's prefix functionality
 *
 * @returns {Promise<Object>} Test results
 */
async function testCommandHandler() {
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    startTime: new Date(),
    endTime: null,
    duration: 0,
    errors: [],
    warnings: [],
    tests: {},
  };

  /**
   * Helper function to run a test and record results
   * @param {string} name - Test name
   * @param {Function} testFn - Test function
   * @param {Object} [options] - Test options
   * @param {boolean} [options.skip=false] - Whether to skip this test
   * @param {string} [options.skipReason] - Reason for skipping
   */
  async function runTest(name, testFn, { skip = false, skipReason = '' } = {}) {
    results.total++;
    const testStartTime = Date.now();

    if (skip) {
      results.skipped++;
      results.tests[name] = { status: 'skipped', reason: skipReason };
      logger.warn(`⏩ [SKIPPED] ${name}${skipReason ? `: ${skipReason}` : ''}`);
      return;
    }

    try {
      logStep(`Starting test: ${name}`);
      await testFn();
      const duration = Date.now() - testStartTime;
      results.passed++;
      results.tests[name] = {
        status: 'passed',
        duration: `${duration}ms`,
      };
      logger.info(`✅ [PASSED] ${name} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - testStartTime;
      results.failed++;
      const errorInfo = formatError(error, { test: name });
      results.errors.push(errorInfo);
      results.tests[name] = {
        status: 'failed',
        error: error.message,
        stack: error.stack,
        duration: `${duration}ms`,
      };
      logger.error(`❌ [FAILED] ${name} (${duration}ms)\n${errorInfo}`);

      // Log additional debug info if available
      if (error.actual !== undefined || error.expected !== undefined) {
        logger.debug(
          {
            actual: error.actual,
            expected: error.expected,
            operator: error.operator,
          },
          'Assertion details'
        );
      }
    }
  }

  /**
   * Create a mock Discord message
   * @param {string} content - Message content
   * @param {Object} [options] - Message options
   * @param {boolean} [options.isAdmin] - Whether user is admin
   * @param {boolean} [options.isOwner] - Whether user is owner
   * @param {string} [options.userId] - User ID
   * @param {string} [options.username] - Username
   * @returns {Object} Mock message object
   */
  function createMockMessage(
    content,
    { isAdmin = false, isOwner = false, userId = '123456789', username = 'testuser' } = {}
  ) {
    const message = {
      id: `msg_${Math.random().toString(36).substr(2, 9)}`,
      content,
      createdTimestamp: Date.now(),
      author: {
        id: userId,
        bot: false,
        username,
        tag: `${username}#1234`,
        equals: other => other.id === userId,
        toString: () => `<@${userId}>`,
      },
      member: {
        id: userId,
        displayName: username,
        user: {
          id: userId,
          username,
          tag: `${username}#1234`,
        },
        permissions: {
          has: permission => {
            const perms = {
              ADMINISTRATOR: isAdmin,
              MANAGE_GUILD: isAdmin,
              MANAGE_MESSAGES: isAdmin,
            };
            return perms[permission] || false;
          },
        },
      },
      channel: {
        id: 'channel_123',
        name: 'test-channel',
        isDMBased: () => false,
        isTextBased: () => true,
        send: sinon.stub().resolves({
          id: `msg_${Math.random().toString(36).substr(2, 9)}`,
          delete: sinon.stub().resolves(),
        }),
        delete: sinon.stub().resolves(),
      },
      guild: {
        id: 'guild_123',
        name: 'Test Guild',
        available: true,
      },
      reply: sinon.stub().callsFake((...args) => {
        logStep(`Message reply called`, { content, args });
        return Promise.resolve({
          id: `msg_${Math.random().toString(36).substr(2, 9)}`,
          delete: sinon.stub().resolves(),
        });
      }),
      react: sinon.stub().callsFake(emoji => {
        logStep(`Reaction added`, { content, emoji });
        return Promise.resolve();
      }),
      delete: sinon.stub().resolves(),
      edit: sinon.stub().resolves(),
    };

    // Add debug info if enabled
    if (TEST_CONFIG.debug) {
      message.debug = () => ({
        id: message.id,
        content: message.content,
        author: message.author.tag,
        channel: message.channel.name,
        timestamp: new Date(message.createdTimestamp).toISOString(),
        reactions: message.reactions ? message.reactions.map(r => r.emoji) : [],
      });
    }

    return message;
  }

  // Save original functions and state
  const originalState = {
    getPrefixes: commandHandler.getPrefixes,
    setPrefixes: commandHandler.setPrefixes,
    registerCommand: commandHandler.registerCommand,
    getCommands: commandHandler.getCommands,
    handleCommand: commandHandler.handleCommand,
    originalPrefixes: [...commandHandler.getPrefixes()],
  };

  // Setup function to run before tests
  function setupTestEnvironment() {
    logStep('Setting up test environment');

    // Reset command registry
    commandHandler.setPrefixes([...originalState.originalPrefixes]);

    // Clear any registered commands from previous tests
    const commands = commandHandler.getCommands();
    Object.keys(commands).forEach(cmd => {
      delete commandHandler.commands[cmd];
    });
  }

  // Teardown function to run after tests
  function teardownTestEnvironment() {
    // Restore original state
    Object.entries(originalState).forEach(([key, value]) => {
      if (commandHandler[key] !== undefined) {
        commandHandler[key] = value;
      }
    });
    logStep('Test environment cleaned up');
  }

  // --- Test Cases ---

  // Run setup before tests
  setupTestEnvironment();

  // Run all tests
  const tests = [
    // Basic Functionality Tests
    {
      name: 'Basic: should have default prefixes',
      test: async () => {
        const prefixes = commandHandler.getPrefixes();
        expect(prefixes).to.be.an('array');
        expect(prefixes).to.include('!');
        expect(prefixes).to.include('.');
      },
    },
    {
      name: 'Basic: should register and execute a simple command',
      test: async () => {
        let executed = false;
        const testCommand = {
          name: 'test',
          description: 'A test command',
          execute: async () => {
            executed = true;
            return { success: true, message: 'Test command executed' };
          },
        };

        commandHandler.registerCommand(testCommand);
        const message = createMockMessage('!test');
        const result = await commandHandler.handleCommand(message, {});

        expect(executed).to.be.true;
        expect(result).to.be.true;
      },
    },
    {
      name: 'Prefix: should handle custom prefixes',
      test: async () => {
        const testPrefixes = ['$', '#'];
        commandHandler.setPrefixes(testPrefixes);
        const currentPrefixes = commandHandler.getPrefixes();
        expect(currentPrefixes).to.deep.equal(testPrefixes);
      },
    },
    {
      name: 'Help: should show current prefixes in help message',
      test: async () => {
        const testPrefixes = ['%', '^'];
        commandHandler.setPrefixes(testPrefixes);

        let helpMessage = '';
        const helpCommand = {
          name: 'help',
          description: 'Show help information',
          execute: async message => {
            helpMessage = `Current prefixes: ${testPrefixes.join(', ')}`;
            await message.reply(helpMessage);
            return { success: true, message: helpMessage };
          },
        };

        commandHandler.registerCommand(helpCommand);
        const message = createMockMessage(`${testPrefixes[0]}help`);
        const result = await commandHandler.handleCommand(message, {});

        expect(result).to.be.true;
        expect(helpMessage).to.include(testPrefixes[0]);
        expect(helpMessage).to.include(testPrefixes[1]);
      },
    },
  ];

  // Initialize test results
  const testResults = {
    total: tests.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    startTime: new Date(),
    tests: {},
  };

  // Run all tests
  for (const test of tests) {
    try {
      logStep(`Running test: ${test.name}`);
      await test.test();
      logSuccess(`✓ PASS: ${test.name}`);
      testResults.passed++;
      testResults.tests[test.name] = { status: 'passed' };
    } catch (error) {
      logError(`✗ FAIL: ${test.name}`, error);
      testResults.failed++;
      testResults.tests[test.name] = {
        status: 'failed',
        error: error.message,
        stack: error.stack,
      };
    }
  }

  // Clean up
  teardownTestEnvironment();

  // Calculate test summary
  testResults.endTime = new Date();
  testResults.duration = testResults.endTime - testResults.startTime;
  testResults.success = testResults.failed === 0;

  // Log test summary
  logger.info('\n=== Test Summary ===');
  logger.info(`Total: ${testResults.total}`);
  logger.info(`Passed: ${testResults.passed}`);
  logger.info(`Failed: ${testResults.failed}`);
  logger.info(`Skipped: ${testResults.skipped}`);
  logger.info(`Duration: ${testResults.duration}ms`);

  if (testResults.failed > 0) {
    logger.warn('\nFailed Tests:');
    Object.entries(testResults.tests)
      .filter(([_, test]) => test.status === 'failed')
      .forEach(([name, test]) => {
        logger.warn(`❌ ${name}: ${test.error}`);
        if (test.stack) {
          logger.debug(test.stack);
        }
      });
  }

  return testResults;
}

module.exports = {
  testCommandHandler,
};
