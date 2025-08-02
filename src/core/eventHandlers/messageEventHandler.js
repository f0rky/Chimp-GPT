const { discord: discordLogger } = require('../logger');
const performanceMonitor = require('../../middleware/performanceMonitor');
const { checkUserRateLimit } = require('../../middleware/rateLimiter');
const maliciousUserManager = require('../../utils/maliciousUserManager');
const { enhancedMessageManager } = require('../../utils/enhancedMessageManager');
const { contextExtractionService } = require('../../utils/contextExtractionService');
const {
  trackMessage,
  trackRateLimit,
  isStatsCommand,
  handleStatsCommand,
} = require('../healthCheck');
const { processVersionQuery } = require('../../utils/versionSelfQuery');
const commandHandler = require('../../commands/commandHandler');
const pluginManager = require('../../plugins/pluginManager');
const SimpleChimpGPTFlow = require('../../conversation/flow/SimpleChimpGPTFlow');
const {
  updateMessageById,
  saveConversationsToStorage,
} = require('../../conversation/conversationManagerSelector');

class MessageEventHandler {
  constructor(client, config, dependencies) {
    this.client = client;
    this.config = config;
    this.openai = dependencies.openai;
    this.allowedChannelIDs = dependencies.allowedChannelIDs;
    this.DISABLE_PLUGINS = dependencies.DISABLE_PLUGINS;
    this.inProgressOperations = dependencies.inProgressOperations;
    this.loadingEmoji = dependencies.loadingEmoji;
    this.statusManager = dependencies.statusManager;
    this.pfpManager = dependencies.pfpManager;

    // Initialize message relationships map for legacy compatibility
    this.messageRelationships = new Map();

    // Initialize PocketFlow for conversation processing with PFPManager
    this.pocketFlow = new SimpleChimpGPTFlow(this.openai, this.pfpManager);

    // Set up periodic cleanup for enhanced message relationships
    if (maliciousUserManager.DETECTION_CONFIG.ENHANCED_MESSAGE_MANAGEMENT) {
      this.cleanupInterval = setInterval(
        () => {
          try {
            enhancedMessageManager.cleanupOldRelationships();
          } catch (error) {
            discordLogger.warn({ error }, 'Error during enhanced message cleanup');
          }
        },
        60 * 60 * 1000
      ); // Clean up every hour
    }

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.on('messageCreate', this.handleMessageCreate.bind(this));
    this.client.on('messageDelete', this.handleMessageDelete.bind(this));
    this.client.on('messageUpdate', this.handleMessageUpdate.bind(this));
  }

  async handleMessageCreate(message) {
    // Check if client is ready before processing
    if (!this.client.isReady()) {
      return;
    }

    // Additional check for token to prevent REST errors
    if (!this.client.token || !this.client.rest) {
      discordLogger.debug('Client token or REST not ready, skipping message');
      return;
    }

    // Skip if there's already an operation in progress for this channel
    if (this.inProgressOperations.has(message.channelId)) {
      discordLogger.debug(
        {
          channelId: message.channelId,
          messageId: message.id,
          messagePreview: message.content.substring(0, 50),
          userId: message.author.id,
        },
        'Skipping message - operation already in progress for this channel'
      );
      return;
    }

    // Initialize timer variable
    let messageTimerId = null;

    // Add a debug object to track timing of each step
    const timings = {
      start: Date.now(),
      startTime: Date.now(), // Store for easy access
      steps: [],
      apiCalls: {
        openai: 0,
        weather: 0,
        time: 0,
        wolfram: 0,
        quake: 0,
        gptimage: 0,
      },
    };

    // Helper function to add timing data (optimized for performance)
    const addTiming = (step, extraData = {}) => {
      const now = Date.now();
      const elapsed = now - timings.start;

      // Only track critical timing points to reduce overhead
      const criticalSteps = [
        'start',
        'before_conversation_load',
        'after_conversation_load',
        'before_openai_api_call',
        'after_openai_api_call',
        'before_function_call_handling',
        'after_function_call_handling',
      ];

      if (criticalSteps.includes(step)) {
        timings.steps.push({
          step,
          elapsed,
          ...extraData,
        });
      }

      return elapsed;
    };

    addTiming('start');

    try {
      // Basic checks
      if (message.author.bot) {
        addTiming('bot_author_check', { result: 'ignored' });
        return;
      }
      addTiming('bot_author_check', { result: 'passed' });

      // For messages in DMs or with the ignore prefix, we can return early without any processing
      if (message.channel.isDMBased()) {
        addTiming('dm_check', { result: 'ignored' });
        return;
      }
      addTiming('dm_check', { result: 'passed' });

      if (message.content.startsWith(this.config.IGNORE_MESSAGE_PREFIX)) {
        addTiming('ignore_prefix_check', { result: 'ignored' });
        return;
      }
      addTiming('ignore_prefix_check', { result: 'passed' });

      // Ignore messages from unauthorized channels - quick check that doesn't need any async operations
      if (!this.allowedChannelIDs.includes(message.channelId)) {
        addTiming('channel_auth_check', { result: 'unauthorized' });
        discordLogger.debug(
          { channelId: message.channelId },
          'Ignoring message from unauthorized channel'
        );
        return;
      }
      addTiming('channel_auth_check', { result: 'authorized' });

      // Check if user is blocked for malicious behavior
      if (maliciousUserManager.isUserBlocked(message.author.id)) {
        addTiming('malicious_user_check', { result: 'blocked' });
        discordLogger.info(
          {
            userId: message.author.id,
            channelId: message.channelId,
            messageId: message.id,
          },
          'Ignoring message from blocked user'
        );
        return;
      }
      addTiming('malicious_user_check', { result: 'allowed' });

      // Let PocketFlow handle all conversation decisions - no pre-filtering
      addTiming('response_decision_check', { result: 'delegated_to_pocketflow' });

      // Start the performance timer now that we know we'll process this message
      messageTimerId = performanceMonitor.startTimer('message_processing', {
        userId: message.author.id,
        channelId: message.channelId,
        messageId: message.id,
        messageLength: message.content.length,
      });

      // HIGHEST PRIORITY: Send initial feedback IMMEDIATELY before any other processing
      // This ensures users get immediate feedback that their message was received
      addTiming('before_thinking_message');
      const feedbackPromise = message.channel.send(`${this.loadingEmoji} Thinking...`);

      // Track message for stats - this is fast and helps with metrics
      trackMessage();
      addTiming('after_tracking_message');

      // Time how long it takes to get the feedback message
      feedbackPromise
        .then(msg => {
          addTiming('thinking_message_sent', { messageId: msg.id });
        })
        .catch(err => {
          addTiming('thinking_message_error', { error: err.message });
        });

      // Now that we've sent the initial feedback, we can perform the rest of the checks
      // in parallel with receiving the feedback message

      // Start plugin message hooks execution in the background
      // This prevents plugins from blocking the main message processing flow
      addTiming('before_plugin_execution');

      // Check if plugins are disabled
      const pluginTimerId = performanceMonitor.startTimer('plugin_execution', {
        hook: 'onMessageReceived',
      });

      if (this.DISABLE_PLUGINS) {
        // Skip plugin execution when disabled
        const _pluginPromiseSkipped = Promise.resolve([]);
        const pluginDuration = addTiming('plugin_execution_skipped');
        performanceMonitor.stopTimer(pluginTimerId, {
          success: true,
          pluginCount: 0,
          skipped: true,
          duration: pluginDuration,
        });
        discordLogger.info('Plugins disabled, skipping execution for better performance');
      } else {
        // Normal plugin execution path
        const _pluginPromise = pluginManager
          .executeHook('onMessageReceived', message)
          .then(hookResults => {
            const pluginDuration = addTiming('plugin_execution_complete', {
              pluginCount: hookResults.length,
            });
            performanceMonitor.stopTimer(pluginTimerId, {
              success: true,
              pluginCount: hookResults.length,
              duration: pluginDuration,
            });

            // Log if any plugin would have stopped processing
            if (hookResults.some(result => result.result === false)) {
              discordLogger.debug(
                {
                  pluginId: hookResults.find(r => r.result === false)?.pluginId,
                  messageId: message.id,
                },
                'Plugin would have stopped message processing (async execution)'
              );
            }
            return hookResults;
          })
          .catch(hookError => {
            addTiming('plugin_execution_error', { error: hookError.message });
            discordLogger.error({ error: hookError }, 'Error executing message hooks');
            return []; // Return empty array to allow processing to continue
          });
      }

      // Check if this is a stats command - can be checked quickly
      addTiming('before_stats_command_check');
      if (isStatsCommand(message)) {
        addTiming('stats_command_detected');
        const feedbackMessage = await feedbackPromise; // Make sure we have the feedback message first
        await feedbackMessage.delete().catch(() => {
          /* Ignore deletion errors */
        }); // Delete the thinking message
        await handleStatsCommand(message);
        addTiming('stats_command_handled');
        return;
      }
      addTiming('after_stats_command_check');

      // Try to handle the message as a command
      addTiming('before_command_handling');
      const isCommand = await commandHandler.handleCommand(message, this.config);
      addTiming('after_command_handling', { wasCommand: isCommand });
      if (isCommand) {
        // If it was a command, delete the thinking message and exit
        const feedbackMessage = await feedbackPromise;
        await feedbackMessage.delete().catch(() => {
          /* Ignore deletion errors */
        });
        return;
      }

      // Check rate limit for the user
      // OpenAI calls are expensive, so we use a cost of 1 for regular messages
      addTiming('before_rate_limit_check');
      const rateLimitResult = await checkUserRateLimit(message.author.id, 1, {
        // Allow 30 requests per 30 seconds for better responsiveness
        points: 30,
        duration: 30,
      });
      addTiming('after_rate_limit_check', {
        limited: rateLimitResult.limited,
        remainingPoints: rateLimitResult.remainingPoints,
      });

      // If user is rate limited, update the feedback message and exit
      if (rateLimitResult.limited) {
        discordLogger.info(
          {
            userId: message.author.id,
            username: message.author.username,
            secondsBeforeNext: rateLimitResult.secondsBeforeNext,
          },
          'User rate limited'
        );

        // Track rate limit in health check system
        trackRateLimit(message.author.id);

        // Update the feedback message instead of sending a new one
        const feedbackMessage = await feedbackPromise;
        await feedbackMessage.edit(`⏱️ ${rateLimitResult.message}`);
        addTiming('rate_limit_message_edited');
        return;
      }

      // By this point, we have sent the thinking message and all checks have passed
      addTiming('all_checks_passed');

      discordLogger.info(
        {
          message: message.content,
          author: message.author.username,
          channelId: message.channelId,
          messageId: message.id,
          remainingPoints: rateLimitResult.remainingPoints,
        },
        'Processing message'
      );

      // Await the feedback message if we haven't already
      const feedbackMessage = await feedbackPromise;
      addTiming('feedback_message_confirmed');

      // Mark channel as having an operation in progress
      this.inProgressOperations.add(message.channelId);

      // Track conversation for status updates
      addTiming('before_status_update');
      this.statusManager.trackConversation(message.author.username, message.content);
      addTiming('after_status_update');

      // Check if this is a version query
      const versionResponse = processVersionQuery(message.content, this.config);
      if (versionResponse) {
        // Track this as a successful API call for stats
        // trackApiCall is imported from healthCheck but not used here - keeping for consistency

        // Update the feedback message with the version response
        await feedbackMessage.edit(versionResponse.content);

        // Context preservation handled by PocketFlow conversation state

        // Version responses are handled by PocketFlow conversation state

        return;
      }

      // Log if this is a reply to another message
      if (message.reference) {
        discordLogger.info(
          {
            originalMessageId: message.id,
            referencedMessageId: message.reference.messageId,
          },
          'Message is a reply to another message'
        );
      }

      // Check for image generation requests and bypass PocketFlow for performance
      const lowerContent = message.content.toLowerCase().trim();
      const imagePhrases = [
        /^draw (?:me |us |a |an |the )?/i,
        /^generate (?:me |us |a |an |the )?(?:image|picture|photo)/i,
        /^create (?:me |us |a |an |the )?(?:image|picture|photo)/i,
        /^make (?:me |us |a |an |the )?(?:image|picture|photo)/i,
        /^show (?:me |us )?(?:a |an |the )?(?:image|picture|photo) (?:of|for)/i,
        /^(?:generate|create|make) (?:me |us )?an? image (?:of|for|showing)/i,
        /^i (?:need|want) (?:a|an|the) (?:image|picture|photo) (?:of|for)/i,
      ];

      const isImageRequest = imagePhrases.some(regex => regex.test(lowerContent));

      if (isImageRequest) {
        discordLogger.debug('Bypassing PocketFlow for image generation request', {
          content: message.content.substring(0, 50) + '...',
        });

        // Clean up the prompt by removing the command phrases
        let cleanPrompt = message.content;
        for (const phrase of imagePhrases) {
          cleanPrompt = cleanPrompt.replace(phrase, '').trim();
        }

        // Import and call the image generation handler directly
        const { handleImageGeneration } = require('../../handlers/imageGenerationHandler');

        // Process the image generation request directly
        try {
          addTiming('before_image_generation');
          const imageResult = await handleImageGeneration(
            { prompt: cleanPrompt },
            await feedbackPromise,
            [], // empty conversation log for bypass
            Date.now(),
            {}, // usage
            {}, // timings
            (startTime, _usage, _functionTimings) => {
              const elapsed = Date.now() - startTime;
              return `\n\n⏱️ Generated in ${Math.round(elapsed / 1000)}s`;
            },
            () => {
              /* storeMessageRelationship placeholder */
            }, // storeMessageRelationship
            this.statusManager
          );
          addTiming('after_image_generation');

          // Image generation was handled directly, skip PocketFlow
          discordLogger.info('Image generation completed via bypass', {
            messageId: message.id,
            success: !!imageResult,
          });
          return;
        } catch (error) {
          discordLogger.error('Image generation bypass failed, falling back to PocketFlow', {
            error: error.message,
            messageId: message.id,
          });
          // Fall through to PocketFlow processing
        }
      }

      // Use PocketFlow for conversation processing
      addTiming('before_pocketflow_processing');

      // Process message with PocketFlow
      const flowResult = await this.pocketFlow.processMessage(message);
      addTiming('after_pocketflow_processing', {
        success: flowResult.success,
        type: flowResult.type,
      });

      // Send PocketFlow response back to Discord
      if (flowResult.response) {
        const responseFeedbackMessage = await feedbackPromise;
        if (responseFeedbackMessage) {
          // Check if this is an image response with attachment
          if (flowResult.type === 'image' && flowResult.attachment) {
            await responseFeedbackMessage.edit({
              content: flowResult.response,
              files: [
                {
                  attachment: flowResult.attachment.buffer,
                  name: flowResult.attachment.name,
                },
              ],
            });
            addTiming('after_image_attachment_message');
          } else {
            await responseFeedbackMessage.edit(flowResult.response);
            addTiming('after_edit_message');
          }

          // Store enhanced message relationship for deletion tracking
          try {
            const context = contextExtractionService.extractContext(message.content, {
              type: flowResult.type,
              conversationLength: flowResult.conversationLength || 0,
              functionType: flowResult.functionType,
              imageContext: flowResult.imageContext,
              conversationTheme: flowResult.conversationTheme,
            });

            enhancedMessageManager.storeRelationship(
              message.id,
              responseFeedbackMessage,
              {
                id: message.author.id,
                username: message.author.username,
                displayName: message.author.displayName,
              },
              context
            );

            addTiming('after_relationship_storage');
          } catch (relationshipError) {
            discordLogger.warn(
              {
                error: relationshipError,
                messageId: message.id,
              },
              'Failed to store enhanced message relationship'
            );
          }
        }
      } else {
        // If no response, provide fallback message
        const responseFeedbackMessage = await feedbackPromise;
        if (responseFeedbackMessage) {
          await responseFeedbackMessage.edit(
            '❌ I encountered an issue processing your message. Please try again.'
          );
          addTiming('after_fallback_message');
        }
      }

      // Log complete timing data
      const totalDuration = Date.now() - timings.start;
      discordLogger.info(
        {
          message_id: message.id,
          user_id: message.author.id,
          total_duration_ms: totalDuration,
          step_count: timings.steps.length,
          timings: timings.steps.map(step => ({
            step: step.step,
            elapsed_ms: step.elapsed,
            ...Object.entries(step)
              .filter(([key]) => !['step', 'time', 'elapsed'].includes(key))
              .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {}),
          })),
          response_type: flowResult?.type || 'error_or_unknown',
        },
        `Message processing completed in ${totalDuration}ms with ${timings.steps.length} steps tracked`
      );
    } catch (error) {
      // Add timing for errors
      const addErrorTiming = (step, extraData = {}) => {
        const now = Date.now();
        const elapsed = now - timings.start;
        timings.steps.push({
          step,
          time: now,
          elapsed,
          ...extraData,
        });
        return elapsed;
      };
      addErrorTiming('processing_error', { error: error.message });

      discordLogger.error(
        {
          error,
          timing_data: timings,
        },
        'Error in message handler'
      );

      // Try to send an error message to the channel
      if (this.client.isReady() && message.channel) {
        try {
          await message.channel.send('❌ Sorry, I encountered an error processing your request.');
        } catch (sendError) {
          discordLogger.error({ error: sendError }, 'Failed to send error message to channel');
        }
      }

      // Stop the timer with error information if it was started
      if (messageTimerId) {
        performanceMonitor.stopTimer(messageTimerId, {
          success: false,
          error: error.message,
        });
      }
    } finally {
      // Always clear the in-progress flag when done
      this.inProgressOperations.delete(message.channelId);

      // Always stop the timer if it was started and hasn't been stopped yet
      if (messageTimerId) {
        const addFinalTiming = (step, extraData = {}) => {
          const now = Date.now();
          const elapsed = now - timings.start;
          timings.steps.push({
            step,
            time: now,
            elapsed,
            ...extraData,
          });
          return elapsed;
        };
        const finalTiming = addFinalTiming('processing_complete');
        performanceMonitor.stopTimer(messageTimerId, {
          success: true,
          totalDuration: finalTiming,
        });
      }
    }
  }

  async handleMessageDelete(message) {
    try {
      // Only process messages from allowed channels
      if (!this.allowedChannelIDs.includes(message.channelId)) {
        return;
      }

      // Skip if no message ID (shouldn't happen but safety check)
      if (!message.id) {
        return;
      }

      // Skip bot messages - they don't count for malicious behavior tracking
      if (message.author?.bot) {
        return;
      }

      // Calculate time since message creation for malicious behavior detection
      const timeSinceCreation = message.createdAt ? Date.now() - message.createdAt.getTime() : 0;

      discordLogger.info(
        {
          messageId: message.id,
          channelId: message.channelId,
          authorId: message.author?.id,
          content: message.content?.substring(0, 100), // Log first 100 chars for context
          timeSinceCreation,
        },
        'Message deleted, removing from conversation history'
      );

      // Track deletion for malicious behavior detection
      if (message.author?.id) {
        try {
          await maliciousUserManager.recordDeletion(
            message.author.id,
            message.id,
            message.channelId,
            message.content,
            timeSinceCreation,
            message // Pass full message object for WebUI storage
          );

          // Check for suspicious behavior and potentially trigger human approval
          await maliciousUserManager.checkForSuspiciousBehavior(message.author.id, this.client);
        } catch (error) {
          discordLogger.error(
            { error, userId: message.author.id },
            'Error tracking message deletion'
          );
        }
      }

      // Determine if this is a DM
      const _isDM = message.channel?.isDMBased() || false;

      // PocketFlow manages conversation state internally

      // Use enhanced message management system if enabled
      if (maliciousUserManager.DETECTION_CONFIG.ENHANCED_MESSAGE_MANAGEMENT) {
        try {
          const enhancedResult = await enhancedMessageManager.processDeletion(message);

          discordLogger.info(
            {
              messageId: message.id,
              userId: message.author?.id,
              action: enhancedResult.action,
              success: enhancedResult.success,
              reason: enhancedResult.reason,
            },
            'Enhanced deletion processing completed'
          );

          // If enhanced processing succeeded, skip legacy handling
          if (enhancedResult.success) {
            // Save conversations after enhanced processing
            await saveConversationsToStorage();
            return;
          }
        } catch (enhancedError) {
          discordLogger.error(
            {
              error: enhancedError,
              messageId: message.id,
            },
            'Enhanced deletion processing failed, falling back to legacy'
          );
        }
      }

      // Fallback to legacy message relationship handling
      const relationship = this.messageRelationships.get(message.id);
      if (relationship) {
        try {
          const { botMessage, userInfo, context } = relationship;

          // Update the bot message to show context about the deleted user message
          const username = userInfo.username || userInfo.displayName || 'Unknown User';
          const contextText = context.substring(0, 100) + (context.length > 100 ? '...' : '');

          // Get user's deletion count for better comment template selection
          const userStats = maliciousUserManager.getUserStats(message.author.id);
          const deleteCount = userStats.totalDeletions;

          // Use the new comment template system
          const updatedContent = maliciousUserManager.getDeletionComment(
            message.author.id,
            username,
            contextText,
            deleteCount
          );

          // Edit the bot message to preserve context
          await botMessage.edit(updatedContent);

          // Link the deleted message to the bot response for WebUI tracking
          await maliciousUserManager.linkDeletedMessageToBotResponse(message.id, botMessage.id);

          discordLogger.info(
            {
              deletedMessageId: message.id,
              botMessageId: botMessage.id,
              username,
              contextType: context.type,
              deleteCount,
              isOwner: maliciousUserManager.isOwner(message.author.id),
            },
            'Updated bot response after user message deletion (legacy)'
          );

          // Remove the relationship since it's no longer needed
          this.messageRelationships.delete(message.id);
        } catch (updateError) {
          discordLogger.error(
            { error: updateError, messageId: message.id },
            'Failed to update bot response after message deletion'
          );
        }
      }

      // Save conversations after removal
      await saveConversationsToStorage();
    } catch (error) {
      discordLogger.error({ error, messageId: message.id }, 'Error handling message deletion');
    }
  }

  async handleMessageUpdate(oldMessage, newMessage) {
    try {
      // Only process messages from allowed channels
      if (!this.allowedChannelIDs.includes(newMessage.channelId)) {
        return;
      }

      // Skip if no message ID or content
      if (!newMessage.id || !newMessage.content) {
        return;
      }

      // Skip bot messages (we don't store them in conversations anyway)
      if (newMessage.author?.bot) {
        return;
      }

      discordLogger.info(
        {
          messageId: newMessage.id,
          channelId: newMessage.channelId,
          authorId: newMessage.author?.id,
          oldContent: oldMessage.content?.substring(0, 50),
          newContent: newMessage.content?.substring(0, 50),
        },
        'Message edited, updating conversation history'
      );

      // Determine if this is a DM
      const isDM = newMessage.channel?.isDMBased() || false;

      // Update in conversation history
      if (isDM) {
        // For DMs, update using the author's user ID as the key
        const updated = await updateMessageById(
          newMessage.author?.id,
          newMessage.id,
          newMessage.content
        );
        if (updated) {
          discordLogger.debug(
            { messageId: newMessage.id },
            'Updated edited message in DM conversation'
          );
        }
      } else {
        // For channels, update using channel ID
        const updated = await updateMessageById(
          newMessage.channelId,
          newMessage.id,
          newMessage.content,
          isDM
        );
        if (updated) {
          discordLogger.debug(
            { messageId: newMessage.id },
            'Updated edited message in channel conversation'
          );
        }
      }

      // Save conversations after update
      await saveConversationsToStorage();
    } catch (error) {
      discordLogger.error({ error, messageId: newMessage.id }, 'Error handling message update');
    }
  }
}

module.exports = MessageEventHandler;
