/**
 * @typedef {Object} Plugin
 * @property {string} id - Unique plugin ID
 * @property {string} name - Plugin name
 * @property {string} version - Plugin version
 * @property {string} [description] - Plugin description
 * @property {string} [author] - Plugin author
 * @property {Array<PluginCommand>} [commands] - Array of plugin commands
 * @property {Object.<string, PluginFunction>} [functions] - Map of plugin functions
 * @property {Object.<string, PluginHook>} [hooks] - Map of plugin hooks
 *
 * @typedef {Object} PluginCommand
 * @property {string} name - Command name
 * @property {string} description - Command description
 * @property {Function} execute - Command execution function
 *
 * @typedef {Object} PluginFunction
 * @property {string} name - Function name
 * @property {Function} execute - Function execution logic
 * @property {string} pluginId - Owning plugin ID
 *
 * @typedef {Object} PluginHook
 * @property {string} name - Hook name
 * @property {Function} execute - Hook execution logic
 * @property {string} pluginId - Owning plugin ID
 */
/**
 * ChimpGPT Plugin Manager
 *
 * This module manages the loading, registration, and execution of plugins
 * for the ChimpGPT Discord bot. It provides a standardized interface for
 * extending the bot's functionality through plugins.
 *
 * @module pluginManager
 * @author Brett
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');

// Create a logger for the plugin manager
const logger = createLogger('plugins');

// Store registered plugins
const plugins = {
  commands: {},
  functions: {},
  hooks: {},
  metadata: {},
};

// Forward declarations to avoid circular dependency
let healthCheckModule = null;

/**
 * Safely access health check functions to avoid circular dependency issues
 * @param {string} functionName - The name of the function to call
 * @param {...any} args - Arguments to pass to the function
 * @returns {any} - Result of the function call or undefined if function doesn't exist
 */
function safeHealthCheck(functionName, ...args) {
  if (!healthCheckModule) {
    try {
      // Lazy load the health check module only when needed
      healthCheckModule = require('./healthCheck');
    } catch (error) {
      logger.warn({ error: error.message }, 'Failed to load healthCheck module');
      return undefined;
    }
  }

  if (typeof healthCheckModule[functionName] === 'function') {
    try {
      return healthCheckModule[functionName](...args);
    } catch (error) {
      logger.warn(
        { error: error.message, function: functionName },
        'Error calling healthCheck function'
      );
      return undefined;
    }
  }
  return undefined;
}

/**
 * Register a plugin with the plugin manager
 *
 * @param {Plugin} plugin - The plugin object to register
 * @returns {boolean} True if registration was successful, false otherwise
 */
function registerPlugin(plugin) {
  try {
    // Validate plugin structure
    if (!plugin || !plugin.id || !plugin.name || !plugin.version) {
      logger.error(
        {
          plugin,
          pluginId: plugin?.id || 'unknown',
          pluginVersion: plugin?.version || 'unknown',
        },
        'Invalid plugin structure'
      );
      return false;
    }

    // Check if plugin is already registered
    if (plugins.metadata[plugin.id]) {
      logger.warn(
        {
          pluginId: plugin.id,
          pluginVersion: plugin.version,
        },
        'Plugin already registered'
      );
      return false;
    }

    // Register plugin metadata
    plugins.metadata[plugin.id] = {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description || '',
      author: plugin.author || 'Unknown',
      enabled: true,
    };

    logger.info(
      {
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginVersion: plugin.version,
      },
      'Registered plugin'
    );

    // Register commands
    if (plugin.commands && Array.isArray(plugin.commands)) {
      plugin.commands.forEach(command => {
        if (command && command.name && typeof command.execute === 'function') {
          // Check for command name conflicts
          if (plugins.commands[command.name]) {
            const existingPluginId = plugins.commands[command.name].pluginId;
            logger.warn(
              {
                pluginId: plugin.id,
                commandName: command.name,
                existingPluginId,
              },
              `Command name conflict: '${command.name}' already registered by plugin '${existingPluginId}'`
            );

            // Track the conflict in plugin metadata
            if (!plugins.metadata[plugin.id].conflicts) {
              plugins.metadata[plugin.id].conflicts = [];
            }
            plugins.metadata[plugin.id].conflicts.push({
              type: 'command',
              name: command.name,
              conflictingPluginId: existingPluginId,
            });
          } else {
            // No conflict, register the command
            plugins.commands[command.name] = {
              ...command,
              pluginId: plugin.id,
            };
            logger.debug(
              {
                pluginId: plugin.id,
                commandName: command.name,
              },
              'Registered command'
            );
          }
        } else {
          logger.warn(
            {
              pluginId: plugin.id,
              command,
            },
            'Invalid command structure'
          );
        }
      });
    }

    // Register functions
    if (plugin.functions && typeof plugin.functions === 'object') {
      Object.keys(plugin.functions).forEach(functionName => {
        if (typeof plugin.functions[functionName] === 'function') {
          plugins.functions[functionName] = {
            execute: plugin.functions[functionName],
            pluginId: plugin.id,
          };
          logger.debug(
            {
              pluginId: plugin.id,
              functionName,
            },
            'Registered function'
          );
        } else {
          logger.warn(
            {
              pluginId: plugin.id,
              functionName,
            },
            'Invalid function'
          );
        }
      });
    }

    // Register hooks
    if (plugin.hooks && typeof plugin.hooks === 'object') {
      Object.keys(plugin.hooks).forEach(hookName => {
        if (typeof plugin.hooks[hookName] === 'function') {
          if (!plugins.hooks[hookName]) {
            plugins.hooks[hookName] = [];
          }
          plugins.hooks[hookName].push({
            execute: plugin.hooks[hookName],
            pluginId: plugin.id,
          });
          logger.debug(
            {
              pluginId: plugin.id,
              hookName,
            },
            'Registered hook'
          );
        } else {
          logger.warn(
            {
              pluginId: plugin.id,
              hookName,
            },
            'Invalid hook'
          );
        }
      });
    }

    return true;
  } catch (error) {
    logger.error(
      {
        error,
        pluginId: plugin?.id || 'unknown',
        pluginVersion: plugin?.version || plugins.metadata?.[plugin?.id]?.version || 'unknown',
        context: 'registerPlugin',
        pluginName: plugin?.name || 'unknown',
      },
      'Error registering plugin'
    );
    return false;
  }
}

/**
 * Load all plugins from the plugins directory
 *
 * @returns {Promise<number>} The number of successfully loaded plugins
 */
async function loadPlugins() {
  try {
    let loadedCount = 0;
    let commandCount = 0;
    let functionCount = 0;
    let hookCount = 0;

    // Get plugins directory path
    const pluginsDir = path.join(__dirname, 'plugins');

    // Create plugins directory if it doesn't exist
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
      logger.info('Created plugins directory');
    }

    // Get all plugin directories
    const pluginFolders = fs
      .readdirSync(pluginsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    // Load each plugin
    for (const folder of pluginFolders) {
      try {
        const folderPath = path.join(pluginsDir, folder);

        // Check for main plugin file
        const mainFile = path.join(folderPath, 'index.js');
        if (!fs.existsSync(mainFile)) {
          logger.warn({ folder }, 'Plugin main file not found');
          continue;
        }

        // Load the plugin
        const plugin = require(mainFile);

        // Register the plugin
        if (registerPlugin(plugin)) {
          loadedCount++;

          // Count commands, functions, and hooks
          if (plugin.commands && Array.isArray(plugin.commands)) {
            commandCount += plugin.commands.length;
          }

          if (plugin.functions && typeof plugin.functions === 'object') {
            functionCount += Object.keys(plugin.functions).length;
          }

          if (plugin.hooks && typeof plugin.hooks === 'object') {
            hookCount += Object.keys(plugin.hooks).length;
          }
        }
      } catch (error) {
        logger.error(
          {
            error,
            folder,
            pluginId: 'unknown',
            pluginVersion: 'unknown',
          },
          'Error loading plugin'
        );
      }
    }

    // Update plugin statistics
    safeHealthCheck('updatePluginStats', {
      loaded: loadedCount,
      commands: commandCount,
      functions: functionCount,
      hooks: hookCount,
    });

    logger.info(
      {
        loadedCount,
        commandCount,
        functionCount,
        hookCount,
      },
      'Loaded plugins'
    );

    return loadedCount;
  } catch (error) {
    logger.error({ error }, 'Error loading plugins');
    return 0;
  }
}

/**
 * Get a registered command by name
 *
 * @param {string} commandName - The name of the command to get
 * @returns {Object|null} The command object or null if not found
 */
function getCommand(commandName) {
  return plugins.commands[commandName] || null;
}

/**
 * Get all registered commands
 *
 * @returns {Object} An object containing all registered commands
 */
function getAllCommands() {
  return plugins.commands;
}

/**
 * Execute a function from a plugin
 *
 * @param {string} functionName - The name of the function to execute
 * @param {...any} args - Arguments to pass to the function
 * @returns {Promise<Object>} An object containing the result of the function execution
 */
async function executeFunction(functionName, ...args) {
  let func = null;

  try {
    // Get the function
    func = plugins.functions[functionName];
    if (!func) {
      throw new Error(`Plugin function '${functionName}' not found`);
    }

    // Execute the function
    const result = await func.execute(...args);

    // Track the function call in the function results system
    safeHealthCheck(
      'trackPluginFunctionCall',
      func.pluginId,
      functionName,
      { args: args.map(arg => String(arg).substring(0, 100)) }, // Truncate args for storage
      { success: true, result: result }
    );

    return { success: true, data: result, pluginId: func.pluginId, functionName };
  } catch (error) {
    // Track the error with more granular information
    if (func && func.pluginId) {
      safeHealthCheck('trackError', 'plugins', func.pluginId, `function:${functionName}`);
    } else {
      safeHealthCheck('trackError', 'plugins', null, `function:${functionName}`);
    }

    // Get plugin details for better error context
    const pluginDetails = func?.pluginId ? plugins.metadata[func.pluginId] || {} : {};

    // Log detailed error information
    logger.error(
      {
        message: error.message,
        stack: error.stack,
        functionName,
        pluginId: func?.pluginId,
        pluginName: pluginDetails.name,
        pluginVersion: pluginDetails.version,
        context: 'executeFunction',
        args: args.map(arg => {
          if (arg === null) return 'null';
          if (arg === undefined) return 'undefined';
          if (typeof arg === 'object') {
            try {
              // Extract only key names without values for sensitive objects
              return `Object with keys: [${Object.keys(arg).join(', ')}]`;
            } catch (e) {
              return 'Unserializable object';
            }
          }
          return String(arg).substring(0, 100); // Truncate long strings
        }),
        timestamp: new Date().toISOString(),
        errorType: error.name || 'Error',
        errorCode: error.code || 'UNKNOWN',
      },
      'Error executing plugin function'
    );

    // Track the function call with error
    if (func && func.pluginId) {
      safeHealthCheck(
        'trackPluginFunctionCall',
        func.pluginId,
        functionName,
        { args: args.map(arg => String(arg).substring(0, 100)) }, // Truncate args for storage
        { success: false, error: error.message }
      );
    }

    return { success: false, error, pluginId: func?.pluginId, functionName };
  }
}

/**
 * Execute a hook from plugins
 *
 * @param {string} hookName - The name of the hook to execute
 * @param {...any} args - Arguments to pass to the hook
 * @returns {Promise<Array<Object>>} An array of objects containing the results of the hook executions
 */
async function executeHook(hookName, ...args) {
  const results = [];
  let hookHandlers = [];

  try {
    // Get all plugins that implement this hook
    hookHandlers = plugins.hooks[hookName] || [];

    // Execute each hook handler
    for (const handler of hookHandlers) {
      try {
        // Skip disabled plugins
        const pluginMetadata = plugins.metadata[handler.pluginId];
        if (pluginMetadata && !pluginMetadata.enabled) {
          logger.debug(
            {
              pluginId: handler.pluginId,
              hookName,
            },
            'Skipping hook for disabled plugin'
          );
          continue;
        }

        // Execute the hook
        const result = await handler.execute(...args);

        // Track the hook execution
        safeHealthCheck(
          'trackPluginFunctionCall',
          handler.pluginId,
          `hook:${hookName}`,
          { args: args.map(arg => String(arg).substring(0, 100)) },
          { success: true, result: result }
        );

        results.push({
          success: true,
          data: result,
          pluginId: handler.pluginId,
          hookName,
        });
      } catch (error) {
        // Track the error with the plugin ID and hook name
        safeHealthCheck('trackError', 'plugins', handler.pluginId, hookName);

        // Get plugin details for better error context
        const pluginDetails = plugins.metadata[handler.pluginId] || {};

        // Log detailed error information
        logger.error(
          {
            message: error.message,
            stack: error.stack,
            hookName,
            pluginId: handler.pluginId,
            pluginName: pluginDetails.name,
            pluginVersion: pluginDetails.version,
            context: 'executeHook',
            args: args.map(arg => {
              if (arg === null) return 'null';
              if (arg === undefined) return 'undefined';
              if (typeof arg === 'object') {
                try {
                  // Extract only key names without values for sensitive objects
                  return `Object with keys: [${Object.keys(arg).join(', ')}]`;
                } catch (e) {
                  return 'Unserializable object';
                }
              }
              return String(arg).substring(0, 100); // Truncate long strings
            }),
            timestamp: new Date().toISOString(),
            errorType: error.name || 'Error',
            errorCode: error.code || 'UNKNOWN',
            hookType: hookName.includes(':') ? hookName.split(':')[0] : 'general',
          },
          'Error executing plugin hook'
        );

        // Track the hook execution with error
        safeHealthCheck(
          'trackPluginFunctionCall',
          handler.pluginId,
          `hook:${hookName}`,
          { args: args.map(arg => String(arg).substring(0, 100)) },
          { success: false, error: error.message }
        );

        results.push({
          success: false,
          error,
          pluginId: handler.pluginId,
          hookName,
        });
      }
    }
    return results;
  } catch (error) {
    // Track the error with the general 'plugins' category
    safeHealthCheck('trackError', 'plugins', null, `hook:${hookName}`);

    // Get hook type for better categorization
    const hookType = hookName.includes(':') ? hookName.split(':')[0] : 'general';

    // Log detailed error information
    logger.error(
      {
        message: error.message,
        stack: error.stack,
        hookName,
        context: 'executeHook',
        hookType,
        args: args.map(arg => {
          if (arg === null) return 'null';
          if (arg === undefined) return 'undefined';
          if (typeof arg === 'object') {
            try {
              // Extract only key names without values for sensitive objects
              return `Object with keys: [${Object.keys(arg).join(', ')}]`;
            } catch (e) {
              return 'Unserializable object';
            }
          }
          return String(arg).substring(0, 100); // Truncate long strings
        }),
        timestamp: new Date().toISOString(),
        errorType: error.name || 'Error',
        errorCode: error.code || 'UNKNOWN',
        // Include information about registered handlers to help debug
        registeredHandlersCount: hookHandlers ? hookHandlers.length : 0,
        // Include registered plugin IDs for this hook to help identify potential culprits
        registeredPluginsForHook: hookHandlers ? hookHandlers.map(h => h.pluginId) : [],
      },
      `Error executing hook: ${hookName}`
    );

    return [{ success: false, error, hookName }];
  }
}

/**
 * Get metadata for all registered plugins
 *
 * @returns {Object} An object containing metadata for all plugins
 */
function getPluginMetadata() {
  return plugins.metadata;
}

/**
 * Disable a plugin by ID
 *
 * @param {string} pluginId - The ID of the plugin to disable
 * @returns {boolean} True if the plugin was disabled, false otherwise
 */
function disablePlugin(pluginId) {
  if (!plugins.metadata[pluginId]) {
    logger.warn({ pluginId }, 'Plugin not found');
    return false;
  }

  plugins.metadata[pluginId].enabled = false;
  logger.info({ pluginId }, 'Disabled plugin');
  return true;
}

/**
 * Enable a plugin by ID
 *
 * @param {string} pluginId - The ID of the plugin to enable
 * @returns {boolean} True if the plugin was enabled, false otherwise
 */
function enablePlugin(pluginId) {
  if (!plugins.metadata[pluginId]) {
    logger.warn({ pluginId }, 'Plugin not found');
    return false;
  }

  plugins.metadata[pluginId].enabled = true;
  logger.info({ pluginId }, 'Enabled plugin');
  return true;
}

/**
 * Track a plugin conflict in the plugin metadata
 *
 * @param {string} pluginId - ID of the plugin with the conflict
 * @param {string} conflictType - Type of conflict (command, slashCommand, function, hook)
 * @param {string} itemName - Name of the conflicting item
 * @param {string} existingSource - Source of the existing item causing the conflict
 */
function trackPluginConflict(pluginId, conflictType, itemName, existingSource) {
  // Make sure the plugin exists
  if (!plugins.metadata[pluginId]) {
    logger.warn({ pluginId }, 'Cannot track conflict for unknown plugin');
    return;
  }

  // Initialize conflicts array if it doesn't exist
  if (!plugins.metadata[pluginId].conflicts) {
    plugins.metadata[pluginId].conflicts = [];
  }

  // Add the conflict to the plugin metadata
  plugins.metadata[pluginId].conflicts.push({
    type: conflictType,
    name: itemName,
    existingSource: existingSource,
    timestamp: new Date().toISOString(),
  });

  logger.debug(
    {
      pluginId,
      conflictType,
      itemName,
      existingSource,
    },
    'Tracked plugin conflict'
  );
}

/**
 * Get a command from a specific plugin
 *
 * @param {string} pluginId - ID of the plugin
 * @param {string} commandName - Name of the command
 * @returns {Object|null} The command object or null if not found
 */
function getPluginCommand(pluginId, commandName) {
  // Check if the command exists
  const command = plugins.commands[commandName];

  // Check if the command belongs to the specified plugin
  if (command && command.pluginId === pluginId) {
    return command;
  }

  return null;
}

/**
 * Get a function from a specific plugin
 *
 * @param {string} pluginId - ID of the plugin
 * @param {string} functionName - Name of the function
 * @returns {Object|null} The function object or null if not found
 */
function getPluginFunction(pluginId, functionName) {
  // Check if the function exists
  const func = plugins.functions[functionName];

  // Check if the function belongs to the specified plugin
  if (func && func.pluginId === pluginId) {
    return func;
  }

  return null;
}

/**
 * Get a hook from a specific plugin
 *
 * @param {string} pluginId - ID of the plugin
 * @param {string} hookName - Name of the hook
 * @returns {Object|null} The hook object or null if not found
 */
function getPluginHook(pluginId, hookName) {
  // Check if the hook type exists
  if (!plugins.hooks[hookName]) {
    return null;
  }

  // Find the hook for the specified plugin
  const hook = plugins.hooks[hookName].find(h => h.pluginId === pluginId);

  return hook || null;
}

module.exports = {
  loadPlugins,
  registerPlugin,
  executeHook,
  executeFunction,
  getAllCommands,
  getPluginMetadata,
  enablePlugin,
  disablePlugin,
  getPluginCommand,
  getPluginFunction,
  getPluginHook,
  trackPluginConflict,
};
