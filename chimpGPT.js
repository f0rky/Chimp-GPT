require('dotenv').config();
/**
 * ChimpGPT - A Discord bot with AI capabilities
 *
 * This bot integrates OpenAI's GPT model with Discord to provide
 * conversational AI, weather lookups, time zone information,
 * Quake server statistics, and Wolfram Alpha queries.
 *
 * @module ChimpGPT
 * @author Brett
 * @version 1.0.1
 */

const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const { lookupWeather, lookupExtendedForecast } = require('./weatherLookup');
const simplifiedWeather = require('./simplified-weather');
const lookupTime = require('./timeLookup');
const lookupQuakeServer = require('./quakeLookup');
const { initStatusManager } = require('./statusManager');
const lookupWolfram = require('./wolframLookup');
const { generateImage, enhanceImagePrompt } = require('./imageGeneration');
const pluginManager = require('./pluginManager');
const { processVersionQuery } = require('./utils/versionSelfQuery');
const { sendChannelGreeting } = require('./utils/greetingManager');
const PFPManager = require('./utils/pfpManager');
const { stats: healthCheckStats } = require('./healthCheck'); // Moved from updateDiscordStats

// Import loggers
const { logger, discord: discordLogger, openai: openaiLogger } = require('./logger');

// Import performance monitoring
const performanceMonitor = require('./utils/performanceMonitor');

// Import validated configuration
const config = require('./configValidator');

// Import the function results optimization patch
const optimizationPatch = require('./optimizationPatch');
logger.info(
  `Function results optimization patch applied: ${optimizationPatch.success ? 'SUCCESS' : 'FAILED'}`
);

// Note: We're now using a direct replacement for the conversation manager
// instead of a patch to avoid circular dependency issues
logger.info('Using simple conversation optimizer for better performance');

// Configuration option to disable plugins for better performance
// This can be controlled via environment variable or set directly
const DISABLE_PLUGINS = process.env.DISABLE_PLUGINS !== 'false'; // Default to disabled for better performance

// Import rate limiter
const {
  checkUserRateLimit,
  checkImageGenerationRateLimit,
  constants: { IMAGE_GEN_POINTS },
} = require('./rateLimiter');

// Import health check system
const {
  initHealthCheck,
  trackApiCall,
  trackError,
  trackMessage,
  trackRateLimit,
  isStatsCommand,
  handleStatsCommand,
  addCustomStatsSource,
} = require('./healthCheck');

// Import stats storage for graceful shutdown
const statsStorage = require('./statsStorage');
const { shouldDeploy, recordSuccessfulDeployment } = require('./utils/deploymentManager');

// Module-level variable for status manager
let statusManager = null;

// Status manager already imported above

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// Log bot version at startup
const { version: botVersion } = require('./package.json');
logger.info(`ChimpGPT starting up - version ${botVersion}`);
// Initialize Discord client with proper intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages, // Add intent for DMs
  ],
});

// Add event listener for slash commands
client.on('interactionCreate', async interaction => {
  try {
    // Only handle chat input commands (slash commands)
    if (!interaction.isChatInputCommand()) return;

    // Use the command handler to process the interaction
    await commandHandler.handleSlashCommand(interaction, config);
  } catch (error) {
    discordLogger.error({ error }, 'Error handling interaction');

    // Reply with error if we haven't replied yet
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'An error occurred while processing this command.',
        ephemeral: true,
      });
    } else if (!interaction.replied) {
      await interaction.editReply('An error occurred while processing this command.');
    }
  }
});

// Import conversation manager - using simple optimized version
// IMPORTANT: We're using the simple version to avoid the circular dependency issues
const {
  manageConversation,
  loadConversationsFromStorage,
  saveConversationsToStorage,
  stopPeriodicSaving, // Note: startPeriodicSaving is not needed with the optimized version
  getActiveConversationCount,
  getConversationStorageStatus,
  clearConversation,
  shutdown: shutdownConversations,
} = require('./useSimpleOptimizer');

const loadingEmoji = config.LOADING_EMOJI || '⏳';
const allowedChannelIDs = config.CHANNEL_ID; // Already an array from configValidator

/**
 * Removes color codes from a string
 *
 * Processes a message using OpenAI's GPT model
 *
 * This function sends the user's message along with conversation context
 * to OpenAI's API and handles the response. It includes function calling
 * capabilities for weather, time, Quake server stats, and Wolfram Alpha queries.
 *
 * @param {string} content - The user's message content
 * @param {Array<Object>} conversationLog - The conversation history
 * @returns {Promise<Object>} The response from OpenAI
 * @throws {Error} If the API call fails
 */
async function processOpenAIMessage(content, conversationLog) {
  const timerId = performanceMonitor.startTimer('openai_api_detail', {
    messageLength: content.length,
    contextLength: JSON.stringify(conversationLog).length,
  });
  try {
    // First, check for clear image generation intent in the current message
    const lowerContent = content.toLowerCase();
    const imageKeywords = ['draw', 'generate', 'create', 'make', 'show me', 'picture of', 'image of', 'photo of'];
    const isImageRequest = imageKeywords.some(keyword => lowerContent.includes(keyword));
    
    // If it's clearly an image request, bypass the full context
    if (isImageRequest) {
      openaiLogger.debug('Detected image generation request, using minimal context');
      return {
        type: 'functionCall',
        functionName: 'generateImage',
        parameters: { prompt: content }
      };
    }
    
    // Otherwise, use the full context for other requests
    openaiLogger.debug({ messages: conversationLog }, 'Sending request to OpenAI');
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: conversationLog,
      functions: [
        {
          name: 'lookupTime',
          description: 'Look up the current time for a specific location',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'The location to look up the time for',
              },
            },
            required: ['location'],
          },
        },
        {
          name: 'lookupWeather',
          description: 'Look up the current weather for a specific location',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'The location to look up the weather for',
              },
            },
            required: ['location'],
          },
        },
        {
          name: 'lookupExtendedForecast',
          description: 'Look up the extended weather forecast for a specific location',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'The location to look up the forecast for',
              },
            },
            required: ['location'],
          },
        },
        {
          name: 'getWolframShortAnswer',
          description: 'Get a short answer from Wolfram Alpha',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The query to send to Wolfram Alpha',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'quakeLookup',
          description: 'Look up Quake server statistics',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'generateImage',
          description: 'Generate an image using GPT Image-1 based on a text prompt',
          parameters: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The text prompt describing the image to generate',
              },
              model: {
                type: 'string',
                enum: ['gpt-image-1'],
                description: 'The image generation model to use (gpt-image-1 is the default)',
              },
              size: {
                type: 'string',
                enum: ['1024x1024', '1792x1024', '1024x1792'],
                description: 'The size of the generated image',
              },
              enhance: {
                type: 'boolean',
                description: 'Whether to enhance the prompt with AI for better results',
              },
            },
            required: ['prompt'],
          },
        },
      ],
    });

    const responseMessage = response.choices[0].message;

    if (responseMessage.function_call) {
      const result = {
        type: 'functionCall',
        functionName: responseMessage.function_call.name,
        parameters: JSON.parse(responseMessage.function_call.arguments),
      };

      performanceMonitor.stopTimer(timerId, {
        responseType: 'functionCall',
        functionName: responseMessage.function_call.name,
        success: true,
      });

      return result;
    }

    // Track successful OpenAI API call
    trackApiCall('openai');

    openaiLogger.debug({ response: responseMessage }, 'Received response from OpenAI');
    const result = {
      type: 'message',
      content: responseMessage.content,
    };

    performanceMonitor.stopTimer(timerId, {
      responseType: 'message',
      success: true,
    });

    return result;
  } catch (error) {
    // Track OpenAI API error
    trackError('openai');

    openaiLogger.error({ error }, 'OpenAI API Error');
    return {
      type: 'error',
      content: 'Sorry, I encountered an error processing your request.',
    };
  }
}

/**
 * Generates a natural language response based on function results
 *
 * After a function call is made, this function sends the result back to OpenAI
 * to generate a natural language response that explains the data in a user-friendly way.
 *
 * @param {Object} functionResult - The result from the called function
 * @param {Array<Object>} conversationLog - The conversation history
 * @param {string|null} functionName - The name of the function that was called
 * @returns {Promise<string>} A natural language response explaining the function result
 */
async function generateNaturalResponse(functionResult, conversationLog, functionName = null) {
  try {
    openaiLogger.debug({ functionName }, 'Generating natural response from function result');

    // Get the last user message to provide context
    const lastUserMessage =
      [...conversationLog].reverse().find(msg => msg.role === 'user')?.content || '';

    // Create a system message with instructions based on function type
    const systemMessage = {
      role: 'system',
      content: 'Use the function result to provide a helpful and natural response to the user.',
    };

    // For time lookups, provide special instructions
    if (functionName === 'lookupTime') {
      systemMessage.content = `
        The user has asked about the time in a specific location. The function has returned the current time information.
        
        When responding:
        1. Be conversational and natural, maintaining your personality.
        2. The bot's primary users are in Australia and New Zealand (timezone Pacific/Auckland, UTC+13).
        3. When relevant, include the time difference between the user's timezone (Pacific/Auckland) and the requested location.
        4. You may include interesting facts about time zones or the location if appropriate.
        5. Format the response in a clear, readable way.
        
        Original user question: "${lastUserMessage}"
      `;
    }

    // For weather lookups, provide special instructions
    else if (functionName === 'lookupWeather' || functionName === 'lookupExtendedForecast') {
      systemMessage.content = `
        The user has asked about the weather in a specific location. The function has returned the current weather information.
        
        When responding:
        1. Be conversational and natural, maintaining your personality.
        2. Focus on the key weather details: current temperature, condition, and any other relevant information.
        3. If this is an extended forecast, mention the forecast for the next few days.
        4. Format the response in a clear, readable way.
        5. If the data indicates it's mock weather data (has _isMock property), subtly indicate this is an estimate without explicitly saying it's mock data.
        
        Original user question: "${lastUserMessage}"
      `;
    }

    // Log the function result size for debugging
    const resultSize =
      typeof functionResult === 'object'
        ? JSON.stringify(functionResult).length
        : String(functionResult).length;
    openaiLogger.debug({ resultSize, functionName }, 'Function result size');

    // Convert function result to string if it's an object, with proper handling for large objects
    let functionResultContent;
    if (typeof functionResult === 'object') {
      // For weather data, extract only the essential information to reduce size
      if (functionName === 'lookupWeather' || functionName === 'lookupExtendedForecast') {
        const essentialData = {
          location: functionResult.location
            ? {
                name: functionResult.location.name,
                country: functionResult.location.country,
                localtime: functionResult.location.localtime,
              }
            : null,
          current: functionResult.current
            ? {
                temp_c: functionResult.current.temp_c,
                condition: functionResult.current.condition,
                humidity: functionResult.current.humidity,
                wind_kph: functionResult.current.wind_kph,
                wind_dir: functionResult.current.wind_dir,
              }
            : null,
          forecast: functionResult.forecast
            ? {
                forecastday: functionResult.forecast.forecastday?.map(day => ({
                  date: day.date,
                  day: {
                    maxtemp_c: day.day.maxtemp_c,
                    mintemp_c: day.day.mintemp_c,
                    condition: day.day.condition,
                  },
                })),
              }
            : null,
          _isMock: functionResult._isMock,
        };
        functionResultContent = JSON.stringify(essentialData);
      } else {
        functionResultContent = JSON.stringify(functionResult);
      }
    } else {
      functionResultContent = String(functionResult);
    }

    openaiLogger.debug('Preparing messages for OpenAI API call');
    const messages = [
      systemMessage,
      ...conversationLog,
      { role: 'function', name: 'function_response', content: functionResultContent },
    ];

    // Add a timeout to the OpenAI API call to prevent the bot from getting stuck
    openaiLogger.debug('Sending request to OpenAI with timeout');
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI API call timed out after 15 seconds')), 15000);
    });

    const response = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-4o-mini', // Using faster model for better responsiveness
        messages: messages,
      }),
      timeoutPromise,
    ]);

    // Track successful OpenAI API call
    trackApiCall('openai');
    openaiLogger.info('Successfully received response from OpenAI');

    const responseContent = response.choices[0].message.content;
    openaiLogger.debug({ responseLength: responseContent.length }, 'Response content length');

    return responseContent;

    // This line is now handled in the try/catch block above
  } catch (error) {
    // Track OpenAI API error
    trackError('openai');

    openaiLogger.error({ error }, 'Error generating natural response');
    return `Here's what I found: ${JSON.stringify(functionResult, null, 2)}`;
  }
}

// Import the command handler system
const commandHandler = require('./commands/commandHandler');

// Track in-progress operations
const inProgressOperations = new Set();

// Handle message creation
client.on('messageCreate', async message => {
  // Skip if there's already an operation in progress for this channel
  if (inProgressOperations.has(message.channelId)) {
    discordLogger.debug(
      { channelId: message.channelId, messageId: message.id },
      'Skipping message - operation already in progress for this channel'
    );
    return;
  }

  // Start overall message processing timer
  const messageTimerId = performanceMonitor.startTimer('message_processing', {
    userId: message.author.id,
    channelId: message.channelId,
    messageId: message.id,
    messageLength: message.content.length,
  });

  // Add a debug object to track timing of each step
  const timings = {
    start: Date.now(),
    steps: [],
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

    if (message.content.startsWith(config.IGNORE_MESSAGE_PREFIX)) {
      addTiming('ignore_prefix_check', { result: 'ignored' });
      return;
    }
    addTiming('ignore_prefix_check', { result: 'passed' });

    // Ignore messages from unauthorized channels - quick check that doesn't need any async operations
    if (!allowedChannelIDs.includes(message.channelId)) {
      addTiming('channel_auth_check', { result: 'unauthorized' });
      discordLogger.debug(
        { channelId: message.channelId },
        'Ignoring message from unauthorized channel'
      );
      return;
    }
    addTiming('channel_auth_check', { result: 'authorized' });

    // HIGHEST PRIORITY: Send initial feedback IMMEDIATELY before any other processing
    // This ensures users get immediate feedback that their message was received
    addTiming('before_thinking_message');
    const feedbackPromise = message.reply(`${loadingEmoji} Thinking...`);

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
    let pluginPromise;
    const pluginTimerId = performanceMonitor.startTimer('plugin_execution', {
      hook: 'onMessageReceived',
    });

    if (DISABLE_PLUGINS) {
      // Skip plugin execution when disabled
      pluginPromise = Promise.resolve([]);
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
      pluginPromise = pluginManager
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
      await feedbackMessage.delete().catch(() => {}); // Delete the thinking message
      await handleStatsCommand(message);
      addTiming('stats_command_handled');
      return;
    }
    addTiming('after_stats_command_check');

    // Try to handle the message as a command
    addTiming('before_command_handling');
    const isCommand = await commandHandler.handleCommand(message, config);
    addTiming('after_command_handling', { wasCommand: isCommand });
    if (isCommand) {
      // If it was a command, delete the thinking message and exit
      const feedbackMessage = await feedbackPromise;
      await feedbackMessage.delete().catch(() => {});
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
    statusManager.trackConversation(message.author.username, message.content);
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
    const versionResponse = processVersionQuery(message.content, config);
    if (versionResponse) {
      // Track this as a successful API call for stats
      trackApiCall('version_query', true);

      // Update the feedback message with the version response
      await feedbackMessage.edit(versionResponse.content);

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
    inProgressOperations.add(message.channelId);
    let gptResponse;
    
    try {
      // Process the message with OpenAI
      gptResponse = await processOpenAIMessage(message.content, fullConversationLog);
      const apiDuration = addTiming('after_openai_api_call', { responseType: gptResponse.type });
      
      performanceMonitor.stopTimer(openaiTimerId, {
        responseType: gptResponse.type,
        success: true,
        duration: apiDuration,
      });
      
      // Handle different response types
      addTiming('before_response_handling', { responseType: gptResponse.type });
      if (gptResponse.type === 'functionCall') {
        await handleFunctionCall(gptResponse, feedbackMessage, fullConversationLog, message.author.id);
        // Safe access to function name with fallback to prevent TypeError
        addTiming('after_function_call_handling', {
          functionName: gptResponse.function?.name || 'unknown',
        });
      } else if (gptResponse.type === 'message') {
        await handleDirectMessage(gptResponse, feedbackMessage, fullConversationLog, message.author.id);
        addTiming('after_direct_message_handling');
      } else {
        await feedbackMessage.edit(gptResponse.content);
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
      inProgressOperations.delete(message.channelId);
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
    addTiming('processing_error', { error: error.message });

    discordLogger.error(
      {
        error,
        timing_data: timings,
      },
      'Error in message handler'
    );

    await message.reply('Sorry, I encountered an error processing your request.');

    // Stop the timer with error information
    performanceMonitor.stopTimer(messageTimerId, {
      success: false,
      error: error.message,
    });
  } finally {
    // Always stop the timer if it hasn't been stopped yet
    const finalTiming = addTiming('processing_complete');
    performanceMonitor.stopTimer(messageTimerId, {
      success: true,
      totalDuration: finalTiming,
    });
  }
});

/**
 * Handles requests for Quake server statistics
 *
 * This function retrieves Quake server statistics and updates the message
 * with the formatted results. It uses the configured ELO display mode.
 *
 * @param {Object} feedbackMessage - The Discord message to update with results
 * @returns {Promise<boolean>} True if successful, false if an error occurred
 */
async function handleQuakeStats(feedbackMessage) {
  try {
    await feedbackMessage.edit(`${loadingEmoji} Checking server stats...`);

    // Get server stats - lookupQuakeServer now returns a formatted string
    const serverStats = await lookupQuakeServer();

    // The AI processing in quakeLookup.js should ensure we're under the Discord character limit
    // but we'll still truncate if needed as a safety measure
    await feedbackMessage.edit(
      serverStats.slice(0, 1997) + (serverStats.length > 1997 ? '...' : '')
    );

    // Count active servers for status update
    // Extract server count from response (improved parsing)
    let serverCount = 0;

    if (serverStats.includes('No active servers found')) {
      serverCount = 0;
    } else {
      // Look for server headings in different formats
      // Format 1: '# Server: <name>'
      const serverHeadings1 = (serverStats.match(/# Server:/g) || []).length;

      // Format 2: '## <name>' (used in some responses)
      const serverHeadings2 = (serverStats.match(/## [^#]/g) || []).length;

      // Format 3: 'Server: <name>' (used in AI-generated summaries)
      const serverHeadings3 = (serverStats.match(/Server: /g) || []).length;

      // Use the maximum count from any of these patterns
      serverCount = Math.max(serverHeadings1, serverHeadings2, serverHeadings3);

      // If we still have 0 but the response doesn't indicate no servers, assume at least 1
      if (serverCount === 0 && !serverStats.includes('No active servers found')) {
        serverCount = 1;
      }
    }

    // Update status with server count and username if available
    const username = feedbackMessage.author ? feedbackMessage.author.username : null;
    statusManager.trackQuakeLookup(serverCount, username);

    return true;
  } catch (error) {
    discordLogger.error({ error }, 'Error in handleQuakeStats');
    await feedbackMessage.edit(
      '# 🎯 Quake Live Server Status\n\n> ⚠️ An error occurred while retrieving server information.'
    );
    return false;
  }
}

/**
 * Handles image generation requests
 *
 * This function processes image generation requests using GPT Image-1,
 * downloads the generated image, and sends it to the Discord channel.
 *
 * @param {Object} parameters - Parameters for image generation
 * @param {Object} message - The Discord message to update
 * @param {Array} [conversationLog=[]] - The conversation history
 * @returns {Promise<void>}
 */
async function handleImageGeneration(parameters, message, conversationLog = []) {
  try {
    // Track start time for progress updates
    const startTime = Date.now();
    let currentPhase = 'initializing';

    // Create a progress tracking object
    const progress = {
      startTime,
      phases: {
        initializing: { start: startTime, end: null, elapsed: 0 },
        enhancing: { start: null, end: null, elapsed: 0 },
        generating: { start: null, end: null, elapsed: 0 },
        downloading: { start: null, end: null, elapsed: 0 },
        uploading: { start: null, end: null, elapsed: 0 },
      },
      currentPhase,
      totalElapsed: 0,
    };

    // Function to update progress
    const updateProgress = (newPhase = null) => {
      const now = Date.now();

      // If we're changing phases, update the phase timing
      if (newPhase && newPhase !== currentPhase) {
        // End the current phase
        progress.phases[currentPhase].end = now;
        progress.phases[currentPhase].elapsed = now - progress.phases[currentPhase].start;

        // Start the new phase
        progress.phases[newPhase].start = now;
        currentPhase = newPhase;
        progress.currentPhase = newPhase;
      }

      // Update total elapsed time
      progress.totalElapsed = now - startTime;

      return progress;
    };

    // Setup periodic progress updates (every 5 seconds)
    const UPDATE_INTERVAL = 5000; // 5 seconds

    // Format elapsed time nicely
    const formatElapsed = ms => {
      if (ms < 1000) return `${ms}ms`;
      const seconds = Math.floor(ms / 1000);
      if (seconds < 60) return `${seconds}s`;
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    };

    // Send initial response or update existing message
    let feedbackMessage = message;
    if (message.reply && typeof message.reply === 'function') {
      // This is a regular message, not an interaction response
      feedbackMessage = await message.edit('🎨 Creating your image...');
    } else if (message.edit && typeof message.edit === 'function') {
      // This is already a message we can edit
      feedbackMessage = await message.edit('🎨 Creating your image...');
    }

    // Start the progress updater
    const progressUpdater = setInterval(async () => {
      try {
        const currentProgress = updateProgress();
        const elapsedFormatted = formatElapsed(currentProgress.totalElapsed);

        let statusMessage = `🎨 Creating your image... (${elapsedFormatted})`;

        // Add phase-specific messages
        switch (currentProgress.currentPhase) {
          case 'enhancing':
            statusMessage += '\n⚙️ Enhancing your prompt for better results...';
            break;
          case 'generating':
            statusMessage += '\n✨ Generating image with AI...';
            break;
          case 'downloading':
            statusMessage += '\n📥 Downloading the generated image...';
            break;
          case 'uploading':
            statusMessage += '\n📤 Preparing to send the image...';
            break;
          default:
            // No additional message for other phases
            break;
        }

        // Check if message is a command
        if (message.content.startsWith('!')) {
          try {
            const args = message.content.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            if (command === 'ping') {
              const sent = await message.channel.send('Pinging...');
              await sent.edit(`Pong! Latency is ${sent.createdTimestamp - message.createdTimestamp}ms.`);
              return;
            }

            if (command === 'stats') {
              await handleStatsCommand(message);
              return;
            }

            if (command === 'pfp') {
              await handlePFPCommand(message, args);
              return;
            }

            if (command === 'status') {
              const status = args.join(' ');
              if (!status) {
                await message.channel.send('Please provide a status message!');
                return;
              }
              client.user.setActivity(status, { type: 'PLAYING' });
              await message.channel.send(`Status updated to: ${status}`);
              return;
            }
            
            if (command === 'help') {
              await message.channel.send(
                'Available commands:\n' +
                '`!help` - Show this help message\n' +
                '`!ping` - Check if the bot is alive\n' +
                '`!stats` - Show bot statistics\n' +
                '`!pfp` - Change the bot\'s profile picture\n' +
                '`!status <message>` - Set the bot\'s status message\n' +
                '`!clear` - Clear the conversation history for this channel'
              );
              return;
            }
            
            // If we get here, the command wasn't recognized
            return;
          } catch (error) {
            discordLogger.error({ error }, 'Error processing command');
            await message.reply('❌ An error occurred while processing your command.');
            return;
          }
        }
        
        // Only update every 5 seconds to avoid rate limits
        await feedbackMessage.edit(statusMessage);
      } catch (error) {
        discordLogger.error({ error }, 'Error updating image generation progress');
      }
    }, UPDATE_INTERVAL);

    // Update bot status to show we're generating an image
    const username = message.author ? message.author.username : 'unknown';

    // Use the global statusManager instance that was initialized in the ready event
    if (statusManager && typeof statusManager.trackImageGeneration === 'function') {
      statusManager.trackImageGeneration(
        username,
        parameters.prompt,
        parameters.size || '1024x1024'
      );
      discordLogger.debug('Updated status for image generation');
    } else {
      discordLogger.warn('Status manager not properly initialized, skipping status update');
    }

    // IMPORTANT FIX: Move to generating phase BEFORE the OpenAI function call happens
    // This ensures that the time spent waiting for OpenAI is properly attributed
    // to the generating phase, not initializing
    updateProgress('generating');

    // Enhance the prompt if requested
    let finalPrompt = parameters.prompt;
    if (parameters.enhance) {
      updateProgress('enhancing');
      try {
        const enhancedPrompt = await enhanceImagePrompt(parameters.prompt);

        // IMPORTANT FIX: Validate that the enhanced prompt is not empty
        if (enhancedPrompt && enhancedPrompt.trim().length > 0) {
          finalPrompt = enhancedPrompt;
          discordLogger.info(
            {
              originalPrompt: parameters.prompt,
              enhancedPrompt: finalPrompt,
            },
            'Prompt enhanced for image generation'
          );
        } else {
          discordLogger.warn(
            { originalPrompt: parameters.prompt },
            'Enhanced prompt was empty, falling back to original prompt'
          );
          // Keep using the original prompt (finalPrompt is already set to parameters.prompt)
        }
      } catch (error) {
        discordLogger.error({ error }, 'Error enhancing prompt');
        // Continue with the original prompt
      }

      // Return to generating phase after enhancement is complete
      updateProgress('generating');
    }

    // No need for another updateProgress here since we've already set it

    // Generate the image
    let result;
    let generationTime;
    
    try {
      result = await generateImage(finalPrompt, {
        model: parameters.model || 'gpt-image-1',
        size: parameters.size || '1024x1024',
      });

      // Check for content policy violation in the result
      if (!result.success) {
        if (result.isContentPolicyViolation) {
          const error = new Error(result.error);
          error.isContentPolicyViolation = true;
          throw error;
        }
        throw new Error(result.error);
      }

      // Calculate generation time
      generationTime = ((Date.now() - progress.startTime) / 1000).toFixed(2);

      // Update bot status to show image generation is complete
      if (statusManager && typeof statusManager.trackImageComplete === 'function') {
        statusManager.trackImageComplete(
          generationTime,
          parameters.size || '1024x1024',
          parameters.quality || 'auto'
        );
      }
    } catch (error) {
      discordLogger.error({ error }, 'Image generation failed');
      
      // Handle content policy violations specially
      if (error.isContentPolicyViolation || (error.status === 400 && error.code === 'moderation_blocked')) {
        const errorMessage = 'This request was rejected due to content policy violations. Please modify your prompt and try again.';
        await feedbackMessage.edit(`❌ ${errorMessage}`);
        
        // Create a new error with a specific type that we can check for
        const policyError = new Error(errorMessage);
        policyError.isContentPolicyViolation = true;
        throw policyError; // Re-throw to be handled by the caller
      } else {
        // For other errors, show a generic error message and re-throw
        const errorMessage = `Failed to generate image: ${error.message || 'An unknown error occurred'}`;
        await feedbackMessage.edit(`❌ ${errorMessage}`);
        throw new Error(errorMessage);
      }
    }

    // Get the first image result and validate it
    const imageResult = result.images[0];
    const revisedPrompt = imageResult?.revisedPrompt || finalPrompt;

    // Log the image data for debugging
    logger.debug(
      {
        hasUrl: !!imageResult?.url,
        hasBase64: !!imageResult?.b64_json,
        urlType: imageResult?.url?.substring(0, 30), // Log just the beginning of the URL for privacy
      },
      'Image data from GPT Image-1 response'
    );

    // Validate we have either a URL or base64 data
    if (!imageResult || (!imageResult.url && !imageResult.b64_json)) {
      throw new Error('No valid image data returned from GPT Image-1');
    }

    // Move to downloading phase
    updateProgress('downloading');

    let buffer;

    // Handle either URL or base64 data
    if (imageResult.b64_json) {
      // Directly use the base64 data if available
      buffer = Buffer.from(imageResult.b64_json, 'base64');
      logger.info('Using base64 image data directly from API response');
    } else {
      // Otherwise download from URL
      try {
        // Validate URL format
        new URL(imageResult.url);

        // Check if it's a data URL
        if (imageResult.url.startsWith('data:')) {
          // Extract the base64 part from the data URL
          const base64Data = imageResult.url.split(',')[1];
          buffer = Buffer.from(base64Data, 'base64');
          logger.info('Extracted base64 data from data URL');
        } else {
          // Download from remote URL
          const axios = require('axios');
          const response = await axios.get(imageResult.url, { responseType: 'arraybuffer' });
          buffer = Buffer.from(response.data, 'binary');
          logger.info('Downloaded image from remote URL');
        }
      } catch (error) {
        logger.error({ error, url: imageResult.url }, 'Error processing image URL');
        throw new Error(`Error processing image data: ${error.message}`);
      }
    }

    // Move to uploading phase
    updateProgress('uploading');

    // Save the image to PFP rotation if pfpManager is available
    if (client.pfpManager) {
      try {
        // Generate a unique filename based on timestamp and a random string
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 8);
        const filename = `gpt-${timestamp}-${randomStr}.png`;  // Ensure .png extension
        
        discordLogger.info('Attempting to save image to PFP rotation', { 
          filename,
          bufferSize: buffer.length,
          hasPfpManager: !!client.pfpManager
        });
        
        // Save the image to the PFP rotation
        const savedPath = await client.pfpManager.addImage(buffer, filename);
        discordLogger.info('Image added to PFP rotation', { savedPath });
        
        // Trigger an immediate PFP update with the new image
        try {
          await client.pfpManager.updateBotAvatar();
          discordLogger.info('PFP updated with new image');
        } catch (updateError) {
          discordLogger.warn({ error: updateError }, 'Failed to immediately update PFP with new image');
        }
      } catch (error) {
        discordLogger.error({ 
          error: error.message,
          stack: error.stack,
          bufferSize: buffer?.length
        }, 'Failed to add image to PFP rotation');
      }
    } else {
      discordLogger.warn('Skipping PFP save', { 
        reason: process.env.NODE_ENV === 'test' ? 'test environment' : 
               process.env.NODE_ENV === 'development' ? 'development environment' : 
               !client.pfpManager ? 'pfpManager not available' : 'unknown reason'
      });
    }

    // Create attachment
    const attachment = { attachment: buffer, name: 'gpt-image.png' };

    // Clear the progress updater interval
    if (progressUpdater) {
      clearInterval(progressUpdater);
    }

    // Format phase times for the final message
    const phaseTimings = Object.entries(progress.phases)
      .filter(entry => entry[1].elapsed > 0)
      .map(([phaseName, timing]) => `${phaseName}: ${formatElapsed(timing.elapsed)}`)
      .join(' | ');

    // Send the image with information about the prompt, timing, and cost details
    await feedbackMessage.edit({
      content: `🖼️ Image generated by GPT Image-1
📝 ${parameters.enhance ? 'Enhanced prompt' : 'Prompt'}: "${revisedPrompt}"
⏱️ Total time: ${formatElapsed(progress.totalElapsed)} (${phaseTimings})
💰 Estimated cost: $${result.estimatedCost ? result.estimatedCost.toFixed(4) : '0.0000'}
🔢 Size: ${parameters.size || '1024x1024'} | Quality: ${parameters.quality || 'auto'}`,
      files: [attachment],
    });

    // Add the response to the conversation log
    conversationLog.push({
      role: 'assistant',
      content: `I've created an image based on your request: "${parameters.prompt}". The image has been generated using GPT Image-1 in ${generationTime}s with an estimated cost of $${result.estimatedCost ? result.estimatedCost.toFixed(4) : '0.0000'}.`,
    });

    discordLogger.info(
      {
        success: true,
        prompt: parameters.prompt,
        model: parameters.model || 'gpt-image-1',
      },
      'Image generated and sent successfully'
    );
  } catch (error) {
    discordLogger.error({ error }, 'Error handling image generation');



    if (message && message.edit) {
      try {
        // Just send a simple error message without timing information
        // to avoid linting errors with progress tracking
        const errorMessage =
          '❌ An error occurred while generating the image. Please try again later.';
        await message.edit(errorMessage);
      } catch (editError) {
        discordLogger.error(
          { error: editError },
          'Error editing message after image generation failure'
        );
      }
    }
    trackError('gptimage');
  }
}

/**
 * Handles function calls from OpenAI's response
 *
 * This function processes function calls detected in OpenAI's response,
 * executes the appropriate function with the provided arguments, and
 * generates a natural language response based on the function result.
 * It also handles rate limiting for API-intensive functions.
 *
 * @param {Object} gptResponse - The response from OpenAI containing the function call
 * @param {Object} feedbackMessage - The Discord message to update with results
 * @param {Array<Object>} conversationLog - The conversation history
 * @returns {Promise<void>}
 */
async function handleFunctionCall(gptResponse, feedbackMessage, conversationLog, userIdFromMessage) {
  // Start function call timer
  const functionCallTimerId = performanceMonitor.startTimer('function_call', {
    functionName: gptResponse.functionName,
    hasParameters: !!gptResponse.parameters,
  });
  const loadingMessages = {
    lookupTime: 'Checking watch...',
    lookupWeather: 'Looking outside...',
    lookupExtendedForecast: "Let me ping the cloud, and I don't mean the fluffy ones...",
    getWolframShortAnswer: 'Consulting Wolfram Alpha...',
    quakeLookup: 'Checking server stats...',
    generateImage: 'Creating your image with GPT Image-1...',
    getVersion: 'Checking my version...',
  };

  await feedbackMessage.edit(
    `${loadingEmoji} ${loadingMessages[gptResponse.functionName] || 'Processing...'}`
  );

  const userId = userIdFromMessage; // Use the ID passed from messageCreate

  // Define rate limit costs for different function calls - reduced to be more permissive
  const functionCosts = {
    lookupTime: 1,
    lookupWeather: 1,
    lookupExtendedForecast: 2,
    getWolframShortAnswer: 2,
    quakeLookup: 1,
    generateImage: 1, // Image generation has its own specialized rate limiter
    getVersion: 0.5, // Very low cost for version queries
  };

  // Special handling for image generation with dedicated rate limiter
  if (gptResponse.functionName === 'generateImage') {
    // Use the specialized image generation rate limiter (3 per minute)
    const imageRateLimitResult = await checkImageGenerationRateLimit(userId);

    if (imageRateLimitResult.limited) {
      discordLogger.info(
        {
          userId,
          functionName: gptResponse.functionName,
          secondsBeforeNext: imageRateLimitResult.secondsBeforeNext,
        },
        'User rate limited for image generation'
      );

      // Track rate limit in health check system
      trackRateLimit(userId);

      await feedbackMessage.edit(
        `⏱️ You can only generate ${IMAGE_GEN_POINTS} images per minute. Please wait ${imageRateLimitResult.secondsBeforeNext} seconds before generating another image.`
      );
      return;
    }
  } else {
    // Apply general rate limits for other functions
    const cost = functionCosts[gptResponse.functionName] || 1;
    const rateLimitResult = await checkUserRateLimit(userId, cost, {
      // More permissive rate limits for general API usage
      points: 30,
      duration: 30, // 30 seconds for better responsiveness
    });

    // If user is rate limited for this function, inform them
    if (rateLimitResult.limited) {
      discordLogger.info(
        {
          userId,
          functionName: gptResponse.functionName,
          secondsBeforeNext: rateLimitResult.secondsBeforeNext,
        },
        'User rate limited for function call'
      );

      // Track rate limit in health check system
      trackRateLimit(userId);

      await feedbackMessage.edit(
        `⏱️ Rate limit reached. Please wait ${rateLimitResult.secondsBeforeNext} seconds before trying again.`
      );
      return;
    }
  }

  // Rate limiting is now handled in the conditional blocks above

  let functionResult;
  switch (gptResponse.functionName) {
    case 'lookupTime':
      try {
        const timeTimerId = performanceMonitor.startTimer('time_api', {
          location: gptResponse.parameters.location,
        });
        functionResult = await lookupTime(gptResponse.parameters.location);
        performanceMonitor.stopTimer(timeTimerId, { success: true });
        trackApiCall('time');
      } catch (error) {
        trackError('time');
        throw error;
      }
      break;
    case 'lookupWeather':
      try {
        // Get the original weather data for status updates
        const weatherData = await lookupWeather(gptResponse.parameters.location);
        trackApiCall('weather');
        discordLogger.info({ location: gptResponse.parameters.location, weatherData, source: 'lookupWeather_case' }, 'Weather data fetched in handleFunctionCall');

        // Update status if we have valid weather data
        if (
          weatherData &&
          weatherData.location &&
          weatherData.current &&
          weatherData.current.condition &&
          weatherData.current.condition.text
        ) {
          statusManager.trackWeatherLookup(weatherData.location.name, weatherData.current.condition.text);
        } else {
          discordLogger.warn(
            { weatherData },
            'Weather data incomplete or has errors, not updating status'
          );
        }

        // Use the simplified implementation to get a natural language response
        performanceMonitor.startTimer('weather_api', {
          location: gptResponse.parameters.location,
        });
        const userQuestion =
          conversationLog.find(msg => msg.role === 'user')?.content ||
          `What's the weather in ${gptResponse.parameters.location}?`;

        const response = await simplifiedWeather.getWeatherResponse(
          gptResponse.parameters.location,
          userQuestion,
          weatherData // Pass the prefetched data
        );

        // Update the feedback message directly with the response
        await feedbackMessage.edit(response);

        // Add the response to the conversation log
        conversationLog.push({
          role: 'assistant',
          content: response,
        });

        // Stop timer and return early since we've already handled the response
        performanceMonitor.stopTimer(functionCallTimerId, { success: true });
        return;
      } catch (error) {
        trackError('weather');
        discordLogger.error({ error }, 'Error in weather lookup');
        await feedbackMessage.edit(
          'I encountered an error while checking the weather. Please try again later.'
        );
        return;
      }
    case 'lookupExtendedForecast':
      try {
        // Get the original weather data for status updates
        const weatherData = await lookupExtendedForecast(
          gptResponse.parameters.location,
          gptResponse.parameters.days
        );
        trackApiCall('weather');
        discordLogger.info({ location: gptResponse.parameters.location, days: gptResponse.parameters.days, weatherData, source: 'lookupExtendedForecast_case' }, 'Weather data fetched in handleFunctionCall');

        // Update status if we have valid weather data
        if (
          weatherData &&
          weatherData.location &&
          weatherData.current &&
          weatherData.current.condition &&
          weatherData.current.condition.text
        ) {
          statusManager.trackWeatherLookup(weatherData.location.name, weatherData.current.condition.text);
        } else {
          discordLogger.warn(
            { weatherData },
            'Weather data incomplete or has errors, not updating status'
          );
        }

        // Use the simplified implementation to get a natural language response
        const userQuestion =
          conversationLog.find(msg => msg.role === 'user')?.content ||
          `What's the ${gptResponse.parameters.days}-day forecast for ${gptResponse.parameters.location}?`;

        const response = await simplifiedWeather.getWeatherResponse(
          gptResponse.parameters.location,
          userQuestion,
          weatherData // Pass the prefetched data
        );

        // Update the feedback message directly with the response
        await feedbackMessage.edit(response);

        // Add the response to the conversation log
        conversationLog.push({
          role: 'assistant',
          content: response,
        });

        // Stop timer and return early since we've already handled the response
        performanceMonitor.stopTimer(functionCallTimerId, { success: true });
        return;
      } catch (error) {
        trackError('weather');
        discordLogger.error({ error }, 'Error in extended forecast lookup');
        await feedbackMessage.edit(
          'I encountered an error while checking the forecast. Please try again later.'
        );
        return;
      }
    case 'getWolframShortAnswer':
      try {
        const wolframTimerId = performanceMonitor.startTimer('wolfram_api', {
          query: gptResponse.parameters.query,
        });
        functionResult = await lookupWolfram.getWolframShortAnswer(gptResponse.parameters.query);
        performanceMonitor.stopTimer(wolframTimerId, { success: true });
        trackApiCall('wolfram');
      } catch (error) {
        trackError('wolfram');
        throw error;
      }
      break;
    case 'quakeLookup':
      try {
        await handleQuakeStats(feedbackMessage);
        trackApiCall('quake');
        return;
      } catch (error) {
        trackError('quake');
        throw error;
      }
    case 'generateImage':
      try {
        await handleImageGeneration(gptResponse.parameters, feedbackMessage, conversationLog);
        trackApiCall('gptimage');
        return;
      } catch (error) {
        trackError('gptimage');
        discordLogger.error({ error }, 'Error in image generation');
        
        // If this was a content policy violation, we've already shown the message
        if (error.isContentPolicyViolation) {
          discordLogger.info('Content policy violation handled');
          return;
        }
        
        // For other errors, show a generic error message
        await feedbackMessage.edit(
          '❌ An error occurred while generating the image. Please try again later.'
        );
        return;
      }
    case 'getVersion':
      try {
        // Import the version utilities
        const { generateVersionResponse } = require('./utils/versionSelfQuery');

        // Get parameters with defaults
        const detailed = gptResponse.parameters?.detailed === true;
        const technical = gptResponse.parameters?.technical === true;

        // Generate the version response
        const versionResponse = generateVersionResponse({
          detailed,
          technical,
          config,
        });

        // Update the message with the version response
        await feedbackMessage.edit(versionResponse);

        // Add the response to the conversation log
        conversationLog.push({
          role: 'assistant',
          content: versionResponse,
        });

        // Track this as a successful API call for stats
        trackApiCall('version_query', true);

        // Stop timer and return early since we've already handled the response
        performanceMonitor.stopTimer(functionCallTimerId, { success: true });
        return;
      } catch (error) {
        trackError('other');
        discordLogger.error({ error }, 'Error in version lookup');
        await feedbackMessage.edit(
          'I encountered an error while checking my version. Please try again later.'
        );
        return;
      }
  }

  try {
    // Log the function result for debugging
    discordLogger.debug(
      { functionName: gptResponse.functionName },
      'Generating natural response from function result'
    );

    const naturalResponse = await generateNaturalResponse(
      functionResult,
      conversationLog,
      gptResponse.functionName
    );

    if (naturalResponse?.trim()) {
      conversationLog.push({
        role: 'assistant',
        content: naturalResponse,
      });

      await feedbackMessage.edit(
        naturalResponse?.slice(0, 1997) + (naturalResponse?.length > 1997 ? '...' : '')
      );
    } else {
      // If no natural response was generated, provide a direct response with the data
      let directResponse = '';

      if (
        gptResponse.functionName === 'lookupWeather' ||
        gptResponse.functionName === 'lookupExtendedForecast'
      ) {
        if (functionResult && functionResult.location && functionResult.current) {
          directResponse = `Current weather in ${functionResult.location.name}: ${functionResult.current.condition.text}, ${functionResult.current.temp_c}°C`;

          // Add forecast if available
          if (
            functionResult.forecast &&
            functionResult.forecast.forecastday &&
            functionResult.forecast.forecastday.length > 0
          ) {
            directResponse += '\n\nForecast:';
            functionResult.forecast.forecastday.forEach(day => {
              directResponse += `\n${day.date}: ${day.day.condition.text}, ${day.day.maxtemp_c}°C / ${day.day.mintemp_c}°C`;
            });
          }
        } else {
          directResponse = 'Weather data could not be retrieved. Please try again later.';
        }
      } else {
        directResponse =
          "I retrieved the information but couldn't generate a natural response. Here's the raw data:\n\n" +
          JSON.stringify(functionResult, null, 2).slice(0, 1500);
      }

      await feedbackMessage.edit(directResponse);
    }
  } catch (error) {
    discordLogger.error(
      { error, functionName: gptResponse.functionName },
      'Error in natural response generation'
    );

    // Provide a fallback response with the raw data
    let fallbackResponse =
      "I encountered an error while processing the response, but here's what I found:\n\n";

    if (
      gptResponse.functionName === 'lookupWeather' ||
      gptResponse.functionName === 'lookupExtendedForecast'
    ) {
      if (functionResult && functionResult.location && functionResult.current) {
        fallbackResponse += `Current weather in ${functionResult.location.name}: ${functionResult.current.condition.text}, ${functionResult.current.temp_c}°C`;
      } else {
        fallbackResponse += 'Weather data could not be retrieved properly.';
      }
    } else {
      fallbackResponse += JSON.stringify(functionResult, null, 2).slice(0, 1500);
    }

    await feedbackMessage.edit(fallbackResponse);
  }
}

/**
 * Handles direct message responses from OpenAI
 *
 * This function processes standard text responses from OpenAI (not function calls)
 * and updates the Discord message with the response content. It also handles
 * truncating responses that exceed Discord's character limit.
 *
 * @param {Object} gptResponse - The response from OpenAI containing the message content
 * @param {Object} feedbackMessage - The Discord message to update with results
 * @param {Array<Object>} conversationLog - The conversation history to update
 * @returns {Promise<void>}
 */
async function handleDirectMessage(gptResponse, feedbackMessage, conversationLog, userIdFromMessage) {
  if (!gptResponse.content?.trim()) {
    await feedbackMessage.edit("Sorry, I couldn't understand your request. Please try again.");
    return;
  }

  // Create a new response message
  const responseMessage = {
    role: 'assistant',
    content: gptResponse.content,
  };

  // Add to the conversation log
  conversationLog.push(responseMessage);

  // Also update the stored conversation
  // We don't need to pass the Discord message here since we're just adding an assistant response
  await manageConversation(userIdFromMessage, responseMessage);

  const finalResponse =
    gptResponse.content.slice(0, 1997) + (gptResponse.content.length > 1997 ? '...' : '');
  await feedbackMessage.edit(finalResponse);
}

// Utility to update Discord status in stats and persist it
async function updateDiscordStats() {
  try {
    healthCheckStats.discord = {
      ping: client.ws.ping,
      status: client.ws.status === 0 ? 'ok' : 'offline',
      guilds: client.guilds.cache.size,
      channels: client.channels.cache.size,
    };
    await statsStorage.saveStats(healthCheckStats);
  } catch (err) {
    discordLogger.error({ err }, 'Failed to update Discord stats');
  }
}

// Ready event
client.on('ready', async () => {
  discordLogger.info(`Logged in as ${client.user.tag}`);

  // Initialize health check and status manager

  // Initialize health check system
  initHealthCheck(client);
  discordLogger.info('Initializing performance monitoring');
  const { initPerformanceMonitoring } = require('./utils/healthCheckIntegration');
  initPerformanceMonitoring();
  discordLogger.info('Health check system initialized');

  // Immediately update Discord stats on startup
  updateDiscordStats();
  // Periodically update Discord stats every 30 seconds
  setInterval(updateDiscordStats, 30000);

  // Initialize status manager
  statusManager = initStatusManager(client);
  discordLogger.info('Status manager initialized');

  // Load conversations from persistent storage
  try {
    await loadConversationsFromStorage();
    discordLogger.info('Conversations loaded from persistent storage using optimized storage');

    // Note: Periodic saving is handled internally by the optimizer
    discordLogger.info('Conversation optimization active - periodic saving handled automatically');
  } catch (error) {
    discordLogger.error({ error }, 'Error loading conversations from persistent storage');
  }

  // Load command modules
  const commandsLoaded = await commandHandler.loadCommands();
  discordLogger.info({ commandsLoaded }, 'Command modules loaded');

  // Set command prefixes
  commandHandler.setPrefixes(['!', '.']);
  discordLogger.info({ prefixes: commandHandler.prefixes }, 'Command prefixes set');

  // Check if we should deploy slash commands
  if (config.CLIENT_ID) {
    if (await shouldDeploy(config)) {
      try {
        discordLogger.info('Attempting to deploy slash commands...');
        const deployResult = await commandHandler.deployCommands(config);
        discordLogger.info({ deployResult }, 'Slash commands deployment process finished.');
        // Assuming deployCommands doesn't throw an error for a partial success,
        // or if it does, we only record on full success.
        // If deployResult itself indicates success/failure, that logic can be added here.
        await recordSuccessfulDeployment(); 
      } catch (error) {
        discordLogger.error({ error }, 'Error deploying slash commands');
      }
    } else {
      // Log already handled by shouldDeploy
    }
  } else {
    discordLogger.warn('CLIENT_ID not found in config, slash commands will not be deployed or checked.');
  }

  // Initialize PFP Manager
  const pfpManager = new PFPManager(client, {
    pfpDir: path.join(__dirname, 'pfp'),
    maxImages: 50,
    rotationInterval: 10 * 60 * 1000 // 10 minutes
  });

  // Start PFP rotation if not in development
  if (process.env.NODE_ENV !== 'development') {
    pfpManager.startRotation();
    discordLogger.info('PFP rotation started');
  }

  // Send greeting messages
  try {
    // Send a greeting to all allowed channels
    await sendChannelGreeting(client);

    // We'll let healthCheck handle the owner startup report to avoid duplicate messages
    // The healthCheck system will use the greetingManager to get system information
    discordLogger.info('Channel greetings sent successfully');
  } catch (error) {
    discordLogger.error({ error }, 'Error sending startup greetings');
  }

  // Store pfpManager for later use
  client.pfpManager = pfpManager;
});

/**
 * Initialize and start the Discord bot
 *
 * This function initializes the bot and logs in to Discord.
 * It's exposed to allow the bot to be started from other modules.
 *
 * @returns {Promise<void>}
 */
async function startBot() {
  discordLogger.info('Attempting to log in to Discord');
  try {
    // Load plugins before connecting to Discord
    discordLogger.info('Loading plugins...');
    const pluginCount = await pluginManager.loadPlugins();
    discordLogger.info({ pluginCount }, 'Plugins loaded successfully');

    // Load commands
    discordLogger.info('Loading commands...');
    const commandCount = await commandHandler.loadCommands();
    discordLogger.info({ commandCount }, 'Commands loaded successfully');


    // Connect to Discord
    await client.login(config.DISCORD_TOKEN);
    discordLogger.info('Successfully logged in to Discord');

    // Execute onBotStart hooks for plugins
    await pluginManager.executeHook('onBotStart', client);
  } catch (error) {
    discordLogger.fatal({ error }, 'Failed to start bot');
    throw error;
  }
}

/**
 * Gracefully shut down the bot and all related services
 *
 * This function handles the graceful shutdown of the bot, ensuring that
 * all connections are properly closed, pending operations are completed,
 * and resources are released before the process exits.
 *
 * @param {string} signal - The signal that triggered the shutdown
 * @param {Error} [error] - Optional error that caused the shutdown
 * @returns {Promise<void>}
 */
async function shutdownGracefully(signal, error) {
  let exitCode = 0;
  const shutdownStart = Date.now();

  try {
    discordLogger.info({ signal }, 'Graceful shutdown initiated');

    if (error) {
      discordLogger.error({ error }, 'Shutdown triggered by error');
      exitCode = 1;
    }

    // Set a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      discordLogger.fatal('Forced exit due to shutdown timeout');
      process.exit(exitCode || 1);
    }, 10000); // 10 seconds timeout

    // Clear the timeout if we exit normally
    forceExitTimeout.unref();

    // 1. Execute plugin shutdown hooks
    try {
      discordLogger.info('Executing plugin shutdown hooks');
      await pluginManager.executeHook('onBotShutdown');
      discordLogger.info('Plugin shutdown hooks executed successfully');
    } catch (shutdownError) {
      discordLogger.error({ error: shutdownError }, 'Error executing plugin shutdown hooks');
    }

    // 2. Save any pending data
    try {
      discordLogger.info('Saving pending statistics');
      const { stats } = require('./healthCheck');
      await statsStorage.saveStats(stats);
      discordLogger.info('Statistics saved successfully');
    } catch (saveError) {
      discordLogger.error({ error: saveError }, 'Error saving statistics during shutdown');
    }

    // 3. Save conversations using the optimized storage
    try {
      discordLogger.info('Shutting down conversation manager');
      await shutdownConversations();
      discordLogger.info('Conversation manager shut down successfully');
    } catch (saveError) {
      discordLogger.error({ error: saveError }, 'Error shutting down conversation manager');
    }

    // 4. Close Discord connection
    try {
      discordLogger.info('Destroying Discord client');
      client.destroy();
      discordLogger.info('Discord client destroyed successfully');
    } catch (discordError) {
      discordLogger.error({ error: discordError }, 'Error destroying Discord client');
    }

    // 5. Clean up optimization patch resources
    try {
      logger.info('Cleaning up optimization patch resources');
      await optimizationPatch.shutdown();
      logger.info('Optimization resources cleaned up successfully');
    } catch (optimizationError) {
      logger.error({ error: optimizationError }, 'Error cleaning up optimization patch resources');
    }

    // Note: Conversation optimization resources are now cleaned up in step 3

    // 7. Close any open API connections or pending requests
    // This is a placeholder - add specific cleanup for any other services as needed

    // 8. Log successful shutdown
    const shutdownDuration = Date.now() - shutdownStart;
    discordLogger.info({ durationMs: shutdownDuration }, 'Graceful shutdown completed');

    // Exit with appropriate code
    process.exit(exitCode);
  } catch (shutdownError) {
    discordLogger.fatal({ error: shutdownError }, 'Fatal error during shutdown process');
    process.exit(1);
  }
}

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
process.on('SIGINT', () => shutdownGracefully('SIGINT'));
process.on('SIGHUP', () => shutdownGracefully('SIGHUP'));

// Update Discord stats on reconnect/disconnect events
client.on('reconnecting', updateDiscordStats);
client.on('disconnect', updateDiscordStats);
client.on('shardResume', updateDiscordStats);
client.on('shardDisconnect', updateDiscordStats);

// Handle uncaught exceptions and unhandled promise rejections
process.on('uncaughtException', error => {
  shutdownGracefully('uncaughtException', error);
});

process.on('unhandledRejection', reason => {
  shutdownGracefully('unhandledRejection', new Error(`Unhandled promise rejection: ${reason}`));
});

// Start the bot if this file is run directly
if (require.main === module) {
  startBot().catch(error => {
    discordLogger.error({ error }, 'Failed to start bot');
    shutdownGracefully('startupError', error);
  });
}

// Export the bot functionality for use in other modules
module.exports = {
  client,
  startBot,
  shutdownGracefully,
  stats: require('./healthCheck').stats,
};
