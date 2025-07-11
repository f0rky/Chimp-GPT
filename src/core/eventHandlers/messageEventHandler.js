const { discord: discordLogger } = require('../logger');
const performanceMonitor = require('../../middleware/performanceMonitor');
const { checkUserRateLimit } = require('../../middleware/rateLimiter');
const maliciousUserManager = require('../../../utils/maliciousUserManager');
const {
  trackMessage,
  trackRateLimit,
  isStatsCommand,
  handleStatsCommand,
} = require('../healthCheck');
const { processVersionQuery } = require('../../../utils/versionSelfQuery');
const {
  manageConversation,
  saveConversationsToStorage,
  removeMessageById,
  updateMessageById,
} = require('../../conversation/conversationManagerSelector');
const commandHandler = require('../../commands/commandHandler');
const pluginManager = require('../../plugins/pluginManager');
const MessageProcessor = require('../processors/messageProcessor');
const { generateNaturalResponse } = require('../processors/responseGenerator');
const { detectBotIntent } = require('../../conversation/conversationIntelligence');

class MessageEventHandler {
  constructor(client, config, dependencies) {
    this.client = client;
    this.config = config;
    this.openai = dependencies.openai;
    this.statusManager = dependencies.statusManager;
    this.allowedChannelIDs = dependencies.allowedChannelIDs;
    this.loadingEmoji = dependencies.loadingEmoji;
    this.DISABLE_PLUGINS = dependencies.DISABLE_PLUGINS;
    this.inProgressOperations = dependencies.inProgressOperations;
    this.messageRelationships = dependencies.messageRelationships;
    this.handleFunctionCall = dependencies.handleFunctionCall;
    this.handleDirectMessage = dependencies.handleDirectMessage;
    this.formatSubtext = dependencies.formatSubtext;
    this.storeMessageRelationship = dependencies.storeMessageRelationship;

    // Initialize message processor with conversation intelligence
    this.messageProcessor = new MessageProcessor(this.openai, this.config);

    this.setupEventHandlers();
  }

  /**
   * Determine if the bot should respond to a message based on existing conversation intelligence
   * @param {Object} message - Discord message object
   * @returns {boolean} Whether the bot should respond
   */
  shouldRespondToMessage(message) {
    // Always respond to direct commands (! or /) - these are explicit bot interactions
    if (/^[!/]/.test(message.content.trim())) {
      discordLogger.debug(
        {
          messagePreview: message.content.substring(0, 50),
          messageId: message.id,
          userId: message.author.id,
        },
        'Bot will respond - message is a direct command'
      );
      return true;
    }

    // Check for bot-directed intent using existing conversation intelligence
    const intentResult = detectBotIntent(message.content, {
      isReply: message.reference !== null,
      replyToBotMessage: false, // We'll enhance this later if needed
    });

    // Use the same threshold as conversation intelligence (0.4 confidence)
    const shouldRespond = intentResult.isBotDirected;

    if (shouldRespond) {
      discordLogger.debug(
        {
          messagePreview: message.content.substring(0, 50),
          confidence: intentResult.confidence,
          patterns: intentResult.patterns,
        },
        'Bot will respond - message appears directed at bot'
      );
    } else {
      discordLogger.debug(
        {
          messagePreview: message.content.substring(0, 50),
          confidence: intentResult.confidence,
        },
        'Bot will not respond - message appears to be general chat'
      );
    }

    return shouldRespond;
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

    // Helper function to add timing data
    const addTiming = (step, extraData = {}) => {
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

      // Check if this message warrants a response using conversation intelligence
      if (!this.shouldRespondToMessage(message)) {
        addTiming('response_decision_check', { result: 'no_response_needed' });
        discordLogger.debug(
          {
            userId: message.author.id,
            channelId: message.channelId,
            messageId: message.id,
            messagePreview: message.content.substring(0, 50),
          },
          'Skipping message - not directed at bot'
        );
        return;
      }
      addTiming('response_decision_check', { result: 'response_needed' });

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

      // Track conversation for status updates AFTER sending the thinking message
      addTiming('before_status_update');
      this.statusManager.trackConversation(message.author.username, message.content);
      addTiming('after_status_update');

      // Start the conversation storage save operation (but don't await it)
      // This makes it happen in the background without blocking the main processing flow
      addTiming('before_conversation_save');
      const savePromise = saveConversationsToStorage();
      savePromise
        .then(() => {
          addTiming('conversation_save_completed');
        })
        .catch(error => {
          addTiming('conversation_save_error', { error: error.message });
        });

      // Check if this is a version query
      const versionResponse = processVersionQuery(message.content, this.config);
      if (versionResponse) {
        // Track this as a successful API call for stats
        // trackApiCall is imported from healthCheck but not used here - keeping for consistency

        // Update the feedback message with the version response and standardized subtext
        const subtext = this.formatSubtext(timings.startTime, {}, {});
        const maxLength = 2000 - subtext.length - 3;
        let finalResponse = versionResponse.content;
        if (finalResponse.length > maxLength) {
          finalResponse = finalResponse.slice(0, maxLength) + '...';
        }
        finalResponse += subtext;
        await feedbackMessage.edit(finalResponse);

        // Store message relationship for context preservation
        if (message) {
          const contextContent =
            versionResponse.content.slice(0, 100) +
            (versionResponse.content.length > 100 ? '...' : '');
          this.storeMessageRelationship(message, feedbackMessage, 'version', contextContent);
        }

        // Add the response to the conversation log
        await manageConversation(message.author.id, {
          role: 'assistant',
          content: versionResponse.content,
        });

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

      // Get conversation context (last 5 messages for better context)
      addTiming('before_conversation_load');
      const fullConversationLog = await manageConversation(
        message.author.id,
        {
          role: 'user',
          content: message.content,
        },
        message // Pass the entire Discord message to extract references
      );
      addTiming('after_conversation_load', { logLength: fullConversationLog.length });

      // Process message with OpenAI
      addTiming('before_openai_api_call');
      const openaiTimerId = performanceMonitor.startTimer('openai_api', {
        userId: message.author.id,
        messageLength: message.content.length,
        operation: 'processMessage',
      });

      // Mark this channel as having an operation in progress
      this.inProgressOperations.add(message.channelId);
      let gptResponse;

      try {
        // Process the message with OpenAI using intelligent conversation processing
        gptResponse = await this.messageProcessor.processOpenAIMessage(
          message.content,
          fullConversationLog,
          timings
        );
        const apiDuration = addTiming('after_openai_api_call', { responseType: gptResponse.type });

        performanceMonitor.stopTimer(openaiTimerId, {
          responseType: gptResponse.type,
          success: true,
          duration: apiDuration,
        });

        // Handle different response types
        addTiming('before_response_handling', { responseType: gptResponse.type });
        if (gptResponse.type === 'functionCall') {
          await this.handleFunctionCall(
            gptResponse,
            feedbackMessage,
            fullConversationLog,
            message.author.id,
            timings.startTime,
            timings,
            message, // Pass the original user message for relationship tracking
            this.loadingEmoji,
            this.statusManager,
            (functionResult, conversationLog, functionName, functionTimings) =>
              generateNaturalResponse(
                functionResult,
                conversationLog,
                functionName,
                functionTimings,
                this.openai
              ),
            this.formatSubtext,
            this.storeMessageRelationship
          );
          // Safe access to function name with fallback to prevent TypeError
          addTiming('after_function_call_handling', {
            functionName: gptResponse.function?.name || 'unknown',
          });
        } else if (gptResponse.type === 'message') {
          await this.handleDirectMessage(
            gptResponse,
            feedbackMessage,
            fullConversationLog,
            message.author.id,
            timings.startTime, // Use the original start time from when message was received
            gptResponse.usage, // Pass token usage information
            timings.apiCalls, // Pass API call counts
            message, // Pass the original user message for relationship tracking
            this.formatSubtext,
            this.storeMessageRelationship,
            manageConversation
          );
          addTiming('after_direct_message_handling');
        } else {
          await feedbackMessage.edit(gptResponse.content);

          // Store message relationship for context preservation
          if (message) {
            const contextContent =
              gptResponse.content.slice(0, 100) + (gptResponse.content.length > 100 ? '...' : '');
            this.storeMessageRelationship(message, feedbackMessage, 'conversation', contextContent);
          }

          addTiming('after_edit_message');
        }
      } catch (error) {
        // Log the error
        discordLogger.error(
          { error, messageId: message.id, channelId: message.channelId },
          'Error processing message'
        );
        throw error; // Re-throw to maintain existing error handling
      } finally {
        // Always clear the in-progress flag when done, even if there was an error
        this.inProgressOperations.delete(message.channelId);
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
          response_type: gptResponse?.type || 'error_or_unknown',
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
            timeSinceCreation
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
      const isDM = message.channel?.isDMBased() || false;

      // Remove from conversation history
      if (isDM) {
        // For DMs, try to remove using the author's user ID as the key
        const removed = await removeMessageById(message.author?.id, message.id);
        if (removed) {
          discordLogger.debug(
            { messageId: message.id },
            'Removed deleted message from DM conversation'
          );
        }
      } else {
        // For channels, remove using channel ID
        const removed = await removeMessageById(message.channelId, message.id, isDM);
        if (removed) {
          discordLogger.debug(
            { messageId: message.id },
            'Removed deleted message from channel conversation'
          );
        }
      }

      // Check if we have a bot response for this deleted message
      const relationship = this.messageRelationships.get(message.id);
      if (relationship) {
        try {
          const { botMessage, userInfo, context } = relationship;

          // Update the bot message to show context about the deleted user message
          const username = userInfo.username || userInfo.displayName || 'Unknown User';
          const contextText = context.substring(0, 100) + (context.length > 100 ? '...' : '');

          let updatedContent;
          if (context.type === 'image') {
            updatedContent = `**${username}** removed their message - Generated image for: *${contextText}*`;
          } else if (context.type === 'weather') {
            updatedContent = `**${username}** removed their message - Weather for: *${contextText}*`;
          } else if (context.type === 'time') {
            updatedContent = `**${username}** removed their message - Time for: *${contextText}*`;
          } else if (context.type === 'wolfram') {
            updatedContent = `**${username}** removed their message - Calculation: *${contextText}*`;
          } else if (context.type === 'quake') {
            updatedContent = `**${username}** removed their message - Quake server info: *${contextText}*`;
          } else {
            updatedContent = `**${username}** removed their message - Context: *${contextText}*`;
          }

          // Edit the bot message to preserve context
          await botMessage.edit(updatedContent);

          discordLogger.info(
            {
              deletedMessageId: message.id,
              botMessageId: botMessage.id,
              username,
              contextType: context.type,
            },
            'Updated bot response after user message deletion'
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
