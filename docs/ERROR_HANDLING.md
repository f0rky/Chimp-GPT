# Error Handling in ChimpGPT

This document describes the advanced error handling system in ChimpGPT, including custom error classes and utility functions for consistent error management.

## Table of Contents

- [Overview](#overview)
- [Error Classes](#error-classes)
- [Error Handling Utilities](#error-handling-utilities)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Overview

ChimpGPT uses a structured error handling system with custom error classes that extend the native JavaScript `Error` class. This approach provides several benefits:

- **Rich context**: Errors contain detailed information about where and why they occurred
- **Consistent logging**: All errors are logged with consistent structure and detail
- **Error tracking**: Errors are automatically tracked in the health check system
- **Type safety**: Error types help identify and handle specific error scenarios
- **Security**: Sensitive information is automatically redacted in error logs

## Error Classes

### Base Class

- **`ChimpError`**: The base class for all custom errors in ChimpGPT

### Specialized Error Classes

- **`ApiError`**: For errors related to external API calls (OpenAI, weather services, etc.)
- **`PluginError`**: For errors related to plugin operations (loading, execution, etc.)
- **`ValidationError`**: For errors related to input validation
- **`ConfigError`**: For errors related to configuration issues
- **`DiscordError`**: For errors specific to Discord API operations

### Creating Errors

You can create errors using the factory function:

```javascript
const { createError } = require('../errors');

// Create an API error
const error = createError('api', 'Failed to call OpenAI API', {
  service: 'openai',
  endpoint: '/chat/completions',
  statusCode: 429,
  operation: 'generateResponse',
});
```

Or by directly instantiating the error classes:

```javascript
const { ApiError } = require('../errors');

const error = new ApiError('Failed to call OpenAI API', {
  service: 'openai',
  endpoint: '/chat/completions',
  statusCode: 429,
  operation: 'generateResponse',
});
```

### Wrapping Existing Errors

You can wrap existing errors to add more context:

```javascript
const { wrapError } = require('../errors');

try {
  // Some operation that might throw
  await callExternalApi();
} catch (error) {
  // Wrap the error with additional context
  throw wrapError(error, 'Failed during API call', {
    component: 'weather',
    operation: 'getWeatherData',
  });
}
```

## Error Handling Utilities

The `utils/errorHandler.js` module provides utilities for consistent error handling:

### `handleError(error, options)`

Logs and tracks an error with consistent formatting:

```javascript
const { handleError } = require('../utils/errorHandler');

try {
  // Some operation that might throw
  await riskyOperation();
} catch (error) {
  handleError(error, {
    component: 'imageGeneration',
    operation: 'generateImage',
    context: { prompt: 'blue sky' },
    rethrow: true, // Will rethrow the error after handling
  });
}
```

### `tryExec(fn, options, defaultValue)`

Executes a function and handles any errors, returning a default value if it fails:

```javascript
const { tryExec } = require('../utils/errorHandler');

// Try to get weather data, return empty object if it fails
const weatherData = await tryExec(
  () => getWeatherData(location),
  {
    component: 'weather',
    operation: 'getWeatherData',
    context: { location },
  },
  {} // Default value if the function fails
);
```

### `withErrorHandling(fn, options, defaultValue)`

Creates a wrapped function with built-in error handling:

```javascript
const { withErrorHandling } = require('../utils/errorHandler');

// Create a wrapped version of the function
const safeGetWeatherData = withErrorHandling(
  getWeatherData,
  {
    component: 'weather',
    operation: 'getWeatherData',
  },
  {} // Default value if the function fails
);

// Use the safe version
const weatherData = await safeGetWeatherData(location);
```

## Best Practices

1. **Use the most specific error class** for your situation
2. **Include relevant context** in your errors
3. **Don't expose sensitive information** in error messages
4. **Use the error handling utilities** for consistent handling
5. **Add appropriate error codes** to make errors identifiable
6. **Handle errors at the appropriate level** of your application
7. **Log errors with sufficient context** for debugging
8. **Provide user-friendly error messages** when appropriate

## Examples

### API Error Handling

```javascript
const { ApiError } = require('../errors');
const { handleError } = require('../utils/errorHandler');

async function callOpenAI(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [{ role: 'user', content: prompt }],
    });
    return response;
  } catch (error) {
    throw new ApiError('OpenAI API call failed', {
      service: 'openai',
      endpoint: '/chat/completions',
      statusCode: error.status || 500,
      operation: 'generateResponse',
      context: { prompt },
      cause: error,
    });
  }
}

// Usage with error handling
async function generateResponse(prompt) {
  try {
    return await callOpenAI(prompt);
  } catch (error) {
    handleError(error, {
      component: 'openai',
      operation: 'generateResponse',
    });
    return { error: 'Failed to generate response' };
  }
}
```

### Plugin Error Handling

```javascript
const { PluginError } = require('../errors');
const { handleError } = require('../utils/errorHandler');

function executePluginHook(plugin, hookName, ...args) {
  try {
    if (!plugin.hooks || !plugin.hooks[hookName]) {
      return null;
    }

    return plugin.hooks[hookName](...args);
  } catch (error) {
    throw new PluginError(`Failed to execute hook ${hookName}`, {
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginVersion: plugin.version,
      hookName,
      operation: 'executeHook',
      cause: error,
    });
  }
}

// Usage with error handling
async function runPluginHooks(hookName, ...args) {
  const results = [];

  for (const plugin of plugins) {
    try {
      const result = await executePluginHook(plugin, hookName, ...args);
      if (result) {
        results.push(result);
      }
    } catch (error) {
      handleError(error, {
        component: 'pluginManager',
        operation: 'runPluginHooks',
      });
      // Continue with other plugins
    }
  }

  return results;
}
```

### Validation Error Handling

```javascript
const { ValidationError } = require('../errors');
const { handleError } = require('../utils/errorHandler');

function validateConfig(config) {
  const errors = new ValidationError('Configuration validation failed');

  if (!config.DISCORD_TOKEN) {
    errors.addError('DISCORD_TOKEN', 'Discord token is required');
  }

  if (!config.OPENAI_API_KEY) {
    errors.addError('OPENAI_API_KEY', 'OpenAI API key is required');
  }

  if (errors.validationErrors.length > 0) {
    throw errors;
  }

  return true;
}

// Usage with error handling
function initializeBot(config) {
  try {
    validateConfig(config);
    // Continue initialization
  } catch (error) {
    handleError(error, {
      component: 'initialization',
      operation: 'validateConfig',
    });
    process.exit(1); // Exit if config is invalid
  }
}
```
