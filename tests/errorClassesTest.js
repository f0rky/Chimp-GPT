/**
 * Error Classes Tests
 *
 * Tests for the custom error classes including ChimpError, ApiError,
 * PluginError, ValidationError, ConfigError, and DiscordError
 *
 * @module ErrorClassesTest
 */

const { createLogger } = require('../logger');
const logger = createLogger('errorClassesTest');

async function testErrorClasses() {
  const results = [];
  let errors;

  try {
    // Load the error classes
    errors = require('../errors');

    // Test 1: ChimpError base class
    try {
      const chimpError = new errors.ChimpError('Test error message', {
        code: 'TEST_ERROR',
        statusCode: 500,
        context: { foo: 'bar' },
      });

      const success =
        chimpError instanceof Error &&
        chimpError instanceof errors.ChimpError &&
        chimpError.message === 'Test error message' &&
        chimpError.code === 'TEST_ERROR' &&
        chimpError.context.foo === 'bar' &&
        chimpError.name === 'ChimpError';

      results.push({
        name: 'ChimpError Base Class',
        success,
        errorName: chimpError.name,
        hasStack: !!chimpError.stack,
      });
    } catch (error) {
      results.push({
        name: 'ChimpError Base Class',
        success: false,
        error: error.message,
      });
    }

    // Test 2: ApiError class
    try {
      const apiError = new errors.ApiError('API request failed', {
        endpoint: '/api/test',
        service: 'test-api',
        statusCode: 404,
        responseData: { error: 'Not found' },
      });

      const success =
        apiError instanceof errors.ChimpError &&
        apiError instanceof errors.ApiError &&
        apiError.message === 'API request failed' &&
        apiError.endpoint === '/api/test' &&
        apiError.service === 'test-api' &&
        apiError.statusCode === 404 &&
        apiError.responseData.error === 'Not found' &&
        apiError.name === 'ApiError';

      results.push({
        name: 'ApiError Class',
        success,
        errorName: apiError.name,
        endpoint: apiError.endpoint,
      });
    } catch (error) {
      results.push({
        name: 'ApiError Class',
        success: false,
        error: error.message,
      });
    }

    // Test 3: PluginError class
    try {
      const pluginError = new errors.PluginError('Plugin failed to load', {
        pluginName: 'test-plugin',
        pluginVersion: '1.0.0',
        hookName: 'onLoad',
        cause: new Error('Original error'),
      });

      const success =
        pluginError instanceof errors.ChimpError &&
        pluginError instanceof errors.PluginError &&
        pluginError.message === 'Plugin failed to load' &&
        pluginError.pluginName === 'test-plugin' &&
        pluginError.pluginVersion === '1.0.0' &&
        pluginError.hookName === 'onLoad' &&
        pluginError.cause instanceof Error &&
        pluginError.name === 'PluginError';

      results.push({
        name: 'PluginError Class',
        success,
        errorName: pluginError.name,
        pluginName: pluginError.pluginName,
      });
    } catch (error) {
      results.push({
        name: 'PluginError Class',
        success: false,
        error: error.message,
      });
    }

    // Test 4: ValidationError class
    try {
      const validationError = new errors.ValidationError('Invalid input', {
        field: 'email',
        value: 'invalid-email',
        constraint: 'must be valid email format',
        code: 'INVALID_EMAIL',
      });

      const success =
        validationError instanceof errors.ChimpError &&
        validationError instanceof errors.ValidationError &&
        validationError.message === 'Invalid input' &&
        validationError.field === 'email' &&
        validationError.value === 'invalid-email' &&
        validationError.constraint === 'must be valid email format' &&
        validationError.code === 'INVALID_EMAIL' &&
        validationError.name === 'ValidationError';

      results.push({
        name: 'ValidationError Class',
        success,
        errorName: validationError.name,
        field: validationError.field,
      });
    } catch (error) {
      results.push({
        name: 'ValidationError Class',
        success: false,
        error: error.message,
      });
    }

    // Test 5: ConfigError class
    try {
      const configError = new errors.ConfigError('Missing configuration', {
        configKey: 'OPENAI_API_KEY',
        missingRequired: true,
        requiredType: 'string',
      });

      const success =
        configError instanceof errors.ChimpError &&
        configError instanceof errors.ConfigError &&
        configError.message === 'Missing configuration' &&
        configError.configKey === 'OPENAI_API_KEY' &&
        configError.missingRequired === true &&
        configError.requiredType === 'string' &&
        configError.name === 'ConfigError';

      results.push({
        name: 'ConfigError Class',
        success,
        errorName: configError.name,
        configKey: configError.configKey,
      });
    } catch (error) {
      results.push({
        name: 'ConfigError Class',
        success: false,
        error: error.message,
      });
    }

    // Test 6: DiscordError class
    try {
      const discordError = new errors.DiscordError('Failed to send message', {
        channelId: '123456789',
        guildId: '987654321',
        permissions: { missing: ['SEND_MESSAGES'] },
        statusCode: 403,
      });

      const success =
        discordError instanceof errors.ChimpError &&
        discordError instanceof errors.DiscordError &&
        discordError instanceof errors.ApiError &&
        discordError.message === 'Failed to send message' &&
        discordError.channelId === '123456789' &&
        discordError.guildId === '987654321' &&
        discordError.permissions.missing[0] === 'SEND_MESSAGES' &&
        discordError.statusCode === 403 &&
        discordError.name === 'DiscordError';

      results.push({
        name: 'DiscordError Class',
        success,
        errorName: discordError.name,
        statusCode: discordError.statusCode,
      });
    } catch (error) {
      results.push({
        name: 'DiscordError Class',
        success: false,
        error: error.message,
      });
    }

    // Test 7: createError helper function
    try {
      const apiError = errors.createError('api', 'API Error', { endpoint: '/test' });
      const pluginError = errors.createError('plugin', 'Plugin Error', { pluginName: 'test' });
      const validationError = errors.createError('validation', 'Validation Error', {
        field: 'test',
      });
      const configError = errors.createError('config', 'Config Error', { configKey: 'TEST' });
      const discordError = errors.createError('discord', 'Discord Error', { channelId: '123' });
      const genericError = errors.createError('unknown', 'Generic Error');

      const success =
        apiError instanceof errors.ApiError &&
        pluginError instanceof errors.PluginError &&
        validationError instanceof errors.ValidationError &&
        configError instanceof errors.ConfigError &&
        discordError instanceof errors.DiscordError &&
        genericError instanceof errors.ChimpError &&
        !(genericError instanceof errors.ApiError);

      results.push({
        name: 'createError Helper',
        success,
        typesCreated: 6,
      });
    } catch (error) {
      results.push({
        name: 'createError Helper',
        success: false,
        error: error.message,
      });
    }

    // Test 8: wrapError helper function
    try {
      const originalError = new Error('Original error');
      originalError.code = 'ENOENT';

      const wrappedError = errors.wrapError(originalError, 'File not found', {
        code: 'FILE_ERROR',
        context: { path: '/test/file.txt' },
      });

      // Test wrapping an already wrapped error
      const doubleWrapped = errors.wrapError(wrappedError, 'Still wrapped');

      const success =
        wrappedError instanceof errors.ChimpError &&
        wrappedError.message === 'File not found' &&
        wrappedError.cause === originalError &&
        wrappedError.code === 'FILE_ERROR' &&
        wrappedError.context.path === '/test/file.txt' &&
        doubleWrapped === wrappedError; // Should return the same error

      results.push({
        name: 'wrapError Helper',
        success,
        hasCause: !!wrappedError.cause,
        sameOnDoubleWrap: doubleWrapped === wrappedError,
      });
    } catch (error) {
      results.push({
        name: 'wrapError Helper',
        success: false,
        error: error.message,
      });
    }

    // Test 9: Error serialization
    try {
      const complexError = new errors.ApiError('Complex error', {
        endpoint: '/api/data',
        statusCode: 500,
        responseData: { error: 'Internal server error', details: { foo: 'bar' } },
        cause: new Error('Network timeout'),
      });

      // Convert to JSON and back
      const serialized = JSON.stringify(complexError);
      const parsed = JSON.parse(serialized);

      const success =
        parsed.name === 'ApiError' &&
        parsed.message === 'Complex error' &&
        parsed.endpoint === '/api/data' &&
        parsed.statusCode === 500 &&
        parsed.responseData.error === 'Internal server error';

      results.push({
        name: 'Error Serialization',
        success,
        serializedLength: serialized.length,
      });
    } catch (error) {
      results.push({
        name: 'Error Serialization',
        success: false,
        error: error.message,
      });
    }

    // Test 10: Error inheritance chain
    try {
      const apiError = new errors.ApiError('Test');

      const inheritanceCorrect =
        apiError instanceof Error &&
        apiError instanceof errors.ChimpError &&
        apiError instanceof errors.ApiError &&
        !(apiError instanceof errors.PluginError) &&
        !(apiError instanceof errors.ValidationError);

      results.push({
        name: 'Error Inheritance Chain',
        success: inheritanceCorrect,
      });
    } catch (error) {
      results.push({
        name: 'Error Inheritance Chain',
        success: false,
        error: error.message,
      });
    }
  } catch (error) {
    logger.error({ error }, 'Error in error classes tests');
    return {
      success: false,
      error: error.message,
      results,
    };
  }

  // Calculate overall success
  const success = results.every(r => r.success);

  return {
    success,
    results,
  };
}

// Export for test runner
module.exports = { testErrorClasses };

// Run tests if called directly
if (require.main === module) {
  testErrorClasses().then(results => {
    console.log('Error Classes Test Results:', JSON.stringify(results, null, 2));
    process.exit(results.success ? 0 : 1);
  });
}
