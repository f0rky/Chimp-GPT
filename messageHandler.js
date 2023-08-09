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

  // Process the message with GPT, possibly recognizing function calls
  let gptResponse = await processMessage(message.content, conversationLog);

  // Check if the response is empty and provide a fallback message
  if (!gptResponse.text || gptResponse.text.trim() === '') {
    console.warn('GPT response is empty. Sending a fallback message.');
    gptResponse.text = 'Sorry, I couldn\'t understand your request. Please try again.';
  }

  // Check if GPT recognized a function call (e.g., lookupTime)
  if (gptResponse.functionCall === 'lookupTime') {
    // Execute the function
    const time = await lookupTime(gptResponse.parameters.location);

    // Generate a natural response with GPT
    const naturalResponse = await generateResponse(time, conversationLog);

    // Send the response
    message.reply(naturalResponse);
  } else {
    // Handle other cases
    message.reply(gptResponse.text);
  }

  // Update conversation log
  conversationLog.push({
    role: 'user',
    content: message.content,
  });
  conversationLog.push({
    role: 'assistant',
    content: gptResponse.text,
  });
}); // Closing brace for the event handler

client.login(process.env.TOKEN);
