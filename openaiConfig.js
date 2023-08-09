const { Configuration, OpenAIApi } = require('openai');

const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

const FUNCTION_CALLS = {
  'lookupTime': {
    patterns: [
      /what's the time in (.+?)\?/i,
      /what is the time in (.+?)\?/i,
      /can you tell me the time in (.+?)\?/i,
      /could you tell me the time in (.+?)\?/i,
      /tell me the time in (.+?)/i,
      /time in (.+?)\?/i,
      /current time in (.+?)\?/i,
      /show me the time in (.+?)/i,
      /what time is it in (.+?)\?/i
    ]
  },
  // Add more function calls as needed
};

async function processMessage(userMessage, conversationLog) {
  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo-0613",
      messages: conversationLog,
      functions: [
        {
          name: "lookupTime",
          description: "get the current time in a given location",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "The location, e.g., Beijing, China. But it should be written in a timezone name like Asia/Shanghai"
              }
            },
            required: ["location"]
          }
        },
        {
          name: "lookupWeather",
          description: "get the weather forecast in a given location",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "The location, e.g., Beijing, China. But it should be written in a city, state, country"
              }
            },
            required: ["location"]
          }
        }
      ],
      function_call: "auto"
    });
    console.log('GPT completion:', completion);

    // Get the GPT response
    const gptResponse = completion.data.choices[0].message.content;

    // Process the response as needed
    // ...

    return {
      text: gptResponse,
    };
  } catch (error) {
    console.error('Error processing message:', error.response?.data || error.message);
    throw error;
  }
}

async function generateResponse(functionResult, conversationLog) {
  // Add the function result to the conversation log
  conversationLog.push({
    role: 'system',
    content: `The result of the function call is: ${functionResult}`,
  });

  // Create a completion with OpenAI, including the updated conversation log
  const completion = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo-0613',
    messages: conversationLog,
    max_tokens: 256,
  });

  // Get the GPT response
  return completion.data.choices[0].message.content;
}

// openaiConfig.js

module.exports = {
  processMessage,
  generateResponse,
};
