/**
 * Plugin System Test Module
 *
 * This module tests the plugin system to ensure it properly
 * loads, registers, and executes plugins and their hooks.
 *
 * @module PluginSystemTest
 * @author Brett
 * @version 1.0.0
 */

// Import required modules
const pluginManager = require('../pluginManager');
const { createLogger } = require('../logger');
const logger = createLogger('pluginTest');
const path = require('path');
const fs = require('fs');

/**
 * Test the plugin system
 *
 * This function tests various aspects of the plugin system:
 * - Plugin loading and validation
 * - Command registration
 * - Function registration
 * - Hook registration and execution
 * - Error handling
 *
 * @returns {Object} Test results with success/failure status and details
 */
async function testPluginSystem() {
  logger.info('Starting plugin system tests...');

  const results = {
    success: true,
    results: [],
  };

  try {
    // Test 1: Plugin loading
    logger.info('Test 1: Plugin loading');
    const test1Result = {
      name: 'Plugin loading',
      success: false,
      details: {},
    };

    try {
      // Reset plugin manager state
      await pluginManager.unloadAllPlugins();

      // Load plugins
      const pluginCount = await pluginManager.loadPlugins();

      test1Result.success = pluginCount > 0;
      test1Result.details = {
        pluginCount,
        pluginsLoaded: test1Result.success ? 'Yes' : 'No',
      };

      if (!test1Result.success) {
        logger.warn('No plugins were loaded in Test 1');
      } else {
        logger.info({ pluginCount }, 'Plugins loaded successfully');
      }
    } catch (error) {
      test1Result.success = false;
      test1Result.error = error.message;
      logger.error({ error }, 'Error in Test 1: Plugin loading');
    }

    results.results.push(test1Result);

    // Test 2: Plugin validation
    logger.info('Test 2: Plugin validation');
    const test2Result = {
      name: 'Plugin validation',
      success: false,
      details: {},
    };

    try {
      // Create a temporary invalid plugin
      const tempPluginDir = path.join(__dirname, 'temp_plugin_test');
      const tempPluginFile = path.join(tempPluginDir, 'invalid_plugin.js');

      // Create directory if it doesn't exist
      if (!fs.existsSync(tempPluginDir)) {
        fs.mkdirSync(tempPluginDir, { recursive: true });
      }

      // Write an invalid plugin file
      fs.writeFileSync(
        tempPluginFile,
        `
        // This is an invalid plugin (missing required properties)
        module.exports = {
          name: 'InvalidPlugin'
          // Missing version, description, author
        };
      `
      );

      // Try to load the invalid plugin
      let validationError = null;
      try {
        await pluginManager.loadPlugin(tempPluginFile);
      } catch (error) {
        validationError = error;
      }

      // Clean up temp files
      fs.unlinkSync(tempPluginFile);
      fs.rmdirSync(tempPluginDir);

      test2Result.success = validationError !== null;
      test2Result.details = {
        validationErrorCaught: test2Result.success ? 'Yes' : 'No',
        errorMessage: validationError ? validationError.message : 'N/A',
      };

      if (!test2Result.success) {
        logger.warn('Invalid plugin was not properly validated in Test 2');
      } else {
        logger.info(
          { errorMessage: validationError.message },
          'Plugin validation working correctly'
        );
      }
    } catch (error) {
      test2Result.success = false;
      test2Result.error = error.message;
      logger.error({ error }, 'Error in Test 2: Plugin validation');
    }

    results.results.push(test2Result);

    // Test 3: Command registration
    logger.info('Test 3: Command registration');
    const test3Result = {
      name: 'Command registration',
      success: false,
      details: {},
    };

    try {
      // Get all commands from plugin manager
      const commands = pluginManager.getAllCommands();

      test3Result.success = Object.keys(commands).length > 0;
      test3Result.details = {
        commandCount: Object.keys(commands).length,
        commandsRegistered: test3Result.success ? 'Yes' : 'No',
        commandNames: Object.keys(commands).join(', '),
      };

      if (!test3Result.success) {
        logger.warn('No commands were registered in Test 3');
      } else {
        logger.info(
          { commandCount: Object.keys(commands).length },
          'Commands registered successfully'
        );
      }
    } catch (error) {
      test3Result.success = false;
      test3Result.error = error.message;
      logger.error({ error }, 'Error in Test 3: Command registration');
    }

    results.results.push(test3Result);

    // Test 4: Function registration
    logger.info('Test 4: Function registration');
    const test4Result = {
      name: 'Function registration',
      success: false,
      details: {},
    };

    try {
      // Get all functions from plugin manager
      const functions = pluginManager.getAllFunctions();

      test4Result.success = Object.keys(functions).length > 0;
      test4Result.details = {
        functionCount: Object.keys(functions).length,
        functionsRegistered: test4Result.success ? 'Yes' : 'No',
        functionNames: Object.keys(functions).join(', '),
      };

      if (!test4Result.success) {
        logger.warn('No functions were registered in Test 4');
      } else {
        logger.info(
          { functionCount: Object.keys(functions).length },
          'Functions registered successfully'
        );
      }
    } catch (error) {
      test4Result.success = false;
      test4Result.error = error.message;
      logger.error({ error }, 'Error in Test 4: Function registration');
    }

    results.results.push(test4Result);

    // Test 5: Hook execution
    logger.info('Test 5: Hook execution');
    const test5Result = {
      name: 'Hook execution',
      success: false,
      details: {},
    };

    try {
      // Execute a test hook
      const hookResults = await pluginManager.executeHook('onBotStart', { test: true });

      test5Result.success = hookResults && hookResults.length >= 0;
      test5Result.details = {
        hookExecuted: test5Result.success ? 'Yes' : 'No',
        resultsCount: hookResults ? hookResults.length : 0,
      };

      if (!test5Result.success) {
        logger.warn('Hook execution failed in Test 5');
      } else {
        logger.info({ resultsCount: hookResults.length }, 'Hook executed successfully');
      }
    } catch (error) {
      test5Result.success = false;
      test5Result.error = error.message;
      logger.error({ error }, 'Error in Test 5: Hook execution');
    }

    results.results.push(test5Result);

    // Test 6: Error handling in plugin execution
    logger.info('Test 6: Error handling in plugin execution');
    const test6Result = {
      name: 'Error handling in plugin execution',
      success: false,
      details: {},
    };

    try {
      // Create a mock function that will throw an error
      const mockFunction = {
        name: 'testErrorFunction',
        execute: () => {
          throw new Error('Test error');
        },
      };

      // Register the mock function
      pluginManager.registerFunction('testPlugin', mockFunction);

      // Try to execute the function
      let errorCaught = false;
      try {
        await pluginManager.executeFunction('testErrorFunction');
      } catch (error) {
        errorCaught = true;
      }

      test6Result.success = errorCaught;
      test6Result.details = {
        errorHandled: errorCaught ? 'Yes' : 'No',
      };

      if (!test6Result.success) {
        logger.warn('Error handling failed in Test 6');
      } else {
        logger.info('Error handling working correctly');
      }

      // Clean up
      pluginManager.unregisterFunction('testErrorFunction');
    } catch (error) {
      test6Result.success = false;
      test6Result.error = error.message;
      logger.error({ error }, 'Error in Test 6: Error handling');
    }

    results.results.push(test6Result);

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
      'Plugin system tests completed'
    );
  } catch (error) {
    results.success = false;
    results.error = error.message;
    logger.error({ error }, 'Unexpected error in plugin system tests');
  }

  return results;
}

// Run tests if this file is executed directly
if (require.main === module) {
  testPluginSystem()
    .then(results => {
      console.log(JSON.stringify(results, null, 2));
      process.exit(results.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution error:', error);
      process.exit(1);
    });
}

module.exports = { testPluginSystem };
