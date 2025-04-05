require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');
const { 
  lookupWeather, 
  lookupExtendedForecast 
} = require('./weatherLookup');
const lookupTime = require('./timeLookup');
const lookupQuakeServer = require('./quakeLookup');
const lookupWolfram = require('./wolframLookup');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Discord client with proper intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const userConversations = new Map();
const MAX_CONVERSATION_LENGTH = 8;
const loadingEmoji = process.env.LOADING_EMOJI;
const allowedChannelIDs = (process.env.CHANNEL_ID || '').split(',');

// Helper function to remove color codes
function removeColorCodes(str) {
  return str.replace(/\^\d+/g, '');
}

// Function to manage conversation context
function manageConversation(userId, newMessage = null) {
  if (!userConversations.has(userId)) {
    userConversations.set(userId, [
      { role: 'system', content: process.env.BOT_PERSONALITY }
    ]);
  }

  const conversation = userConversations.get(userId);
  
  if (newMessage) {
    conversation.push(newMessage);
    // Maintain max length
    while (conversation.length > MAX_CONVERSATION_LENGTH) {
      conversation.shift();
    }
  }

  return conversation;
}

// Function to process messages with OpenAI
async function processOpenAIMessage(content, conversationLog) {
  try {
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

    return {
      type: 'message',
      content: responseMessage.content
    };
  } catch (error) {
    console.error('OpenAI API Error:', error);
    return {
      type: 'error',
      content: 'Sorry, I encountered an error processing your request.'
    };
  }
}

// Function to generate natural language responses
async function generateNaturalResponse(functionResult, conversationLog) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        ...conversationLog,
        { role: 'function', name: 'function_response', content: functionResult }
      ]
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error generating natural response:', error);
    return functionResult;
  }
}

// Handle message creation
client.on('messageCreate', async (message) => {
  try {
    // Basic checks
    if (message.author.bot) return;
    if (message.content.startsWith(process.env.IGNORE_MESSAGE_PREFIX)) return;
    if (!allowedChannelIDs.includes(message.channelId)) {
      console.log(`Ignoring message from unauthorized channel: ${message.channelId}`);
      return;
    }

    console.log('Processing message:', message.content, 'from:', message.author.username);

    // Send initial feedback
    const feedbackMessage = await message.reply(`${loadingEmoji} Thinking...`);

    // Handle conversation context
    const conversationLog = manageConversation(message.author.id, {
      role: 'user',
      content: message.content
    });

    // Handle Quake server stats command
    if (message.content.startsWith('!serverstats')) {
      await handleQuakeStats(feedbackMessage);
      return;
    }

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

// Function to handle Quake server stats
async function handleQuakeStats(feedbackMessage) {
  try {
    await feedbackMessage.edit(`${loadingEmoji} Checking server stats...`);
    
    // Get server stats
    const serverStatsArray = await lookupQuakeServer();

    // Handle case where no servers are found
    if (!serverStatsArray?.length) {
      await feedbackMessage.edit('> 🚫 No active servers found.');
      return;
    }

    // The serverStatsArray now contains either all server stats that fit within Discord's character limit
    // or a single entry with AI-processed content if the full output would exceed the limit
    const responseMessage = [
      '# 🎯 Quake Live Server Status',
      '',  // Empty line for spacing
      ...serverStatsArray.map(serverStats => serverStats.formatted || '')
    ].filter(line => line !== '').join('\n');

    // Check if we have any content to display
    if (responseMessage.trim() === '# 🎯 Quake Live Server Status') {
      await feedbackMessage.edit('# 🎯 Quake Live Server Status\n\n> ⚠️ Error retrieving server information. Please try again later.');
      return;
    }

    // The AI processing in quakeLookup.js should ensure we're under the Discord character limit
    // but we'll still truncate if needed as a safety measure
    await feedbackMessage.edit(responseMessage.slice(0, 1997) + (responseMessage.length > 1997 ? '...' : ''));
  } catch (error) {
    console.error('Error in handleQuakeStats:', error);
    await feedbackMessage.edit('# 🎯 Quake Live Server Status\n\n> ⚠️ An error occurred while retrieving server information.');
  }
}

// Function to handle function calls
async function handleFunctionCall(gptResponse, feedbackMessage, conversationLog) {
  const loadingMessages = {
    lookupTime: 'Checking watch...',
    lookupWeather: 'Looking outside...',
    lookupExtendedForecast: "Let me ping the cloud, and I don't mean the fluffy ones...",
    getWolframShortAnswer: 'Consulting Wolfram Alpha...',
    quakeLookup: 'Checking server stats...'
  };

  await feedbackMessage.edit(`${loadingEmoji} ${loadingMessages[gptResponse.functionName] || 'Processing...'}`);

  let functionResult;
  switch (gptResponse.functionName) {
    case 'lookupTime':
      functionResult = await lookupTime(gptResponse.parameters.location);
      break;
    case 'lookupWeather':
      functionResult = await lookupWeather(gptResponse.parameters.location);
      break;
    case 'lookupExtendedForecast':
      functionResult = await lookupExtendedForecast(gptResponse.parameters.location);
      break;
    case 'getWolframShortAnswer':
      functionResult = await lookupWolfram.getWolframShortAnswer(gptResponse.parameters.query);
      break;
    case 'quakeLookup':
      await handleQuakeStats(feedbackMessage);
      return;
  }

  const naturalResponse = await generateNaturalResponse(functionResult, conversationLog);
  if (naturalResponse?.trim()) {
    conversationLog.push({
      role: 'assistant',
      content: naturalResponse
    });
  }

  await feedbackMessage.edit(naturalResponse?.slice(0, 1997) + (naturalResponse?.length > 1997 ? '...' : '') || 'No response generated.');
}

// Function to handle direct messages
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

// Error handling for Discord client
client.on('error', error => {
  console.error('Discord client error:', error);
});

// Start the bot
client.login(process.env.DISCORD_TOKEN)
  .catch(error => {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
  });