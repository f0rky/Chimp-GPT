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
const { updatePluginStats, trackPluginFunctionCall, trackError } = require('./healthCheck');

// Create a logger for the plugin manager
const logger = createLogger('plugins');

// Store registered plugins
const plugins = {
  commands: {},
  functions: {},
  hooks: {},
  metadata: {}
};

/**
 * Register a plugin with the plugin manager
 * 
 * @param {Object} plugin - The plugin object to register
 * @returns {boolean} True if registration was successful, false otherwise
 */
/**
 * Register a plugin with the plugin manager.
 *
 * @param {Plugin} plugin - The plugin object to register
 * @returns {boolean} True if registration was successful, false otherwise
 */
function registerPlugin(plugin) {
  try {
    // Validate plugin structure
    if (!plugin || !plugin.id || !plugin.name || !plugin.version) {
      logger.error({ plugin, pluginId: plugin?.id || 'unknown', pluginVersion: plugin?.version || 'unknown' }, 'Invalid plugin structure');
      return false;
    }

    // Check if plugin is already registered
    if (plugins.metadata[plugin.id]) {
      logger.warn({ pluginId: plugin.id, pluginVersion: plugin.version }, 'Plugin already registered');
      return false;
    }

    // Register plugin metadata
    plugins.metadata[plugin.id] = {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description || '',
      author: plugin.author || 'Unknown',
      enabled: true
    };

    logger.info({ 
      pluginId: plugin.id, 
      pluginName: plugin.name,
      pluginVersion: plugin.version
    }, 'Registered plugin');

    // Register commands
    if (plugin.commands && Array.isArray(plugin.commands)) {
      plugin.commands.forEach(command => {
        if (command && command.name && typeof command.execute === 'function') {
          plugins.commands[command.name] = {
            ...command,
            pluginId: plugin.id
          };
          logger.debug({ 
            pluginId: plugin.id, 
            commandName: command.name 
          }, 'Registered command');
        } else {
          logger.warn({ 
            pluginId: plugin.id, 
            command 
          }, 'Invalid command structure');
        }
      });
    }

    // Register functions
    if (plugin.functions && typeof plugin.functions === 'object') {
      Object.keys(plugin.functions).forEach(functionName => {
        if (typeof plugin.functions[functionName] === 'function') {
          plugins.functions[functionName] = {
            execute: plugin.functions[functionName],
            pluginId: plugin.id
          };
          logger.debug({ 
            pluginId: plugin.id, 
            functionName 
          }, 'Registered function');
        } else {
          logger.warn({ 
            pluginId: plugin.id, 
            functionName 
          }, 'Invalid function');
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
            pluginId: plugin.id
          });
          logger.debug({ 
            pluginId: plugin.id, 
            hookName 
          }, 'Registered hook');
        } else {
          logger.warn({ 
            pluginId: plugin.id, 
            hookName 
          }, 'Invalid hook');
        }
      });
    }

    return true;
  } catch (error) {
    logger.error({ 
      error, 
      pluginId: plugin?.id || 'unknown',
      pluginVersion: plugin?.version || plugins.metadata?.[plugin?.id]?.version || 'unknown',
      context: 'registerPlugin',
      pluginName: plugin?.name || 'unknown'
    }, 'Error registering plugin');
    return false;
  }
}

/**
 * Load all plugins from the plugins directory
 * 
 * @returns {Promise<number>} The number of successfully loaded plugins
 */
/**
 * Load all plugins from the plugins directory and register them.
 *
 * @returns {Promise<number>} The number of successfully loaded plugins
 */
async function loadPlugins() {
  try {
    const pluginsDir = path.join(__dirname, 'plugins');
    
    // Create plugins directory if it doesn't exist
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
      logger.info('Created plugins directory');
    }
    
    // Get all plugin directories
    const pluginFolders = fs.readdirSync(pluginsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    let loadedCount = 0;
    let commandCount = 0;
    let functionCount = 0;
    let hookCount = 0;
    
    // Load each plugin
    for (const folder of pluginFolders) {
      try {
        const pluginPath = path.join(pluginsDir, folder);
        const mainFile = path.join(pluginPath, 'index.js');
        
        // Skip if main file doesn't exist
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
        logger.error({ 
          error, 
          folder, 
          pluginId: plugin?.id || 'unknown',
          pluginVersion: plugin?.version || plugins.metadata?.[plugin?.id]?.version || 'unknown'
        }, 'Error loading plugin');
      }
    }
    
    // Update plugin statistics
    await updatePluginStats({
      loaded: loadedCount,
      commands: commandCount,
      functions: functionCount,
      hooks: hookCount
    });
    
    logger.info({ 
      loadedCount,
      commandCount,
      functionCount,
      hookCount 
    }, 'Loaded plugins');
    
    return loadedCount;
  } catch (error) {
    logger.error({ error, context: 'loadPlugins' }, 'Error loading plugins');
    return 0;
  }
}

/**
 * Get a registered command by name
 * 
 * @param {string} commandName - The name of the command to get
 * @returns {Object|null} The command object or null if not found
 */
/**
 * Get a registered command by name.
 *
 * @param {string} commandName - The name of the command to get
 * @returns {PluginCommand|null} The command object or null if not found
 */
function getCommand(commandName) {
  return plugins.commands[commandName] || null;
}

/**
 * Get all registered commands
 * 
 * @returns {Object} An object containing all registered commands
 */
/**
 * Get all registered commands.
 *
 * @returns {Object.<string, PluginCommand>} An object containing all registered commands
 */
function getAllCommands() {
  return { ...plugins.commands };
}

/**
 * Execute a function from a plugin
 * 
 * @param {string} functionName - The name of the function to execute
 * @param {...any} args - Arguments to pass to the function
 * @returns {Promise<Object>} Standardized result: { success, data, error, pluginId, functionName }
 * Always returns an object. Never throws.
 */
/**
 * Standardized error handling: always returns an object:
 *   { success: true, data, pluginId, functionName } on success
 *   { success: false, error, pluginId, functionName } on error
 * Never throws. Errors are always logged with stack trace and context.
 */
async function executeFunction(functionName, ...args) {
  let func;
  try {
    func = plugins.functions[functionName];
    if (!func) {
      throw new Error(`Plugin function '${functionName}' not found`);
    }
    
    // Execute the function
    const result = await func.execute(...args);
    // Track the function call
    await trackPluginFunctionCall(
      func.pluginId,
      functionName,
      { args: args.map(arg => String(arg).substring(0, 100)) }, // Truncate args for storage
      { success: true, result: result }
    );
    
    return { success: true, data: result, pluginId: func.pluginId, functionName };
  } catch (error) {
    // Track the error
    if (func && func.pluginId) {
      trackError('plugins', func.pluginId);
    } else {
      trackError('plugins');
    }
    // Log the error
    logger.error({
      message: error.message,
      stack: error.stack,
      functionName,
      pluginId: func?.pluginId,
      pluginVersion: func?.pluginId ? (plugins.metadata?.[func.pluginId]?.version || 'unknown') : 'unknown'
    }, 'Error executing plugin function');
    // Track the function call with error
    if (func && func.pluginId) {
      await trackPluginFunctionCall(
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
 * Execute a hook for all plugins that implement it
 * 
 * @param {string} hookName - The name of the hook to execute
 * @param {...any} args - Arguments to pass to the hook
 * @returns {Promise<Array<Object>>} Array of standardized results: { success, data, error, pluginId, hookName } for each handler
 * Always returns array of objects. Never throws.
 */
/**
 * Standardized error handling: always returns array of objects:
 *   { success: true, data, pluginId, hookName } on success
 *   { success: false, error, pluginId, hookName } on error
 * Never throws. Errors are always logged with stack trace and context.
 */
async function executeHook(hookName, ...args) {
  const results = [];
  
  try {
    // Get all plugins that implement this hook
    const hookHandlers = plugins.hooks[hookName] || [];
    
    // Execute each hook handler
    for (const handler of hookHandlers) {
      try {
        // Execute the hook
        const result = await handler.execute(...args);

        // Track the hook execution
        await trackPluginFunctionCall(
          handler.pluginId,
          `hook:${hookName}`,
          { args: args.map(arg => String(arg).substring(0, 100)) },
          { success: true, result: result }
        );

        results.push({
          success: true,
          data: result,
          pluginId: handler.pluginId,
          hookName
        });
      } catch (error) {
        // Track the error
        trackError('plugins', handler.pluginId);
        
        // Log the error
        logger.error({
          message: error.message,
          stack: error.stack,
          hookName,
          pluginId: handler.pluginId,
          pluginVersion: handler.pluginId ? (plugins.metadata?.[handler.pluginId]?.version || 'unknown') : 'unknown'
        }, 'Error executing plugin hook');

        // Track the hook execution with error
        await trackPluginFunctionCall(
          handler.pluginId,
          `hook:${hookName}`,
          { args: args.map(arg => String(arg).substring(0, 100)) },
          { success: false, error: error.message }
        );

        results.push({
          success: false,
          error,
          pluginId: handler.pluginId,
          hookName
        });
      }
    }
    return results;
  } catch (error) {
    logger.error({
      message: error.message,
      stack: error.stack,
      hookName,
      context: 'executeHook',
      // No pluginId available here
    }, 'Error executing hooks');
    return [{ success: false, error, hookName }];
  }
}

/**
 * Get metadata for all registered plugins
 * 
 * @returns {Object} An object containing metadata for all plugins
 */
/**
 * Get metadata for all registered plugins.
 *
 * @returns {Object.<string, Object>} An object containing metadata for all plugins
 */
function getPluginMetadata() {
  return { ...plugins.metadata };
}

/**
 * Disable a plugin by ID
 * 
 * @param {string} pluginId - The ID of the plugin to disable
 * @returns {boolean} True if the plugin was disabled, false otherwise
 */
/**
 * Disable a plugin by ID.
 *
 * @param {string} pluginId - The ID of the plugin to disable
 * @returns {boolean} True if the plugin was disabled, false otherwise
 */
function disablePlugin(pluginId) {
  if (!plugins.metadata[pluginId]) {
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
/**
 * Enable a plugin by ID.
 *
 * @param {string} pluginId - The ID of the plugin to enable
 * @returns {boolean} True if the plugin was enabled, false otherwise
 */
function enablePlugin(pluginId) {
  if (!plugins.metadata[pluginId]) {
    return false;
  }
  
  plugins.metadata[pluginId].enabled = true;
  logger.info({ pluginId }, 'Enabled plugin');
  return true;
}

module.exports = {
  registerPlugin,
  loadPlugins,
  getCommand,
  getAllCommands,
  executeFunction,
  executeHook,
  getPluginMetadata,
  disablePlugin,
  enablePlugin
};
