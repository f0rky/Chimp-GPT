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
const { lookupWeather, lookupExtendedForecast } = require('./weatherLookup');
const simplifiedWeather = require('./simplified-weather');
const lookupTime = require('./timeLookup');
const lookupQuakeServer = require('./quakeLookup');
const { initStatusManager } = require('./statusManager');
const lookupWolfram = require('./wolframLookup');

// Import loggers
const { discord: discordLogger, openai: openaiLogger, createLogger } = require('./logger');

// Import validated configuration
const config = require('./configValidator');

// Import rate limiter
const { checkUserRateLimit } = require('./rateLimiter');

// Import health check system
const { 
  initHealthCheck, 
  trackApiCall, 
  trackError, 
  trackMessage, 
  trackRateLimit,
  isStatsCommand,
  handleStatsCommand 
} = require('./healthCheck');

// Status manager already imported above

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY
});

// Initialize Discord client with proper intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages // Add intent for DMs
  ]
});

// Add event listener for slash commands
client.on('interactionCreate', async (interaction) => {
  try {
    // Only handle chat input commands (slash commands)
    if (!interaction.isChatInputCommand()) return;
    
    // Use the command handler to process the interaction
    await commandHandler.handleSlashCommand(interaction, config);
  } catch (error) {
    discordLogger.error({ error }, 'Error handling interaction');
    
    // Reply with error if we haven't replied yet
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'An error occurred while processing this command.', ephemeral: true });
    } else if (!interaction.replied) {
      await interaction.editReply('An error occurred while processing this command.');
    }
  }
});

// Import conversation manager
const { manageConversation, clearConversation } = require('./conversationManager');

const loadingEmoji = config.LOADING_EMOJI || '⏳';
const allowedChannelIDs = config.CHANNEL_ID; // Already an array from configValidator

/**
 * Removes color codes from a string
 * 
 * This function takes a string as input and returns the string with all color codes removed.
 * 
 * @param {string} str - The input string
 * @returns {string} The string with color codes removed
 */
function removeColorCodes(str) {
  return str.replace(/\^\d+/g, '');
}

// Conversation management has been moved to conversationManager.js

/**
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
  try {
    openaiLogger.debug({ messages: conversationLog }, 'Sending request to OpenAI');
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',  // Using the latest model, adjust as needed
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
                description: 'The location to look up the time for'
              }
            },
            required: ['location']
          }
        },
        {
          name: 'lookupWeather',
          description: 'Look up the current weather for a specific location',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'The location to look up the weather for'
              }
            },
            required: ['location']
          }
        },
        {
          name: 'lookupExtendedForecast',
          description: 'Look up the extended weather forecast for a specific location',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'The location to look up the forecast for'
              }
            },
            required: ['location']
          }
        },
        {
          name: 'getWolframShortAnswer',
          description: 'Get a short answer from Wolfram Alpha',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The query to send to Wolfram Alpha'
              }
            },
            required: ['query']
          }
        },
        {
          name: 'quakeLookup',
          description: 'Look up Quake server statistics',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      ]
    });

    const responseMessage = response.choices[0].message;

    if (responseMessage.function_call) {
      return {
        type: 'functionCall',
        functionName: responseMessage.function_call.name,
        parameters: JSON.parse(responseMessage.function_call.arguments)
      };
    }

    // Track successful OpenAI API call
    trackApiCall('openai');
    
    openaiLogger.debug({ response: responseMessage }, 'Received response from OpenAI');
    return {
      type: 'message',
      content: responseMessage.content
    };
  } catch (error) {
    // Track OpenAI API error
    trackError('openai');
    
    openaiLogger.error({ error }, 'OpenAI API Error');
    return {
      type: 'error',
      content: 'Sorry, I encountered an error processing your request.'
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
    const lastUserMessage = [...conversationLog].reverse().find(msg => msg.role === 'user')?.content || '';
    
    // Create a system message with instructions based on function type
    let systemMessage = { role: 'system', content: 'Use the function result to provide a helpful and natural response to the user.' };
    
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
    const resultSize = typeof functionResult === 'object' ? 
      JSON.stringify(functionResult).length : String(functionResult).length;
    openaiLogger.debug({ resultSize, functionName }, 'Function result size');
    
    // Convert function result to string if it's an object, with proper handling for large objects
    let functionResultContent;
    if (typeof functionResult === 'object') {
      // For weather data, extract only the essential information to reduce size
      if (functionName === 'lookupWeather' || functionName === 'lookupExtendedForecast') {
        const essentialData = {
          location: functionResult.location ? {
            name: functionResult.location.name,
            country: functionResult.location.country,
            localtime: functionResult.location.localtime
          } : null,
          current: functionResult.current ? {
            temp_c: functionResult.current.temp_c,
            condition: functionResult.current.condition,
            humidity: functionResult.current.humidity,
            wind_kph: functionResult.current.wind_kph,
            wind_dir: functionResult.current.wind_dir
          } : null,
          forecast: functionResult.forecast ? {
            forecastday: functionResult.forecast.forecastday?.map(day => ({
              date: day.date,
              day: {
                maxtemp_c: day.day.maxtemp_c,
                mintemp_c: day.day.mintemp_c,
                condition: day.day.condition
              }
            }))
          } : null,
          _isMock: functionResult._isMock
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
      { role: 'function', name: 'function_response', content: functionResultContent }
    ];
    
    // Add a timeout to the OpenAI API call to prevent the bot from getting stuck
    openaiLogger.debug('Sending request to OpenAI with timeout');
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI API call timed out after 15 seconds')), 15000);
    });
    
    const response = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: messages
      }),
      timeoutPromise
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

// Handle message creation
client.on('messageCreate', async (message) => {
  try {
    // Basic checks
    if (message.author.bot) return;
    
    // Track message for stats
    trackMessage();
    
    // Ignore messages from unauthorized channels
    if (!allowedChannelIDs.includes(message.channelId)) {
      discordLogger.debug({ channelId: message.channelId }, 'Ignoring message from unauthorized channel');
      return;
    }
    
    // Track conversation for status updates - only for allowed channels
    statusManager.trackConversation(message.author.username, message.content);
    
    // Check if this is a stats command
    if (isStatsCommand(message)) {
      await handleStatsCommand(message);
      return;
    }
    
    // Try to handle the message as a command first
    const isCommand = await commandHandler.handleCommand(message, config);
    if (isCommand) {
      // If it was a command, we're done
      return;
    }
    
    // If it's a DM and not a command, ignore it
    // Regular DM conversations aren't supported
    if (message.channel.isDMBased()) {
      return;
    }
    
    // Ignore messages with ignore prefix
    if (message.content.startsWith(config.IGNORE_MESSAGE_PREFIX)) {
      return;
    }
    
    // Channel check already done above
    
    // Check rate limit for the user
    // OpenAI calls are expensive, so we use a cost of 1 for regular messages
    const rateLimitResult = await checkUserRateLimit(message.author.id, 1, {
      // Allow 5 requests per minute by default
      points: 5,
      duration: 60
    });
    
    // If user is rate limited, inform them and stop processing
    if (rateLimitResult.limited) {
      discordLogger.info({
        userId: message.author.id,
        username: message.author.username,
        secondsBeforeNext: rateLimitResult.secondsBeforeNext
      }, 'User rate limited');
      
      // Track rate limit in health check system
      trackRateLimit(message.author.id);
      
      await message.reply(`⏱️ ${rateLimitResult.message}`);
      return;
    }

    discordLogger.info({
      message: message.content,
      author: message.author.username,
      channelId: message.channelId,
      messageId: message.id,
      remainingPoints: rateLimitResult.remainingPoints
    }, 'Processing message');
    
    // Send initial feedback
    const feedbackMessage = await message.reply(`${loadingEmoji} Thinking...`);

    // Handle conversation context
    const conversationLog = manageConversation(message.author.id, {
      role: 'user',
      content: message.content
    });

    // Process message with OpenAI
    const gptResponse = await processOpenAIMessage(message.content, conversationLog);

    // Handle different response types
    if (gptResponse.type === 'functionCall') {
      await handleFunctionCall(gptResponse, feedbackMessage, conversationLog);
    } else if (gptResponse.type === 'message') {
      await handleDirectMessage(gptResponse, feedbackMessage, conversationLog);
    } else {
      await feedbackMessage.edit(gptResponse.content);
    }
  } catch (error) {
    console.error('Error in message handler:', error);
    await message.reply('Sorry, I encountered an error processing your request.');
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
    await feedbackMessage.edit(serverStats.slice(0, 1997) + (serverStats.length > 1997 ? '...' : ''));
    
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
    
    // Update status with server count
    statusManager.trackQuakeLookup(serverCount);
    
    return true;
  } catch (error) {
    console.error('Error in handleQuakeStats:', error);
    await feedbackMessage.edit('# 🎯 Quake Live Server Status\n\n> ⚠️ An error occurred while retrieving server information.');
    return false;
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
async function handleFunctionCall(gptResponse, feedbackMessage, conversationLog) {
  const loadingMessages = {
    lookupTime: 'Checking watch...',
    lookupWeather: 'Looking outside...',
    lookupExtendedForecast: "Let me ping the cloud, and I don't mean the fluffy ones...",
    getWolframShortAnswer: 'Consulting Wolfram Alpha...',
    quakeLookup: 'Checking server stats...'
  };

  await feedbackMessage.edit(`${loadingEmoji} ${loadingMessages[gptResponse.functionName] || 'Processing...'}`);
  
  // Get the user ID from the conversation log
  const userId = feedbackMessage.reference?.messageId ? 
    (await feedbackMessage.channel.messages.fetch(feedbackMessage.reference.messageId)).author.id : 
    'unknown';
  
  // Define rate limit costs for different function calls
  const functionCosts = {
    lookupTime: 1,
    lookupWeather: 2,
    lookupExtendedForecast: 3,
    getWolframShortAnswer: 3,
    quakeLookup: 2
  };
  
  // Apply stricter rate limits for API-intensive functions
  const cost = functionCosts[gptResponse.functionName] || 1;
  const rateLimitResult = await checkUserRateLimit(userId, cost, {
    // Allow more API-intensive requests with shorter duration
    points: 15,
    duration: 60 * 3 // 3 minutes
  });
  
  // If user is rate limited for this function, inform them
  if (rateLimitResult.limited) {
    discordLogger.info({
      userId,
      functionName: gptResponse.functionName,
      secondsBeforeNext: rateLimitResult.secondsBeforeNext
    }, 'User rate limited for function call');
    
    // Track rate limit in health check system
    trackRateLimit(userId);
    
    await feedbackMessage.edit(`⏱️ Rate limit reached for this function. Please wait ${Math.ceil(rateLimitResult.secondsBeforeNext / 60)} minute(s) before trying again.`);
    return;
  }

  let functionResult;
  switch (gptResponse.functionName) {
    case 'lookupTime':
      try {
        functionResult = await lookupTime(gptResponse.parameters.location);
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
        
        // Update status if we have valid weather data
        if (weatherData && weatherData.location && weatherData.current && 
            weatherData.current.condition && weatherData.current.condition.text) {
          statusManager.trackWeatherLookup(
            weatherData.location.name, 
            weatherData.current.condition.text
          );
        } else {
          discordLogger.warn({ weatherData }, 'Weather data incomplete or has errors, not updating status');
        }
        
        // Use the simplified implementation to get a natural language response
        const userQuestion = conversationLog.find(msg => msg.role === 'user')?.content || 
                            `What's the weather in ${gptResponse.parameters.location}?`;
        
        const response = await simplifiedWeather.getWeatherResponse(
          gptResponse.parameters.location,
          userQuestion
        );
        
        // Update the feedback message directly with the response
        await feedbackMessage.edit(response);
        
        // Add the response to the conversation log
        conversationLog.push({
          role: 'assistant',
          content: response
        });
        
        // Return early since we've already handled the response
        return;
      } catch (error) {
        trackError('weather');
        discordLogger.error({ error }, 'Error in weather lookup');
        await feedbackMessage.edit('I encountered an error while checking the weather. Please try again later.');
        return;
      }
      break;
    case 'lookupExtendedForecast':
      try {
        // Get the original weather data for status updates
        const weatherData = await lookupExtendedForecast(gptResponse.parameters.location, gptResponse.parameters.days);
        trackApiCall('weather');
        
        // Update status if we have valid weather data
        if (weatherData && weatherData.location && weatherData.current && 
            weatherData.current.condition && weatherData.current.condition.text) {
          statusManager.trackWeatherLookup(
            weatherData.location.name, 
            weatherData.current.condition.text
          );
        } else {
          discordLogger.warn({ weatherData }, 'Weather data incomplete or has errors, not updating status');
        }
        
        // Use the simplified implementation to get a natural language response
        const userQuestion = conversationLog.find(msg => msg.role === 'user')?.content || 
                            `What's the ${gptResponse.parameters.days}-day forecast for ${gptResponse.parameters.location}?`;
        
        const response = await simplifiedWeather.getWeatherResponse(
          gptResponse.parameters.location,
          userQuestion
        );
        
        // Update the feedback message directly with the response
        await feedbackMessage.edit(response);
        
        // Add the response to the conversation log
        conversationLog.push({
          role: 'assistant',
          content: response
        });
        
        // Return early since we've already handled the response
        return;
      } catch (error) {
        trackError('weather');
        discordLogger.error({ error }, 'Error in extended forecast lookup');
        await feedbackMessage.edit('I encountered an error while checking the forecast. Please try again later.');
        return;
      }
      break;
    case 'getWolframShortAnswer':
      try {
        functionResult = await lookupWolfram.getWolframShortAnswer(gptResponse.parameters.query);
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
  }

  try {
    // Log the function result for debugging
    discordLogger.debug({ functionName: gptResponse.functionName }, 'Generating natural response from function result');
    
    const naturalResponse = await generateNaturalResponse(functionResult, conversationLog, gptResponse.functionName);
    
    if (naturalResponse?.trim()) {
      conversationLog.push({
        role: 'assistant',
        content: naturalResponse
      });
      
      await feedbackMessage.edit(naturalResponse?.slice(0, 1997) + (naturalResponse?.length > 1997 ? '...' : ''));
    } else {
      // If no natural response was generated, provide a direct response with the data
      let directResponse = '';
      
      if (gptResponse.functionName === 'lookupWeather' || gptResponse.functionName === 'lookupExtendedForecast') {
        if (functionResult && functionResult.location && functionResult.current) {
          directResponse = `Current weather in ${functionResult.location.name}: ${functionResult.current.condition.text}, ${functionResult.current.temp_c}°C`;
          
          // Add forecast if available
          if (functionResult.forecast && functionResult.forecast.forecastday && functionResult.forecast.forecastday.length > 0) {
            directResponse += '\n\nForecast:';
            functionResult.forecast.forecastday.forEach(day => {
              directResponse += `\n${day.date}: ${day.day.condition.text}, ${day.day.maxtemp_c}°C / ${day.day.mintemp_c}°C`;
            });
          }
        } else {
          directResponse = 'Weather data could not be retrieved. Please try again later.';
        }
      } else {
        directResponse = 'I retrieved the information but couldn\'t generate a natural response. Here\'s the raw data:\n\n' + 
          JSON.stringify(functionResult, null, 2).slice(0, 1500);
      }
      
      await feedbackMessage.edit(directResponse);
    }
  } catch (error) {
    discordLogger.error({ error, functionName: gptResponse.functionName }, 'Error in natural response generation');
    
    // Provide a fallback response with the raw data
    let fallbackResponse = 'I encountered an error while processing the response, but here\'s what I found:\n\n';
    
    if (gptResponse.functionName === 'lookupWeather' || gptResponse.functionName === 'lookupExtendedForecast') {
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
async function handleDirectMessage(gptResponse, feedbackMessage, conversationLog) {
  if (!gptResponse.content?.trim()) {
    await feedbackMessage.edit("Sorry, I couldn't understand your request. Please try again.");
    return;
  }

  conversationLog.push({
    role: 'assistant',
    content: gptResponse.content
  });

  const finalResponse = gptResponse.content.slice(0, 1997) + (gptResponse.content.length > 1997 ? '...' : '');
  await feedbackMessage.edit(finalResponse);
}

// Ready event
client.on('ready', async () => {
  discordLogger.info(`Logged in as ${client.user.tag}`);
  
  // Initialize health check and status manager

  // Initialize health check system
  healthCheck = initHealthCheck(client);
  discordLogger.info('Health check system initialized');
  
  // Initialize status manager
  statusManager = initStatusManager(client);
  discordLogger.info('Status manager initialized');
  
  // Load command modules
  const commandsLoaded = await commandHandler.loadCommands();
  discordLogger.info({ commandsLoaded }, 'Command modules loaded');
  
  // Set command prefixes
  commandHandler.setPrefixes(['!', '.']);
  discordLogger.info({ prefixes: commandHandler.prefixes }, 'Command prefixes set');
  
  // Check if we have a CLIENT_ID for slash commands
  if (config.CLIENT_ID) {
    try {
      // Deploy slash commands
      const deployResult = await commandHandler.deployCommands(config);
      discordLogger.info({ deployResult }, 'Slash commands deployed');
    } catch (error) {
      discordLogger.error({ error }, 'Error deploying slash commands');
    }
  } else {
    discordLogger.warn('CLIENT_ID not found in config, slash commands will not be deployed');
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
    await client.login(config.DISCORD_TOKEN);
    discordLogger.info('Successfully logged in to Discord');
  } catch (error) {
    discordLogger.fatal({ error }, 'Failed to log in to Discord');
    throw error;
  }
}

// Start the bot if this file is run directly
if (require.main === module) {
  startBot().catch(error => {
    console.error('Failed to start bot:', error);
    process.exit(1);
  });
}

// Export the bot functionality for use in other modules
module.exports = {
  client,
  startBot,
  stats: require('./healthCheck').stats
};