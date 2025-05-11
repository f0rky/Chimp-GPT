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
      execute: async (interaction) => {
        // Command implementation
      },
      interactionExecute: async (interaction) => {
        // Implementation for handling slash command interactions
      }
    }
  ],
  
  // Functions that can be called by the bot (optional)
  functions: {
    functionName: async (arg1, arg2) => {
      // Function implementation
      return result;
    }
  },
  
  // Hooks that are triggered at specific points in the bot's execution (optional)
  hooks: {
    // Called when the bot starts
    onBotStart: async (client) => {
      // Implementation
    },
    
    // Called when a message is received before processing
    onMessageReceived: async (message) => {
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
    }
  }
};
```

## Available Hooks

The following hooks are available for plugins to use:

- `onBotStart`: Called when the bot starts
- `onBotShutdown`: Called when the bot is shutting down
- `onMessageReceived`: Called when a message is received before processing
- `onResponseGenerated`: Called after a response is generated but before it's sent
- `onCommandRegistered`: Called when a command is registered
- `onFunctionCalled`: Called when a function is called
- `onError`: Called when an error occurs

## Example Plugin

See the `example-plugin` directory for a simple example plugin.
