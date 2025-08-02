/**
 * Discord Message Response Executor
 *
 * Handles actual Discord API calls for implementing review action outcomes
 * in the Enhanced Message Deletion Management System. Provides methods to
 * update, delete, and create Discord messages based on review decisions.
 *
 * @module DiscordMessageExecutor
 */

const { createLogger } = require('../core/logger');
const { ENHANCED_TEMPLATES } = require('./enhancedMessageManager');

const logger = createLogger('discordMessageExecutor');

/**
 * Discord Message Response Executor
 * Handles actual Discord message operations for review actions
 */
class DiscordMessageExecutor {
  constructor(client) {
    this.client = client;
  }

  /**
   * Execute review action by performing actual Discord operations
   * @param {Object} message - Deleted message record
   * @param {string} action - Review action (approved, flagged, ignored, banned)
   * @param {Object} actionResult - Result from applyReviewAction
   * @returns {Object} Execution result
   */
  async executeReviewAction(message, action, actionResult) {
    try {
      switch (actionResult.userAction) {
        case 'update_response_with_context':
          return await this.updateResponseWithContext(message);

        case 'warning_issued_with_response':
          return await this.issueWarningWithResponse(message);

        case 'delete_bot_response':
          return await this.deleteBotResponse(message);

        case 'user_blocked':
          return await this.handleUserBlocked(message);

        case 'none':
        default:
          return {
            success: true,
            action: 'no_discord_action',
            message: 'No Discord API action required',
          };
      }
    } catch (error) {
      logger.error(
        {
          error,
          messageId: message.messageId,
          action,
          userAction: actionResult.userAction,
        },
        'Error executing review action'
      );

      return {
        success: false,
        error: error.message,
        action: 'execution_failed',
      };
    }
  }

  /**
   * Update bot response with deletion context
   * @param {Object} message - Deleted message record
   * @returns {Object} Execution result
   */
  async updateResponseWithContext(message) {
    if (!message.botResponseId) {
      return {
        success: false,
        error: 'No bot response ID available',
        action: 'no_bot_response',
      };
    }

    try {
      // Find the bot message
      const botMessage = await this.findBotMessage(message.botResponseId, message.channelId);
      if (!botMessage) {
        return {
          success: false,
          error: 'Bot message not found',
          action: 'bot_message_not_found',
        };
      }

      // Generate context-aware response
      const contextualResponse = this.generateContextualResponse(message);

      // Update the bot message
      await botMessage.edit(contextualResponse);

      logger.info(
        {
          messageId: message.messageId,
          botResponseId: message.botResponseId,
          userId: message.userId,
        },
        'Bot response updated with deletion context'
      );

      return {
        success: true,
        action: 'updated_with_context',
        botMessageId: botMessage.id,
        newContent: contextualResponse,
      };
    } catch (error) {
      logger.error(
        {
          error,
          messageId: message.messageId,
          botResponseId: message.botResponseId,
        },
        'Failed to update bot response with context'
      );

      return {
        success: false,
        error: error.message,
        action: 'update_failed',
      };
    }
  }

  /**
   * Issue warning and preserve bot response
   * @param {Object} message - Deleted message record
   * @returns {Object} Execution result
   */
  async issueWarningWithResponse(message) {
    try {
      // Find the channel
      const channel = await this.findChannel(message.channelId);
      if (!channel) {
        return {
          success: false,
          error: 'Channel not found',
          action: 'channel_not_found',
        };
      }

      // Generate warning message
      const warningMessage = this.generateWarningMessage(message);

      // Send warning message
      const warningResponse = await channel.send(warningMessage);

      // If there's a bot response, we keep it unchanged but add a note
      let botUpdateResult = null;
      if (message.botResponseId) {
        try {
          const botMessage = await this.findBotMessage(message.botResponseId, message.channelId);
          if (botMessage) {
            const flaggedNote = `\n\n⚠️ *This response relates to a flagged message deletion.*`;
            const currentContent = botMessage.content;

            // Only add note if not already present
            if (!currentContent.includes('flagged message deletion')) {
              await botMessage.edit(currentContent + flaggedNote);
              botUpdateResult = {
                updated: true,
                botMessageId: botMessage.id,
              };
            }
          }
        } catch (botError) {
          logger.warn(
            {
              error: botError,
              botResponseId: message.botResponseId,
            },
            'Failed to update bot message with flagged note'
          );
        }
      }

      logger.info(
        {
          messageId: message.messageId,
          userId: message.userId,
          warningMessageId: warningResponse.id,
          botUpdated: !!botUpdateResult?.updated,
        },
        'Warning issued for flagged deletion'
      );

      return {
        success: true,
        action: 'warning_issued',
        warningMessageId: warningResponse.id,
        botUpdate: botUpdateResult,
      };
    } catch (error) {
      logger.error(
        {
          error,
          messageId: message.messageId,
          channelId: message.channelId,
        },
        'Failed to issue warning message'
      );

      return {
        success: false,
        error: error.message,
        action: 'warning_failed',
      };
    }
  }

  /**
   * Delete bot response message
   * @param {Object} message - Deleted message record
   * @returns {Object} Execution result
   */
  async deleteBotResponse(message) {
    if (!message.botResponseId) {
      return {
        success: true,
        action: 'no_bot_response',
        message: 'No bot response to delete',
      };
    }

    try {
      // Find the bot message
      const botMessage = await this.findBotMessage(message.botResponseId, message.channelId);
      if (!botMessage) {
        return {
          success: true,
          action: 'bot_message_already_deleted',
          message: 'Bot message not found (may already be deleted)',
        };
      }

      // Delete the bot message
      await botMessage.delete();

      logger.info(
        {
          messageId: message.messageId,
          botResponseId: message.botResponseId,
          userId: message.userId,
        },
        'Bot response deleted per ignore action'
      );

      return {
        success: true,
        action: 'bot_response_deleted',
        deletedMessageId: message.botResponseId,
      };
    } catch (error) {
      logger.error(
        {
          error,
          messageId: message.messageId,
          botResponseId: message.botResponseId,
        },
        'Failed to delete bot response'
      );

      return {
        success: false,
        error: error.message,
        action: 'delete_failed',
      };
    }
  }

  /**
   * Handle user blocked action
   * @param {Object} message - Deleted message record
   * @returns {Object} Execution result
   */
  async handleUserBlocked(message) {
    try {
      // Send notification to the channel about the user ban
      const channel = await this.findChannel(message.channelId);
      if (channel) {
        try {
          const banNotification =
            `🚫 **User ${message.username} has been blocked** from the bot for suspicious message deletion behavior.\n` +
            `*Message ID: ${message.messageId}*`;

          await channel.send(banNotification);

          logger.info(
            {
              messageId: message.messageId,
              userId: message.userId,
              username: message.username,
              channelId: message.channelId,
            },
            'User ban notification sent to channel'
          );
        } catch (notificationError) {
          logger.warn(
            {
              error: notificationError,
              channelId: message.channelId,
            },
            'Failed to send ban notification to channel'
          );
        }
      }

      // Delete the bot response if it exists
      let deletionResult = null;
      if (message.botResponseId) {
        deletionResult = await this.deleteBotResponse(message);
      }

      return {
        success: true,
        action: 'user_blocked_handled',
        notificationSent: !!channel,
        botResponseDeleted: deletionResult?.success || false,
      };
    } catch (error) {
      logger.error(
        {
          error,
          messageId: message.messageId,
          userId: message.userId,
        },
        'Failed to handle user blocked action'
      );

      return {
        success: false,
        error: error.message,
        action: 'user_blocked_failed',
      };
    }
  }

  /**
   * Find a bot message by ID and channel
   * @param {string} messageId - Message ID to find
   * @param {string} channelId - Channel ID
   * @returns {Object|null} Discord message object or null
   */
  async findBotMessage(messageId, channelId) {
    try {
      const channel = await this.findChannel(channelId);
      if (!channel) return null;

      const message = await channel.messages.fetch(messageId);
      return message;
    } catch (error) {
      logger.debug(
        {
          error: error.message,
          messageId,
          channelId,
        },
        'Bot message not found'
      );
      return null;
    }
  }

  /**
   * Find a channel by ID
   * @param {string} channelId - Channel ID
   * @returns {Object|null} Discord channel object or null
   */
  async findChannel(channelId) {
    try {
      const channel = await this.client.channels.fetch(channelId);
      return channel;
    } catch (error) {
      logger.debug(
        {
          error: error.message,
          channelId,
        },
        'Channel not found'
      );
      return null;
    }
  }

  /**
   * Generate contextual response for approved deletions
   * @param {Object} message - Deleted message record
   * @returns {string} Contextual response
   */
  generateContextualResponse(message) {
    // Use enhanced context if available
    const context = message.enhancedContext;
    let template = ENHANCED_TEMPLATES.contextual_single.default;

    if (context) {
      switch (context.type) {
        case 'image_request':
          template = ENHANCED_TEMPLATES.contextual_single.image;
          break;
        case 'question':
          template = ENHANCED_TEMPLATES.contextual_single.answer;
          break;
        case 'function_call':
          template = ENHANCED_TEMPLATES.contextual_single.function;
          break;
        default:
          // Use default template for unknown context types
          template = ENHANCED_TEMPLATES.contextual_single.default;
          break;
      }
    }

    // Replace template variables
    let response = template;
    response = response.replace(/\{username\}/g, message.username);
    response = response.replace(/\{summary\}/g, this.generateSummary(message));
    response = response.replace(/\{imageContext\}/g, context?.imageContext || 'image generation');
    response = response.replace(/\{functionType\}/g, context?.functionType || 'function call');
    response = response.replace(
      /\{conversationTheme\}/g,
      context?.conversationTheme || context?.theme || 'conversation'
    );

    return response;
  }

  /**
   * Generate warning message for flagged deletions
   * @param {Object} message - Deleted message record
   * @returns {string} Warning message
   */
  generateWarningMessage(message) {
    const template = ENHANCED_TEMPLATES.frequent_deleter.warning;

    let warning = template;
    warning = warning.replace(/\{username\}/g, message.username);
    warning = warning.replace(/\{deleteCount\}/g, message.deletionCount || 1);
    warning = warning.replace(/\{context\}/g, this.generateSummary(message));

    return warning;
  }

  /**
   * Generate summary of deleted message content
   * @param {Object} message - Deleted message record
   * @returns {string} Content summary
   */
  generateSummary(message) {
    if (!message.content && !message.fullContent) {
      return 'their message';
    }

    const content = message.fullContent || message.content;
    if (content.length <= 50) {
      return content;
    }

    return content.substring(0, 50) + '...';
  }

  /**
   * Execute bulk message operations with rate limiting
   * @param {Array} operations - Array of operation objects
   * @param {number} delayMs - Delay between operations in milliseconds
   * @returns {Object} Bulk execution result
   */
  async executeBulkOperations(operations, delayMs = 1000) {
    const results = [];
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];

      try {
        const result = await this.executeOperation(operation);
        results.push({
          operation: operation.type,
          messageId: operation.messageId,
          success: result.success,
          result,
        });

        if (result.success) {
          successful++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error(
          {
            error,
            operation: operation.type,
            messageId: operation.messageId,
          },
          'Bulk operation failed'
        );

        results.push({
          operation: operation.type,
          messageId: operation.messageId,
          success: false,
          error: error.message,
        });
        failed++;
      }

      // Rate limiting delay (except for last operation)
      if (i < operations.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    logger.info(
      {
        totalOperations: operations.length,
        successful,
        failed,
      },
      'Bulk message operations completed'
    );

    return {
      success: true,
      totalOperations: operations.length,
      successful,
      failed,
      results,
    };
  }

  /**
   * Execute a single operation
   * @param {Object} operation - Operation to execute
   * @returns {Object} Operation result
   */
  async executeOperation(operation) {
    switch (operation.type) {
      case 'update_with_context':
        return await this.updateResponseWithContext(operation.message);
      case 'delete_response':
        return await this.deleteBotResponse(operation.message);
      case 'issue_warning':
        return await this.issueWarningWithResponse(operation.message);
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }
}

module.exports = {
  DiscordMessageExecutor,
};
