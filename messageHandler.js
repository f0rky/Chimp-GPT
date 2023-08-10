
require('dotenv').config();
const client = require('./discordClient');
const { processMessage, generateResponse } = require('./openaiConfig');
const lookupWeather = require('./weatherLookup');
const lookupTime = require('./timeLookup');
const userConversations = {};
const MAX_CONVERSATION_LENGTH = 8;

client.on('messageCreate', async (message) => {
    // Your existing logic for handling messages

    if (message.author.bot) return;
    if (message.content.startsWith(process.env.IGNORE_MESSAGE_PREFIX)) return;
    const userId = message.author.id;

    // Ensure the user's conversation log is initialized
    if (!userConversations[userId]) {
        userConversations[userId] = [
            { role: 'system', content: process.env.BOT_PERSONALITY }
        ];
    }
    const conversationLog = userConversations[userId];

    console.log('Received message:', message.content);
    // Send initial feedback to user
    let feedbackMessage = await message.reply("<a:loading:1139032461712556062> Thinking...");

    if (message.content && message.content.trim() !== '') {
        conversationLog.push({
            role: 'user',
            content: message.content
        });
    }

    


    // Ensure conversation doesn't exceed max length
    while (conversationLog.length > MAX_CONVERSATION_LENGTH) {
        conversationLog.shift();
    }

    console.log("Current conversationLog:", JSON.stringify(conversationLog, null, 2));
    // Process the message with GPT
    let gptResponse = await processMessage(message.content, conversationLog);
    console.log("GPT response type:", gptResponse.type);
    
    if (gptResponse.type === "functionCall") {
      console.log("Inside functionCall condition");
    if (gptResponse.functionName === "lookupTime") {
        feedbackMessage.edit("<a:loading:1139032461712556062> Checking watch...");
    } else if (gptResponse.functionName === "lookupWeather") {
        feedbackMessage.edit("<a:loading:1139032461712556062> Looking outside...");
    }

        if (gptResponse.functionName === "lookupTime") {
            console.log("Function Name:", gptResponse.functionName);
            const time = await lookupTime(gptResponse.parameters.location);
            // Generate a natural response with GPT if needed
            const naturalResponse = await generateResponse(time, conversationLog);
            if (naturalResponse && naturalResponse.trim() !== '') {
                conversationLog.push({
                    role: 'assistant',
                    content: naturalResponse
                });
            }
            feedbackMessage.edit(naturalResponse);
        } else if (gptResponse.functionName === "lookupWeather") {
            const weather = await lookupWeather(gptResponse.parameters.location);
            const naturalResponse = await generateResponse(weather, conversationLog);
            if (naturalResponse && naturalResponse.trim() !== '') {
                conversationLog.push({
                    role: 'assistant',
                    content: naturalResponse
                });
            }
            feedbackMessage.edit(naturalResponse);
        }

        // Handle other function calls similarly
    } else if (gptResponse.type === "message") {
        // Check if the message is empty or whitespace only
        if (!gptResponse.content || gptResponse.content.trim() === '') {
            feedbackMessage.edit("Sorry, I couldn't understand your request. Please try again.");
        } else {
            if (gptResponse.content && gptResponse.content.trim() !== '') {
                conversationLog.push({
                    role: 'assistant',
                    content: gptResponse.content
                });
            }
            feedbackMessage.edit(gptResponse.content);
        }
    } else if (gptResponse.type === "error") {
        feedbackMessage.edit(gptResponse.content);
    }
});

client.login(process.env.TOKEN);
