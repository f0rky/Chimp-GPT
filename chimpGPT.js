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
 * @version 1.6.0
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
const commandHandler = require('./commands/commandHandler');

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

// Import malicious user manager for tracking suspicious behavior
const maliciousUserManager = require('./utils/maliciousUserManager');

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
    GatewayIntentBits.GuildMessageReactions, // Required for reaction collectors
    GatewayIntentBits.DirectMessageReactions, // Required for DM reaction collectors
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

// Import conversation manager - dynamically selected based on configuration
// This will use either blended or individual conversation mode based on USE_BLENDED_CONVERSATIONS setting
const {
  manageConversation,
  loadConversationsFromStorage,
  saveConversationsToStorage,
  stopPeriodicSaving, // Note: startPeriodicSaving is not needed with the optimized version
  getActiveConversationCount,
  getConversationStorageStatus,
  clearConversation,
  removeMessageById,
  updateMessageById,
  shutdown: shutdownConversations,
} = require('./conversationManagerSelector');

const loadingEmoji = config.LOADING_EMOJI || '⏳';
const allowedChannelIDs = config.CHANNEL_ID; // Already an array from configValidator

/**
 * Removes color codes from a string
 *
 * Processes a message using OpenAI's GPT model
 *
 * This function sends the conversation context to OpenAI's API and handles the response.
 * It uses the latest user message from the conversation log for processing.
 * It includes function calling capabilities for weather, time, Quake server stats,
 * and Wolfram Alpha queries.
 *
 * @param {string} content - The user's message content (fallback if conversation log is empty)
 * @param {Array<Object>} conversationLog - The conversation history
 * @returns {Promise<Object>} The response from OpenAI
 * @throws {Error} If the API call fails
 */
async function processOpenAIMessage(content, conversationLog, timings = {}) {
  // Get the latest user message from the conversation log
  const latestUserMessage = [...conversationLog].reverse().find(msg => msg.role === 'user');
  const currentContent = latestUserMessage ? latestUserMessage.content : content;

  // Debug logging to help track conversation flow issues
  if (currentContent !== content) {
    openaiLogger.debug('Using conversation log content instead of passed content', {
      passedContent: content,
      conversationLogContent: currentContent,
      conversationLength: conversationLog.length,
    });
  }

  const timerId = performanceMonitor.startTimer('openai_api_detail', {
    messageLength: currentContent.length,
    contextLength: JSON.stringify(conversationLog).length,
  });
  try {
    // Check for explicit image generation intent in the current message
    const lowerContent = currentContent.toLowerCase().trim();
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

    // If it's clearly an image request, bypass the full context
    if (isImageRequest) {
      openaiLogger.debug('Detected image generation request', { content: currentContent });
      // Clean up the prompt by removing the command phrases
      let cleanPrompt = currentContent;
      for (const phrase of imagePhrases) {
        cleanPrompt = cleanPrompt.replace(phrase, '').trim();
      }
      return {
        type: 'functionCall',
        functionName: 'generateImage',
        parameters: { prompt: cleanPrompt },
      };
    }

    // Otherwise, use the full context for other requests
    openaiLogger.debug({ messages: conversationLog }, 'Sending request to OpenAI');
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-nano',
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
                enum: ['1024x1024', '1024x1536', '1536x1024'],
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

    // Extract token usage information
    const usage = response.usage || {};

    if (responseMessage.function_call) {
      const result = {
        type: 'functionCall',
        functionName: responseMessage.function_call.name,
        parameters: JSON.parse(responseMessage.function_call.arguments),
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
      };

      performanceMonitor.stopTimer(timerId, {
        responseType: 'functionCall',
        functionName: responseMessage.function_call.name,
        success: true,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
      });

      return result;
    }

    // Track successful OpenAI API call
    trackApiCall('openai');
    if (timings.apiCalls) {
      timings.apiCalls.openai = (timings.apiCalls.openai || 0) + 1;
    }

    openaiLogger.debug({ response: responseMessage }, 'Received response from OpenAI');
    const result = {
      type: 'message',
      content: responseMessage.content,
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
    };

    performanceMonitor.stopTimer(timerId, {
      responseType: 'message',
      success: true,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
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
async function generateNaturalResponse(
  functionResult,
  conversationLog,
  functionName = null,
  timings = null
) {
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
        model: 'gpt-4.1-nano', // Using faster model for better responsiveness
        messages: messages,
      }),
      timeoutPromise,
    ]);

    // Track successful OpenAI API call
    trackApiCall('openai');
    if (timings?.apiCalls) {
      timings.apiCalls.openai = (timings.apiCalls.openai || 0) + 1;
    }
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

// Command handler system already imported at top of file

// Track in-progress operations
const inProgressOperations = new Set();

// Handle message deletion
client.on('messageDelete', async message => {
  try {
    // Only process messages from allowed channels
    if (!allowedChannelIDs.includes(message.channelId)) {
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
        await maliciousUserManager.checkForSuspiciousBehavior(message.author.id, client);
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

    // Save conversations after removal
    await saveConversationsToStorage();
  } catch (error) {
    discordLogger.error({ error, messageId: message.id }, 'Error handling message deletion');
  }
});

// Handle message updates (edits)
client.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    // Only process messages from allowed channels
    if (!allowedChannelIDs.includes(newMessage.channelId)) {
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
});

// Handle message creation
client.on('messageCreate', async message => {
  // Check if client is ready before processing
  if (!client.isReady()) {
    return;
  }

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

    // HIGHEST PRIORITY: Send initial feedback IMMEDIATELY before any other processing
    // This ensures users get immediate feedback that their message was received
    addTiming('before_thinking_message');
    const feedbackPromise = message.channel.send(`${loadingEmoji} Thinking...`);

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

      // Update the feedback message with the version response and standardized subtext
      const subtext = formatSubtext(timings.startTime, {}, {});
      const maxLength = 2000 - subtext.length - 3;
      let finalResponse = versionResponse.content;
      if (finalResponse.length > maxLength) {
        finalResponse = finalResponse.slice(0, maxLength) + '...';
      }
      finalResponse += subtext;
      await feedbackMessage.edit(finalResponse);

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
      gptResponse = await processOpenAIMessage(message.content, fullConversationLog, timings);
      const apiDuration = addTiming('after_openai_api_call', { responseType: gptResponse.type });

      performanceMonitor.stopTimer(openaiTimerId, {
        responseType: gptResponse.type,
        success: true,
        duration: apiDuration,
      });

      // Handle different response types
      addTiming('before_response_handling', { responseType: gptResponse.type });
      if (gptResponse.type === 'functionCall') {
        await handleFunctionCall(
          gptResponse,
          feedbackMessage,
          fullConversationLog,
          message.author.id,
          timings.startTime,
          timings
        );
        // Safe access to function name with fallback to prevent TypeError
        addTiming('after_function_call_handling', {
          functionName: gptResponse.function?.name || 'unknown',
        });
      } else if (gptResponse.type === 'message') {
        await handleDirectMessage(
          gptResponse,
          feedbackMessage,
          fullConversationLog,
          message.author.id,
          timings.startTime, // Use the original start time from when message was received
          gptResponse.usage, // Pass token usage information
          timings.apiCalls // Pass API call counts
        );
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

    await message.channel.send('Sorry, I encountered an error processing your request.');

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
async function handleImageGeneration(
  parameters,
  message,
  conversationLog = [],
  startTime = null,
  usage = {},
  apiCalls = {}
) {
  try {
    // Use the start time passed in or from handleFunctionCall if available, otherwise use current time
    const actualStartTime = startTime || message.imageGenerationStartTime || Date.now();

    // Calculate how much time has already passed since the initial message
    const initialDelay = Date.now() - actualStartTime;
    discordLogger.debug(
      {
        startTime,
        currentTime: Date.now(),
        initialDelay,
      },
      'Starting handleImageGeneration with timing information'
    );

    let currentPhase = 'initializing';

    // Create a progress tracking object
    const progress = {
      startTime: actualStartTime,
      phases: {
        initializing: { start: actualStartTime, end: null, elapsed: 0 },
        enhancing: { start: null, end: null, elapsed: 0 },
        generating: { start: null, end: null, elapsed: 0 },
        downloading: { start: null, end: null, elapsed: 0 },
        uploading: { start: null, end: null, elapsed: 0 },
      },
      currentPhase,
      totalElapsed: 0,
    };

    // Keep track of completed phases for the status message
    const completedPhases = [];

    // Function to update progress
    const updateProgress = (newPhase = null) => {
      const now = Date.now();

      // If we're changing phases, update the phase timing
      if (newPhase && newPhase !== currentPhase) {
        // End the current phase
        progress.phases[currentPhase].end = now;
        progress.phases[currentPhase].elapsed = now - progress.phases[currentPhase].start;

        // Add the completed phase to our tracking array if it's not already there
        if (!completedPhases.includes(currentPhase)) {
          completedPhases.push(currentPhase);
        }

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
    if (message.channel && typeof message.channel.send === 'function') {
      // This is a regular message, send to channel instead of replying
      feedbackMessage = await message.channel.send('🎨 Creating your image...');
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

        // Add phase-specific messages for current phase
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

        // Add completed phases with checkmarks
        if (completedPhases.length > 0) {
          statusMessage += '\n\n**Completed:**';
          if (completedPhases.includes('initializing')) {
            statusMessage += '\n✅ Initialization';
          }
          if (completedPhases.includes('enhancing')) {
            statusMessage += '\n✅ Prompt enhancement';
          }
          if (completedPhases.includes('generating')) {
            statusMessage += '\n✅ Image generation';
          }
          if (completedPhases.includes('downloading')) {
            statusMessage += '\n✅ Image download';
          }
        }

        // Check if message is a command
        if (message.content.startsWith('!')) {
          try {
            const args = message.content.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            if (command === 'ping') {
              const sent = await message.channel.send('Pinging...');
              await sent.edit(
                `Pong! Latency is ${sent.createdTimestamp - message.createdTimestamp}ms.`
              );
              return;
            }

            if (command === 'stats') {
              await handleStatsCommand(message);
              return;
            }

            // The 'pfp' command is now handled by its own module (commands/modules/pfp.js)
            // and processed by the main commandHandler. Removing the local check here.

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
                  "`!pfp` - Change the bot's profile picture\n" +
                  "`!status <message>` - Set the bot's status message\n" +
                  '`!clear` - Clear the conversation history for this channel'
              );
              return;
            }

            // If we get here, the command wasn't recognized
            return;
          } catch (error) {
            discordLogger.error({ error }, 'Error processing command');
            await message.channel.send('❌ An error occurred while processing your command.');
            return;
          }
        }

        // Only update every 5 seconds to avoid rate limits
        await feedbackMessage.edit(statusMessage);
      } catch (error) {
        discordLogger.error({ error }, 'Error updating image generation progress');
      }
    }, UPDATE_INTERVAL);

    // IMPORTANT FIX: Move to generating phase IMMEDIATELY after setup is complete
    // This ensures that only the minimal setup time is attributed to initialization
    updateProgress('generating');

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

    // Generate the image
    let result;
    let generationTime;

    try {
      result = await generateImage(finalPrompt, {
        model: parameters.model || 'gpt-image-1',
        size: parameters.size || '1024x1024',
      });

      // Check for content policy violation or if generation is disabled
      if (!result.success) {
        const errorMessageText =
          typeof result.error === 'string'
            ? result.error
            : result.error?.message || 'Unknown error from generateImage';
        if (errorMessageText === 'Image generation is currently disabled') {
          discordLogger.warn(
            {
              prompt: finalPrompt,
              userId: message.author?.id,
              guildId: message.guild?.id,
            },
            'Image generation is disabled; informing user and stopping.'
          );
          if (feedbackMessage && typeof feedbackMessage.edit === 'function') {
            await feedbackMessage.edit(
              '❌ Image generation is currently disabled. Please try again later.'
            );
          }
          // The main `finally` block of handleImageGeneration will clear the progressUpdater interval.
          return; // Exit handleImageGeneration gracefully
        }

        if (result.isContentPolicyViolation) {
          const error = new Error(errorMessageText);
          error.isContentPolicyViolation = true;
          throw error; // This will be caught by the catch block below
        }
        throw new Error(errorMessageText); // This will be caught by the catch block below
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
      // Log first, then check for specific conditions
      discordLogger.error(
        {
          error,
          prompt: finalPrompt,
          userId: message.author?.id,
          guildId: message.guild?.id,
        },
        'Image generation failed within inner try/catch'
      );

      if (error.message === 'Image generation is currently disabled') {
        discordLogger.warn(
          {
            prompt: finalPrompt,
            userId: message.author?.id,
            guildId: message.guild?.id,
          },
          'Caught "disabled" error explicitly in catch block; informing user and stopping.'
        );
        if (feedbackMessage && typeof feedbackMessage.edit === 'function') {
          await feedbackMessage.edit(
            '❌ Image generation is currently disabled. Please try again later.'
          );
        } else {
          discordLogger.warn(
            'feedbackMessage not available or not editable for "disabled" error in catch.'
          );
        }
        // The main `finally` block of handleImageGeneration will clear the progressUpdater interval.
        return; // Exit handleImageGeneration gracefully
      }

      // Handle content policy violations specially
      if (
        error.isContentPolicyViolation ||
        (error.status === 400 && error.code === 'moderation_blocked')
      ) {
        const userMessage =
          'This request was rejected due to content policy violations. Please modify your prompt and try again.';
        if (feedbackMessage && typeof feedbackMessage.edit === 'function') {
          await feedbackMessage.edit(`❌ ${userMessage}`);
        }
        // Create a new error with a specific type that we can check for
        const policyError = new Error(error.message || userMessage); // Use original error message if available
        policyError.isContentPolicyViolation = true;
        throw policyError; // Re-throw to be handled by the outer catch of handleImageGeneration
      } else {
        // For other errors, show a generic error message and re-throw
        const userMessage = `Failed to generate image: ${error.message || 'An unknown error occurred'}`;
        if (feedbackMessage && typeof feedbackMessage.edit === 'function') {
          await feedbackMessage.edit(`❌ ${userMessage}`);
        }
        throw new Error(userMessage); // Re-throw to be handled by the outer catch of handleImageGeneration
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
        const urlObj = new URL(imageResult.url);

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
        const filename = `gpt-${timestamp}-${randomStr}.png`; // Ensure .png extension

        discordLogger.info('Attempting to save image to PFP rotation', {
          filename,
          bufferSize: buffer.length,
          hasPfpManager: !!client.pfpManager,
        });

        // Save the image to the PFP rotation
        const savedPath = await client.pfpManager.addImage(buffer, filename);
        discordLogger.info('Image added to PFP rotation', { savedPath });

        // Trigger an immediate PFP update with the new image
        try {
          await client.pfpManager.updateBotAvatar();
          discordLogger.info('PFP updated with new image');
        } catch (updateError) {
          discordLogger.warn(
            { error: updateError },
            'Failed to immediately update PFP with new image'
          );
        }
      } catch (error) {
        discordLogger.error(
          {
            error: error.message,
            stack: error.stack,
            bufferSize: buffer?.length,
          },
          'Failed to add image to PFP rotation'
        );
      }
    } else {
      discordLogger.warn('Skipping PFP save', {
        reason:
          process.env.NODE_ENV === 'test'
            ? 'test environment'
            : process.env.NODE_ENV === 'development'
              ? 'development environment'
              : !client.pfpManager
                ? 'pfpManager not available'
                : 'unknown reason',
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

    // Track the image generation for usage statistics
    try {
      const imageUsageTracker = require('./imageUsageTracker');
      const userId = message.author?.id || 'unknown';
      const authorUsername = message.author?.username || 'unknown';

      // Track this image generation request
      const usageStats = imageUsageTracker.trackImageGeneration({
        prompt: finalPrompt,
        size: parameters.size || '1024x1024',
        quality: parameters.quality || 'auto',
        cost: result.estimatedCost || 0,
        apiCallDuration: result.apiCallDuration || 0,
        userId,
        username: authorUsername,
      });

      discordLogger.info(
        {
          totalRequests: usageStats.totalRequests,
          totalCost: usageStats.totalCost,
        },
        'Updated image generation usage statistics'
      );
    } catch (error) {
      discordLogger.error({ error }, 'Failed to track image generation usage');
    }

    // Send the image with information about the prompt, timing, and cost details
    // Include API call timing information in the footer
    const apiCallInfo = result.apiCallDuration
      ? `\n🔄 API call: ${formatElapsed(result.apiCallDuration)} | Processing: ${formatElapsed(result.totalProcessingTime - result.apiCallDuration)}`
      : '';

    // Update API calls count
    const updatedApiCalls = { ...apiCalls };
    if (updatedApiCalls.gptimage) {
      updatedApiCalls.gptimage++;
    } else {
      updatedApiCalls.gptimage = 1;
    }

    // Build the standardized subtext
    const subtext = formatSubtext(actualStartTime, usage, updatedApiCalls);

    await feedbackMessage.edit({
      content: `🖼️ Image generated by GPT Image-1
📝 ${parameters.enhance ? 'Enhanced prompt' : 'Prompt'}: "${revisedPrompt}"
💰 Estimated cost: $${result.estimatedCost ? result.estimatedCost.toFixed(4) : '0.0000'}
🔢 Size: ${parameters.size || '1024x1024'} | Quality: ${parameters.quality || 'auto'}${subtext}`,
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
async function handleFunctionCall(
  gptResponse,
  feedbackMessage,
  conversationLog,
  userIdFromMessage,
  startTime = Date.now(),
  timings = {}
) {
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
    getVersion: 'Checking my version...',
  };

  // Special handling for image generation to match the format used in handleImageGeneration
  if (gptResponse.functionName === 'generateImage') {
    // Record the time when we start the image generation process
    const imageStartTime = Date.now();
    discordLogger.debug(
      { time: imageStartTime },
      'Starting image generation process in handleFunctionCall'
    );

    const initialMessage = `🎨 Creating your image... (0s)

🔄 Currently: ⚙️ Initializing...`;
    await feedbackMessage.edit(initialMessage);

    // Store the start time in a property on the message object so handleImageGeneration can use it
    feedbackMessage.imageGenerationStartTime = imageStartTime;
  } else {
    await feedbackMessage.edit(
      `${loadingEmoji} ${loadingMessages[gptResponse.functionName] || 'Processing...'}`
    );
  }

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
        if (timings.apiCalls) timings.apiCalls.time++;
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
        if (timings.apiCalls) timings.apiCalls.weather++;
        discordLogger.info(
          { location: gptResponse.parameters.location, weatherData, source: 'lookupWeather_case' },
          'Weather data fetched in handleFunctionCall'
        );

        // Update status if we have valid weather data
        if (
          weatherData &&
          weatherData.location &&
          weatherData.current &&
          weatherData.current.condition &&
          weatherData.current.condition.text
        ) {
          statusManager.trackWeatherLookup(
            weatherData.location.name,
            weatherData.current.condition.text
          );
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
        discordLogger.info(
          {
            location: gptResponse.parameters.location,
            days: gptResponse.parameters.days,
            weatherData,
            source: 'lookupExtendedForecast_case',
          },
          'Weather data fetched in handleFunctionCall'
        );

        // Update status if we have valid weather data
        if (
          weatherData &&
          weatherData.location &&
          weatherData.current &&
          weatherData.current.condition &&
          weatherData.current.condition.text
        ) {
          statusManager.trackWeatherLookup(
            weatherData.location.name,
            weatherData.current.condition.text
          );
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
        if (timings.apiCalls) timings.apiCalls.wolfram++;
      } catch (error) {
        trackError('wolfram');
        throw error;
      }
      break;
    case 'quakeLookup':
      try {
        await handleQuakeStats(feedbackMessage);
        trackApiCall('quake');
        if (timings.apiCalls) timings.apiCalls.quake++;
        return;
      } catch (error) {
        trackError('quake');
        throw error;
      }
    case 'generateImage':
      try {
        // First, check if image generation is disabled WITHOUT actually generating an image
        // This was causing a double image generation issue
        const imageGeneration = require('./imageGeneration');

        // Just check the environment variable directly instead of calling generateImage
        // Simplified to avoid requiring non-existent config file
        const isEnabled = process.env.ENABLE_IMAGE_GENERATION === 'true';
        const testResult = {
          success: isEnabled,
          error: isEnabled ? null : 'Image generation is currently disabled',
          prompt: gptResponse.parameters.prompt,
        };

        discordLogger.debug(
          { isEnabled },
          'Checked if image generation is enabled without generating an image'
        );

        // If image generation is disabled, fall back to a natural language response
        if (!testResult.success && testResult.error === 'Image generation is currently disabled') {
          discordLogger.warn(
            { prompt: gptResponse.parameters.prompt },
            'Image generation is disabled, falling back to natural language response'
          );

          // Inform the user that image generation is disabled but we'll provide a text response
          await feedbackMessage.edit(
            '❌ Image generation is currently disabled. Let me describe what you are looking for instead...'
          );

          // Get the original user message from the conversation log
          const userMessage =
            conversationLog.find(msg => msg.role === 'user')?.content ||
            `Can you describe ${gptResponse.parameters.prompt}?`;

          // Create a new prompt asking GPT to describe the image instead of generating it
          const descriptionPrompt = [
            ...conversationLog.filter(
              msg =>
                msg.role !== 'user' || conversationLog.indexOf(msg) !== conversationLog.length - 1
            ),
            {
              role: 'user',
              content: `Since image generation is disabled, please provide a detailed description of what an image of "${gptResponse.parameters.prompt}" might look like.`,
            },
          ];

          // Create a mock function result for the image description
          const mockImageResult = {
            description: `Image description for prompt: ${gptResponse.parameters.prompt}`,
            prompt: gptResponse.parameters.prompt,
            disabled: true,
          };
          // Get a natural language response from GPT
          const description = await generateNaturalResponse(
            mockImageResult,
            descriptionPrompt,
            'generateImage'
          );

          // Update the feedback message with the description
          await feedbackMessage.edit(description);

          // Add the response to the conversation log
          conversationLog.push({
            role: 'assistant',
            content: description,
          });

          // Track the API call and return
          trackApiCall('gpt');
          performanceMonitor.stopTimer(functionCallTimerId, { success: true });
          return;
        }

        // If image generation is enabled, proceed as normal
        // IMPORTANT FIX: Update the start time right before calling handleImageGeneration
        // This ensures we don't count the disabled check as part of initialization
        feedbackMessage.imageGenerationStartTime = Date.now();
        discordLogger.debug(
          { time: feedbackMessage.imageGenerationStartTime },
          'Updated start time before calling handleImageGeneration'
        );

        await handleImageGeneration(
          gptResponse.parameters,
          feedbackMessage,
          conversationLog,
          startTime,
          gptResponse.usage,
          timings.apiCalls
        );
        trackApiCall('gptimage');
        if (timings.apiCalls) timings.apiCalls.gptimage++;
        return;
      } catch (error) {
        trackError('gptimage');
        discordLogger.error({ error }, 'Error in image generation');

        // If this was a content policy violation, we've already shown the message
        if (error.isContentPolicyViolation) {
          discordLogger.info('Content policy violation handled');
          return;
        }

        // Check if the error is about image generation being disabled
        if (error.message && error.message.includes('Image generation is currently disabled')) {
          discordLogger.warn(
            { prompt: gptResponse.parameters.prompt },
            'Caught disabled error in catch block, falling back to natural language response'
          );

          // Inform the user that image generation is disabled but we'll provide a text response
          await feedbackMessage.edit(
            '❌ Image generation is currently disabled. Let me describe what you are looking for instead...'
          );

          // Get the original user message from the conversation log
          const userMessage =
            conversationLog.find(msg => msg.role === 'user')?.content ||
            `Can you describe ${gptResponse.parameters.prompt}?`;

          // Create a mock function result for the image description
          const mockImageResult = {
            description: `Image description for prompt: ${gptResponse.parameters.prompt}`,
            prompt: gptResponse.parameters.prompt,
            disabled: true,
          };
          // Create a new prompt asking GPT to describe the image instead of generating it
          const descriptionPrompt = [
            ...conversationLog.filter(
              msg =>
                msg.role !== 'user' || conversationLog.indexOf(msg) !== conversationLog.length - 1
            ),
            {
              role: 'user',
              content: `Since image generation is disabled, please provide a detailed description of what an image of "${gptResponse.parameters.prompt}" might look like.`,
            },
          ];

          // Get a natural language response from GPT
          const description = await generateNaturalResponse(
            mockImageResult,
            descriptionPrompt,
            'generateImage'
          );

          // Update the feedback message with the description
          await feedbackMessage.edit(description);

          // Add the response to the conversation log
          conversationLog.push({
            role: 'assistant',
            content: description,
          });

          // Track the API call and return
          trackApiCall('gpt');
          performanceMonitor.stopTimer(functionCallTimerId, { success: true });
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
    default:
      discordLogger.warn({ functionName: gptResponse.functionName }, 'Unknown function name');
      functionResult = { error: `Unknown function: ${gptResponse.functionName}` };
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
      gptResponse.functionName,
      timings
    );

    if (naturalResponse?.trim()) {
      conversationLog.push({
        role: 'assistant',
        content: naturalResponse,
      });

      // Calculate standardized subtext
      const subtext = formatSubtext(startTime, gptResponse.usage, timings.apiCalls);
      const maxLength = 2000 - subtext.length - 3;

      let finalResponse = naturalResponse;
      if (finalResponse.length > maxLength) {
        finalResponse = finalResponse.slice(0, maxLength) + '...';
      }
      finalResponse += subtext;

      await feedbackMessage.edit(finalResponse);
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

      // Add timing and token info to direct response
      // Add standardized subtext to direct response
      const subtext = formatSubtext(startTime, gptResponse.usage, timings.apiCalls);
      const maxLength = 2000 - subtext.length - 3;

      if (directResponse.length > maxLength) {
        directResponse = directResponse.slice(0, maxLength) + '...';
      }
      directResponse += subtext;

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
 * Formats a standardized subtext with timing, token usage, and API call information
 * @param {number} startTime - The timestamp when processing started
 * @param {Object} usage - Token usage information {promptTokens, completionTokens}
 * @param {Object} apiCalls - API calls made {openai: 0, weather: 0, wolfram: 0, etc}
 * @returns {string} Formatted subtext string
 */
function formatSubtext(startTime, usage = {}, apiCalls = {}) {
  // Calculate processing time
  const processingTimeMs = Date.now() - startTime;
  const processingTime = (processingTimeMs / 1000).toFixed(1);

  // Format timing display
  let timingDisplay;
  if (processingTime < 1) {
    timingDisplay = `${processingTimeMs}ms`;
  } else {
    timingDisplay = `${parseFloat(processingTime)}s`;
  }

  // Build token info if available
  let tokenInfo = '';
  if (usage.promptTokens || usage.completionTokens) {
    tokenInfo = ` • ${usage.promptTokens || 0}↑ ${usage.completionTokens || 0}↓`;
  }

  // Build API calls info if any were made
  let apiCallsInfo = '';
  const apiCallEntries = Object.entries(apiCalls).filter(([_, count]) => count > 0);
  if (apiCallEntries.length > 0) {
    const callsList = apiCallEntries
      .map(([api, count]) => (count > 1 ? `${api}×${count}` : api))
      .join(', ');
    apiCallsInfo = ` • ${callsList}`;
  }

  return `\n\n-# ${timingDisplay}${tokenInfo}${apiCallsInfo}`;
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
async function handleDirectMessage(
  gptResponse,
  feedbackMessage,
  conversationLog,
  userIdFromMessage,
  startTime = Date.now(),
  usage = {},
  apiCalls = {}
) {
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

  // Prepare the final response with standardized subtext
  let finalResponse = gptResponse.content;
  const subtext = formatSubtext(startTime, usage, apiCalls);

  // Ensure the total length doesn't exceed Discord's 2000 character limit
  const maxLength = 2000 - subtext.length - 3; // -3 for potential ellipsis
  if (finalResponse.length > maxLength) {
    finalResponse = finalResponse.slice(0, maxLength) + '...';
  }

  // Append the subtext
  finalResponse += subtext;

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

  // Initialize malicious user manager
  try {
    await maliciousUserManager.init();
    discordLogger.info('Malicious user manager initialized');
  } catch (error) {
    discordLogger.error({ error }, 'Error initializing malicious user manager');
  }

  // Load conversations from persistent storage
  try {
    await loadConversationsFromStorage();
    discordLogger.info('Conversations loaded from persistent storage using optimized storage');

    // Note: Periodic saving is handled internally by the optimizer
    discordLogger.info('Conversation optimization active - periodic saving handled automatically');
  } catch (error) {
    discordLogger.error({ error }, 'Error loading conversations from persistent storage');
  }

  // Initialize PFP Manager EARLIER to ensure it's available for commands
  const pfpManager = new PFPManager(client, {
    pfpDir: path.join(__dirname, 'pfp'),
    maxImages: 50,
    rotationInterval: 10 * 60 * 1000, // 10 minutes
  });
  client.pfpManager = pfpManager; // Assign to client immediately
  discordLogger.info('PFP Manager initialized and attached to client.');
  // Diagnostic log
  if (client.pfpManager) {
    discordLogger.info(
      {
        pfpManagerStatus: 'Assigned to client',
        typeof: typeof client.pfpManager,
        constructorName: client.pfpManager.constructor ? client.pfpManager.constructor.name : 'N/A',
        methods:
          typeof client.pfpManager === 'object'
            ? Object.getOwnPropertyNames(client.pfpManager.constructor.prototype)
            : 'N/A',
      },
      'PFP Manager diagnostic after assignment in ready event'
    );
  } else {
    discordLogger.error('PFP Manager FAILED to attach to client in ready event.');
  }

  // Start PFP rotation if not in development (can happen after assignment)
  if (process.env.NODE_ENV !== 'development') {
    pfpManager.startRotation();
    discordLogger.info('PFP rotation started');
  }

  // Load command modules (now pfpManager will be available to them)
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
        await recordSuccessfulDeployment();
      } catch (error) {
        discordLogger.error({ error }, 'Error deploying slash commands');
      }
    } else {
      // Log already handled by shouldDeploy
    }
  } else {
    discordLogger.warn(
      'CLIENT_ID not found in config, slash commands will not be deployed or checked.'
    );
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

    // Log conversation mode configuration
    const conversationMode = {
      blended: config.USE_BLENDED_CONVERSATIONS,
      replyContext: config.ENABLE_REPLY_CONTEXT,
      maxPerUser: config.MAX_MESSAGES_PER_USER_BLENDED,
    };
    const modeDescription = conversationMode.blended
      ? conversationMode.replyContext
        ? 'Blended with Reply Context'
        : 'Blended Only'
      : conversationMode.replyContext
        ? 'Individual with Reply Context'
        : 'Individual Only';

    discordLogger.info(
      {
        conversationMode: modeDescription,
        blendedConversations: conversationMode.blended,
        replyContext: conversationMode.replyContext,
        maxMessagesPerUser: conversationMode.maxPerUser,
      },
      'Conversation mode configuration'
    );

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
