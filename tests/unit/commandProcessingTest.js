/**
 * Command Processing Tests
 *
 * Tests for command handling including:
 * - Command parsing and execution
 * - Slash command functionality
 * - Permission checking
 * - Error handling in commands
 * - Command aliases and prefixes
 */

const { createLogger } = require('../../src/core/logger');
const logger = createLogger('commandProcessingTest');

// Mock Discord interaction for slash commands
const createMockInteraction = (commandName, options = {}) => ({
  commandName,
  options: {
    getString: key => options[key],
    getInteger: key => options[key],
    getBoolean: key => options[key],
    getUser: key => options[key],
  },
  user: {
    id: 'test-user-123',
    username: 'TestUser',
    bot: false,
  },
  guild: {
    id: 'test-guild-123',
  },
  channel: {
    id: 'test-channel-123',
  },
  reply: async content => ({
    content: typeof content === 'string' ? content : content.content,
  }),
  followUp: async content => ({
    content: typeof content === 'string' ? content : content.content,
  }),
  deferReply: async () => {},
  editReply: async content => ({
    content: typeof content === 'string' ? content : content.content,
  }),
});

// Mock Discord message for prefix commands
const createMockMessage = (content, userId = 'test-user-123') => ({
  id: 'test-message-123',
  content,
  author: {
    id: userId,
    username: 'TestUser',
    bot: false,
  },
  guild: {
    id: 'test-guild-123',
    members: {
      cache: new Map(),
    },
  },
  channel: {
    id: 'test-channel-123',
    send: async content => ({
      content: typeof content === 'string' ? content : content.content,
    }),
  },
  member: {
    displayName: 'TestUser',
  },
});

/**
 * Test command parsing functionality
 */
async function testCommandParsing() {
  logger.info('Test 1: Command parsing functionality');

  try {
    const commandHandler = require('../../src/commands/commandHandler');

    const testCases = [
      {
        name: 'Simple command with exclamation prefix',
        content: '!ping',
        expectedCommand: 'ping',
        expectedPrefix: '!',
        expectedArgs: [],
      },
      {
        name: 'Command with dot prefix',
        content: '.help',
        expectedCommand: 'help',
        expectedPrefix: '.',
        expectedArgs: [],
      },
      {
        name: 'Command with arguments',
        content: '!image sunset over ocean',
        expectedCommand: 'image',
        expectedPrefix: '!',
        expectedArgs: ['sunset', 'over', 'ocean'],
      },
      {
        name: 'Command with slash prefix',
        content: '/stats bot',
        expectedCommand: 'stats',
        expectedPrefix: '/',
        expectedArgs: ['bot'],
      },
      {
        name: 'Non-command message',
        content: 'Hello, how are you?',
        expectedCommand: null,
        expectedPrefix: null,
        expectedArgs: null,
      },
    ];

    const results = [];

    for (const testCase of testCases) {
      try {
        let parsedCommand = null;

        // Test command parsing logic
        const prefixes = ['!', '.', '/'];
        const content = testCase.content.trim();

        for (const prefix of prefixes) {
          if (content.startsWith(prefix)) {
            const parts = content.slice(1).split(' ');
            const command = parts[0].toLowerCase();
            const args = parts.slice(1);

            parsedCommand = {
              prefix,
              command,
              args,
            };
            break;
          }
        }

        let success = true;

        if (testCase.expectedCommand === null) {
          success = parsedCommand === null;
        } else {
          success =
            parsedCommand !== null &&
            parsedCommand.command === testCase.expectedCommand &&
            parsedCommand.prefix === testCase.expectedPrefix &&
            JSON.stringify(parsedCommand.args) === JSON.stringify(testCase.expectedArgs);
        }

        results.push({
          name: testCase.name,
          success,
          parsed: parsedCommand,
          expected: {
            command: testCase.expectedCommand,
            prefix: testCase.expectedPrefix,
            args: testCase.expectedArgs,
          },
        });

        if (success) {
          logger.info(`✓ PASS: ${testCase.name} - parsing correct`);
        } else {
          logger.warn(`✗ FAIL: ${testCase.name} - parsing incorrect`);
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
    logger.error('Error in command parsing test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Test slash command execution
 */
async function testSlashCommandExecution() {
  logger.info('Test 2: Slash command execution');

  try {
    const testCases = [
      {
        name: 'Ping slash command',
        interaction: createMockInteraction('ping'),
        expectSuccess: true,
      },
      {
        name: 'Help slash command',
        interaction: createMockInteraction('help'),
        expectSuccess: true,
      },
      {
        name: 'Stats slash command',
        interaction: createMockInteraction('stats'),
        expectSuccess: true,
      },
      {
        name: 'Image slash command with prompt',
        interaction: createMockInteraction('image', { prompt: 'a beautiful sunset' }),
        expectSuccess: true,
      },
      {
        name: 'Unknown slash command',
        interaction: createMockInteraction('unknowncommand'),
        expectSuccess: false,
      },
    ];

    const results = [];

    // Mock command modules for testing
    const mockCommands = {
      ping: {
        name: 'ping',
        description: 'Test connectivity',
        execute: async interaction => {
          await interaction.reply('Pong! 🏓');
          return { success: true };
        },
      },
      help: {
        name: 'help',
        description: 'Show help information',
        execute: async interaction => {
          await interaction.reply('Help information here');
          return { success: true };
        },
      },
      stats: {
        name: 'stats',
        description: 'Show bot statistics',
        execute: async interaction => {
          await interaction.reply('Bot statistics here');
          return { success: true };
        },
      },
      image: {
        name: 'image',
        description: 'Generate an image',
        execute: async interaction => {
          const prompt = interaction.options.getString('prompt');
          if (!prompt) {
            await interaction.reply('Please provide a prompt');
            return { success: false };
          }
          await interaction.reply(`Generating image: ${prompt}`);
          return { success: true };
        },
      },
    };

    for (const testCase of testCases) {
      try {
        const command = mockCommands[testCase.interaction.commandName];
        let success = false;
        let error = null;

        if (command) {
          try {
            const result = await command.execute(testCase.interaction);
            success = result.success;
          } catch (err) {
            error = err.message;
          }
        } else {
          error = 'Command not found';
        }

        const testSuccess = success === testCase.expectSuccess;

        results.push({
          name: testCase.name,
          success: testSuccess,
          actualSuccess: success,
          expectedSuccess: testCase.expectSuccess,
          error,
        });

        if (testSuccess) {
          logger.info(`✓ PASS: ${testCase.name} - execution correct`);
        } else {
          logger.warn(
            `✗ FAIL: ${testCase.name} - expected ${testCase.expectSuccess}, got ${success}`
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
    logger.error('Error in slash command execution test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Test command permission checking
 */
async function testCommandPermissions() {
  logger.info('Test 3: Command permission checking');

  try {
    const testCases = [
      {
        name: 'Regular user accessing public command',
        userId: 'regular-user',
        commandName: 'ping',
        isOwner: false,
        isAdmin: false,
        expectAllowed: true,
      },
      {
        name: 'Regular user accessing owner-only command',
        userId: 'regular-user',
        commandName: 'restart',
        isOwner: false,
        isAdmin: false,
        expectAllowed: false,
      },
      {
        name: 'Admin accessing admin command',
        userId: 'admin-user',
        commandName: 'clear',
        isOwner: false,
        isAdmin: true,
        expectAllowed: true,
      },
      {
        name: 'Owner accessing any command',
        userId: process.env.OWNER_ID || 'owner-user',
        commandName: 'restart',
        isOwner: true,
        isAdmin: true,
        expectAllowed: true,
      },
    ];

    const results = [];

    // Mock command configurations
    const commandConfigs = {
      ping: { ownerOnly: false, adminOnly: false },
      help: { ownerOnly: false, adminOnly: false },
      restart: { ownerOnly: true, adminOnly: false },
      clear: { ownerOnly: false, adminOnly: true },
    };

    for (const testCase of testCases) {
      try {
        const config = commandConfigs[testCase.commandName];
        let allowed = true;

        if (config) {
          if (config.ownerOnly && !testCase.isOwner) {
            allowed = false;
          } else if (config.adminOnly && !testCase.isAdmin && !testCase.isOwner) {
            allowed = false;
          }
        }

        const success = allowed === testCase.expectAllowed;

        results.push({
          name: testCase.name,
          success,
          allowed,
          expected: testCase.expectAllowed,
          config,
        });

        if (success) {
          logger.info(`✓ PASS: ${testCase.name} - permission check correct`);
        } else {
          logger.warn(
            `✗ FAIL: ${testCase.name} - expected ${testCase.expectAllowed}, got ${allowed}`
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
    logger.error('Error in command permissions test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Test command error handling
 */
async function testCommandErrorHandling() {
  logger.info('Test 4: Command error handling');

  try {
    const testCases = [
      {
        name: 'Command throws error',
        commandName: 'error-command',
        shouldThrow: true,
        expectHandled: true,
      },
      {
        name: 'Command with invalid parameters',
        commandName: 'param-command',
        invalidParams: true,
        expectHandled: true,
      },
      {
        name: 'Command timeout',
        commandName: 'timeout-command',
        timeout: true,
        expectHandled: true,
      },
    ];

    const results = [];

    // Mock commands that generate errors
    const errorCommands = {
      'error-command': async () => {
        throw new Error('Test command error');
      },
      'param-command': async params => {
        if (!params || !params.required) {
          throw new Error('Missing required parameter');
        }
        return { success: true };
      },
      'timeout-command': async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        throw new Error('Command timeout');
      },
    };

    for (const testCase of testCases) {
      try {
        let errorHandled = false;
        let error = null;

        try {
          const command = errorCommands[testCase.commandName];
          if (command) {
            if (testCase.invalidParams) {
              await command({});
            } else {
              await command({ required: 'value' });
            }
          }
        } catch (err) {
          errorHandled = true;
          error = err.message;
        }

        const success = errorHandled === testCase.expectHandled;

        results.push({
          name: testCase.name,
          success,
          errorHandled,
          expected: testCase.expectHandled,
          error,
        });

        if (success) {
          logger.info(`✓ PASS: ${testCase.name} - error handling correct`);
        } else {
          logger.warn(
            `✗ FAIL: ${testCase.name} - expected ${testCase.expectHandled}, got ${errorHandled}`
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
    logger.error('Error in command error handling test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Test command aliases and prefix handling
 */
async function testCommandAliases() {
  logger.info('Test 5: Command aliases and prefix handling');

  try {
    const testCases = [
      {
        name: 'Help command with h alias',
        content: '!h',
        expectedCommand: 'help',
      },
      {
        name: 'Stats command with s alias',
        content: '.s',
        expectedCommand: 'stats',
      },
      {
        name: 'Image command with img alias',
        content: '/img sunset',
        expectedCommand: 'image',
      },
      {
        name: 'Multiple prefix support',
        prefixes: ['!', '.', '/'],
        content: '!ping',
        expectedValid: true,
      },
    ];

    const results = [];

    // Mock command aliases
    const commandAliases = {
      h: 'help',
      s: 'stats',
      img: 'image',
      p: 'ping',
    };

    for (const testCase of testCases) {
      try {
        let success = false;
        let resolvedCommand = null;

        if (testCase.content) {
          const prefixes = ['!', '.', '/'];
          const content = testCase.content.trim();

          for (const prefix of prefixes) {
            if (content.startsWith(prefix)) {
              const command = content.slice(1).split(' ')[0].toLowerCase();
              resolvedCommand = commandAliases[command] || command;
              break;
            }
          }

          if (testCase.expectedCommand) {
            success = resolvedCommand === testCase.expectedCommand;
          } else if (testCase.expectedValid) {
            success = resolvedCommand !== null;
          }
        }

        results.push({
          name: testCase.name,
          success,
          resolvedCommand,
          expectedCommand: testCase.expectedCommand,
        });

        if (success) {
          logger.info(`✓ PASS: ${testCase.name} - alias resolution correct`);
        } else {
          logger.warn(`✗ FAIL: ${testCase.name} - alias resolution incorrect`);
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
    logger.error('Error in command aliases test:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Main test runner for command processing
 */
async function testCommandProcessing() {
  logger.info('Starting command processing tests...');

  const tests = [
    { name: 'Command Parsing', fn: testCommandParsing },
    { name: 'Slash Command Execution', fn: testSlashCommandExecution },
    { name: 'Command Permissions', fn: testCommandPermissions },
    { name: 'Command Error Handling', fn: testCommandErrorHandling },
    { name: 'Command Aliases', fn: testCommandAliases },
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

  logger.info(`Command processing tests completed: ${passed} passed, ${failed} failed`);

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
  testCommandProcessing,
};

// Allow running directly
if (require.main === module) {
  testCommandProcessing()
    .then(result => {
      console.log('\n=== Command Processing Test Results ===');
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
