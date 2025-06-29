# ChimpGPT Plugin System

This directory contains plugins for the ChimpGPT Discord bot. Plugins extend the bot's functionality by adding new commands, functions, and hooks.

## Creating a Plugin

To create a new plugin, follow these steps:

1. Create a new directory in the `plugins` folder with your plugin's name (e.g., `plugins/my-plugin`)
2. Create an `index.js` file in your plugin directory
3. Implement your plugin following the plugin interface shown below
4. Restart the bot to load your plugin

## Plugin Interface

A valid plugin must export an object with the following structure:

```javascript
module.exports = {
  // Required metadata
  id: 'unique-plugin-id',
  name: 'My Plugin Name',
  version: '1.0.0',

  // Optional metadata
  description: 'Description of what your plugin does',
  author: 'Your Name',

  // Discord slash commands (optional)
  commands: [
    {
      name: 'command-name',
      description: 'Command description',
      options: [], // Command options following Discord.js SlashCommandBuilder format
      execute: async interaction => {
        // Command implementation
      },
      interactionExecute: async interaction => {
        // Implementation for handling slash command interactions
      },
    },
  ],

  // Functions that can be called by the bot (optional)
  functions: {
    functionName: async (arg1, arg2) => {
      // Function implementation
      return result;
    },
  },

  // Hooks that are triggered at specific points in the bot's execution (optional)
  hooks: {
    // Called when the bot starts
    onBotStart: async client => {
      // Implementation
    },

    // Called when a message is received before processing
    onMessageReceived: async message => {
      // Implementation
      return true; // Return false to prevent further processing
    },

    // Called after a response is generated but before it's sent
    onResponseGenerated: async (response, message) => {
      // Modify the response if needed
      return response;
    },

    // Called when the bot is shutting down
    onBotShutdown: async () => {
      // Cleanup implementation
    },
  },
};
```

## Available Hooks

The following hooks are available for plugins to use:

| Hook                  | Description                                               | Parameters                                                         | Return Value           | Effect                                       |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------- | -------------------------------------------- |
| `onBotStart`          | Called when the bot starts                                | `client` - Discord.js client instance                              | None                   | Initialize plugin resources                  |
| `onBotShutdown`       | Called when the bot is shutting down                      | None                                                               | None                   | Clean up plugin resources                    |
| `onMessageReceived`   | Called when a message is received before processing       | `message` - Discord.js message object                              | Boolean                | Return `false` to prevent further processing |
| `onResponseGenerated` | Called after a response is generated but before it's sent | `response` - Generated response text, `message` - Original message | Modified response text | Modify the bot's response                    |
| `onCommandRegistered` | Called when a command is registered                       | `command` - Command object                                         | None                   | React to command registration                |
| `onFunctionCalled`    | Called when a function is called                          | `functionName` - Name of the function, `args` - Function arguments | None                   | Monitor function calls                       |
| `onError`             | Called when an error occurs                               | `error` - Error object, `context` - Error context                  | None                   | Handle or log errors                         |

### Hook Execution Order

1. `onBotStart` - When the bot initializes
2. `onMessageReceived` - When a message is received (before any processing)
3. `onCommandRegistered` - When commands are registered
4. `onFunctionCalled` - When functions are called
5. `onResponseGenerated` - After a response is generated (before sending)
6. `onError` - When errors occur
7. `onBotShutdown` - When the bot is shutting down

## Plugin Mock Fallback Behavior

The ChimpGPT plugin system includes a robust fallback mechanism to handle errors gracefully:

### Function Fallbacks

If a plugin function throws an error:

1. The error is logged with detailed context (plugin ID, function name, arguments)
2. The `onError` hook is triggered (if implemented)
3. A default fallback value is returned based on the expected return type:
   - For functions expected to return objects: `{}`
   - For functions expected to return arrays: `[]`
   - For functions expected to return strings: `""` (empty string)
   - For functions expected to return numbers: `0`
   - For functions expected to return booleans: `false`

### Hook Fallbacks

If a plugin hook throws an error:

1. The error is logged with detailed context (plugin ID, hook name)
2. The `onError` hook is triggered (if implemented)
3. The hook is skipped, and execution continues with the next plugin
4. For hooks that modify values (like `onResponseGenerated`), the original value is used

### Error Tracking

All plugin errors are tracked in the status page, showing:

- Plugin ID
- Error count
- Last error time
- Error details (hook/function name, error message)

This helps identify problematic plugins without crashing the bot.

## Example Plugins

- `example-plugin`: A simple example demonstrating basic plugin structure
- `dad-jokes`: A functional plugin that adds a dad joke command and responds to trigger phrases
- `version`: A plugin that provides version information about the bot

Examine these plugins to understand best practices for plugin development.
