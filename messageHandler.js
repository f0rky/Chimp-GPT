
require('dotenv').config();
const client = require('./discordClient');
const { processMessage, generateResponse } = require('./openaiConfig');
const { lookupWeather, lookupExtendedForecast } = require('./weatherLookup');
const lookupTime = require('./timeLookup');
const lookupQuakeServer = require('./quakeLookup');

const userConversations = {};
const MAX_CONVERSATION_LENGTH = 8;

// Read the CHANNEL_ID from .env; it can be a single ID or a comma-separated list
const allowedChannelIDs = (process.env.CHANNEL_ID || "").split(',');

client.on('messageCreate', async (message) => {
    // Your existing logic for handling messages
    console.log('Processing message:', message.content, 'from:', message.author.username, 'Replying to:', message.reference ? message.reference.messageID : 'None');

    if (message.author.bot) return;
    if (message.content.startsWith(process.env.IGNORE_MESSAGE_PREFIX)) return;

    if (!allowedChannelIDs.includes(message.channel.id)) {
      console.log(`Ignoring message from unauthorized channel: ${message.channel.id}`);
      return;
    }

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
        console.log("Function Name:", gptResponse.functionName);

        if (gptResponse.functionName === "lookupTime") {
            feedbackMessage.edit("<a:loading:1139032461712556062> Checking watch...");
            const time = await lookupTime(gptResponse.parameters.location);
            const naturalResponse = await generateResponse(time, conversationLog);
            if (naturalResponse && naturalResponse.trim() !== '') {
                conversationLog.push({
                    role: 'assistant',
                    content: naturalResponse
                });
            }
            feedbackMessage.edit(naturalResponse);

        } else if (gptResponse.functionName === "lookupWeather") {
            feedbackMessage.edit("<a:loading:1139032461712556062> Looking outside...");
            const weather = await lookupWeather(gptResponse.parameters.location);
            const naturalResponse = await generateResponse(weather, conversationLog);
            if (naturalResponse && naturalResponse.trim() !== '') {
                conversationLog.push({
                    role: 'assistant',
                    content: naturalResponse
                });
            }
            feedbackMessage.edit(naturalResponse);

        } else if (gptResponse.functionName === "lookupExtendedForecast") {
            feedbackMessage.edit("<a:loading:1139032461712556062> Let me ping the cloud, and I don't mean the fluffy ones...");
            const weather = await lookupExtendedForecast(gptResponse.parameters.location);
            const naturalResponse = await generateResponse(weather, conversationLog);
            if (naturalResponse && naturalResponse.trim() !== '') {
                conversationLog.push({
                    role: 'assistant',
                    content: naturalResponse
                });
            }
            feedbackMessage.edit(naturalResponse);

        } else if (gptResponse.functionName === "quakeLookup" || message.content.startsWith("!serverstats")) {
            feedbackMessage.edit("<a:loading:1139032461712556062> Checking server stats...");

            const serverStatsArray = await lookupQuakeServer();
            if (!serverStatsArray || serverStatsArray.length === 0) {
                feedbackMessage.edit("No active servers found.");
                return; // Exit early
           }

           let responseMessage = "";

           for (let i = 0; i < serverStatsArray.length; i++) {
                const serverStats = serverStatsArray[i];

                if (serverStats.error) {
                    responseMessage += serverStats.error + "\n\n";
                } else if (serverStats.message) {
                    responseMessage += serverStats.message + "\n\n";
                } else {
                    const serverStatsString = `
                        Server Name: ${serverStats.serverName}
                        Current Map: ${serverStats.currentMap}
                        Player Count: ${serverStats.playerCount}
                        Top Player: ${serverStats.currentTopPlayer}
                        Uptime: ${serverStats.uptime}
                    `;
                    responseMessage += `Server ${i + 1}:\n` + serverStatsString + "\n\n";
                }
            }

            // Truncate the message if it's too long (Discord has a 2000 character limit)
            if (responseMessage.length > 2000) {
                responseMessage = responseMessage.substring(0, 1997) + "...";
            }
            feedbackMessage.edit(responseMessage);
        }

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

            // Truncate the message if it's too long (Discord has a 2000 character limit)
            let finalResponse = gptResponse.content;
            if (finalResponse.length > 2000) {
                finalResponse = finalResponse.substring(0, 1997) + "...";
            }
            feedbackMessage.edit(finalResponse);
        }
    } else if (gptResponse.type === "error") {
        feedbackMessage.edit(gptResponse.content);
    }
});

client.login(process.env.TOKEN);
