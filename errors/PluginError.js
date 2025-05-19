/**
 * Plugin Error Class for ChimpGPT
 *
 * This error class is used for errors related to plugin operations.
 *
 * @module PluginError
 * @author Brett
 * @version 1.0.0
 */

const ChimpError = require('./ChimpError');

/**
 * Error class for plugin-related errors
 *
 * @class PluginError
 * @extends ChimpError
 */
class PluginError extends ChimpError {
  /**
   * Create a new PluginError
   *
   * @param {string} message - Error message
   * @param {Object} options - Additional error options
   * @param {string} [options.pluginId] - ID of the plugin
   * @param {string} [options.pluginName] - Name of the plugin
   * @param {string} [options.pluginVersion] - Version of the plugin
   * @param {string} [options.hookName] - Name of the hook that failed
   * @param {string} [options.functionName] - Name of the function that failed
   * @param {string} [options.commandName] - Name of the command that failed
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code || 'PLUGIN_ERROR',
      component: options.component || 'plugin',
    });

    // Add plugin-specific properties
    this.pluginId = options.pluginId || 'unknown';
    this.pluginName = options.pluginName;
    this.pluginVersion = options.pluginVersion;
    this.hookName = options.hookName;
    this.functionName = options.functionName;
    this.commandName = options.commandName;

    // Include plugin details in context
    this.context = {
      ...this.context,
      pluginId: this.pluginId,
      pluginName: this.pluginName,
      pluginVersion: this.pluginVersion,
      hookName: this.hookName,
      functionName: this.functionName,
      commandName: this.commandName,
    };
  }

  /**
   * Get a structured representation of the error for logging
   *
   * @returns {Object} Structured error object
   */
  toJSON() {
    const json = super.toJSON();
    return {
      ...json,
      pluginId: this.pluginId,
      pluginName: this.pluginName,
      pluginVersion: this.pluginVersion,
      hookName: this.hookName,
      functionName: this.functionName,
      commandName: this.commandName,
    };
  }

  /**
   * Get a string representation of the error
   *
   * @returns {string} String representation
   */
  toString() {
    let location = '';

    if (this.hookName) {
      location = `hook: ${this.hookName}`;
    } else if (this.functionName) {
      location = `function: ${this.functionName}`;
    } else if (this.commandName) {
      location = `command: ${this.commandName}`;
    }

    return `${this.name} [${this.code}]: ${this.message} (plugin: ${this.pluginId}${location ? ', ' + location : ''})`;
  }
}

module.exports = PluginError;
