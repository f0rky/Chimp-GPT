require('dotenv').config();
const client = require('./discordClient');
const { processMessage, generateResponse } = require('./openaiConfig');
const lookupWeather = require('./weatherLookup');
const lookupTime = require('./timeLookup');

client.on('messageCreate', async (message) => {
    // Your existing logic for handling messages

    if (message.author.bot) return;
    if (message.content.startsWith(process.env.IGNORE_MESSAGE_PREFIX)) return;

    console.log('Received message:', message.content);

    if (message.content.startsWith('!weather')) {
        const location = message.content.split(' ')[1];
        const weather = await lookupWeather(location);
        return message.reply(weather);
    }
    if (message.content.startsWith('!time')) {
        const location = message.content.split(' ')[1];
        const time = await lookupTime(location);
        return message.reply(time);
    }

    // Maintain conversation log
    // Start the conversation log with the bot's personality
    let conversationLog = [
        { role: 'system', content: process.env.BOT_PERSONALITY }
    ];

    // Add the user's message
    conversationLog.push({ role: 'user', content: message.content });

    // Process the message with GPT
    let gptResponse = await processMessage(message.content, conversationLog);
      console.log("GPT response type:", gptResponse.type);

    if (gptResponse.type === "functionCall") {
      console.log("Inside functionCall condition");
        if (gptResponse.functionName === "lookupTime") {
            console.log("Function Name:", gptResponse.functionName);
            const time = await lookupTime(gptResponse.parameters.location);
            // Generate a natural response with GPT if needed
            const naturalResponse = await generateResponse(time, conversationLog);
            message.reply(naturalResponse);
        }
        // Handle other function calls similarly
    } else if (gptResponse.type === "message") {
        // Check if the message is empty or whitespace only
        if (!gptResponse.content || gptResponse.content.trim() === '') {
            message.reply("Sorry, I couldn't understand your request. Please try again.");
        } else {
            message.reply(gptResponse.content);
        }
    } else if (gptResponse.type === "error") {
        message.reply(gptResponse.content);
    }
});

client.login(process.env.TOKEN);
