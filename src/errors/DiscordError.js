/**
 * Discord Error Class for ChimpGPT
 *
 * This error class is used for errors related to Discord API operations.
 *
 * @module DiscordError
 * @author Brett
 * @version 1.0.0
 */

const ApiError = require('./ApiError');

/**
 * Error class for Discord-related errors
 *
 * @class DiscordError
 * @extends ApiError
 */
class DiscordError extends ApiError {
  /**
   * Create a new DiscordError
   *
   * @param {string} message - Error message
   * @param {Object} options - Additional error options
   * @param {string} [options.guildId] - ID of the guild where the error occurred
   * @param {string} [options.channelId] - ID of the channel where the error occurred
   * @param {string} [options.userId] - ID of the user related to the error
   * @param {string} [options.messageId] - ID of the message related to the error
   * @param {string} [options.interactionId] - ID of the interaction related to the error
   * @param {string} [options.commandName] - Name of the command that failed
   * @param {Object} [options.permissions] - Permission issues that caused the error
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code || 'DISCORD_ERROR',
      service: 'discord',
      component: 'discord',
    });

    // Add Discord-specific properties
    this.guildId = options.guildId;
    this.channelId = options.channelId;
    this.userId = options.userId;
    this.messageId = options.messageId;
    this.interactionId = options.interactionId;
    this.commandName = options.commandName;
    this.permissions = options.permissions;

    // Include Discord details in context
    this.context = {
      ...this.context,
      guildId: this.guildId,
      channelId: this.channelId,
      userId: this.userId,
      messageId: this.messageId,
      interactionId: this.interactionId,
      commandName: this.commandName,
      permissions: this.permissions,
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
      guildId: this.guildId,
      channelId: this.channelId,
      userId: this.userId,
      messageId: this.messageId,
      interactionId: this.interactionId,
      commandName: this.commandName,
      permissions: this.permissions,
    };
  }

  /**
   * Check if the error is related to missing permissions
   *
   * @returns {boolean} True if the error is related to missing permissions
   */
  isPermissionError() {
    return (
      this.code === 'MISSING_PERMISSIONS' ||
      this.statusCode === 403 ||
      (this.message && this.message.includes('permission'))
    );
  }

  /**
   * Check if the error is related to rate limiting
   *
   * @returns {boolean} True if the error is related to rate limiting
   */
  isRateLimitError() {
    return (
      this.code === 'RATE_LIMITED' ||
      this.statusCode === 429 ||
      (this.message && this.message.includes('rate limit'))
    );
  }
}

module.exports = DiscordError;
