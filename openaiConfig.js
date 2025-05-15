/**
 * OpenAI Configuration for ChimpGPT
 * Updated to use the latest models and API format
 */
const OpenAI = require('openai');

// Initialize the OpenAI client with the API key
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const retryWithBreaker = require('./utils/retryWithBreaker');
const { openai: openaiLogger } = require('./logger');

async function processMessage(userMessage, conversationLog) {
    try {
        const completion = await retryWithBreaker(
            () => openai.chat.completions.create({
                model: "o4-mini",
                messages: conversationLog,
                max_tokens: 512, // Limit token usage (optional)
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
                    name: "quakeLookup",
                    description: "get the current quake server stats",
                    parameters: {
                        type: "object",
                        properties: {},
                        required: []
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
                },
                {
                    name: "lookupExtendedForecast",
                    description: "get the weather forecast for the next 5 days in a given location",
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
                },
                {
                    name: "getWolframShortAnswer",
                    description: "Get a short answer to a query using Wolfram Alpha",
                    parameters: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "The query you want to ask Wolfram Alpha, e.g., 'What is the square root of 16?'"
                            }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "getVersion",
                    description: "Get information about the bot's version and system details",
                    parameters: {
                        type: "object",
                        properties: {
                            detailed: {
                                type: "boolean",
                                description: "Whether to include detailed system information"
                            },
                            technical: {
                                type: "boolean",
                                description: "Whether to include technical details like memory usage and uptime"
                            }
                        },
                        required: []
                    }
                }
            ],
            function_call: "auto"
        }),
        {
            maxRetries: 3,
            breakerLimit: 5,
            breakerTimeoutMs: 120000,
            onBreakerOpen: (err) => {
                openaiLogger.error({ error: err }, 'OpenAI circuit breaker triggered: too many failures');
            }
        }
    );

        // Check if GPT recognized a function call
        if (completion.data.choices[0].finish_reason === 'function_call') {
            const functionName = completion.data.choices[0].message.function_call.name;
            const functionArgs = JSON.parse(completion.data.choices[0].message.function_call.arguments);
            return {
                type: "functionCall",
                functionName: functionName,
                parameters: functionArgs
            };
        } else {
            // Get the GPT response
            const gptResponse = completion.data.choices[0].message.content;
            return {
                type: "message",
                content: gptResponse
            };
        }
    } catch (error) {
        openaiLogger.error({ error }, 'Error processing message');
        return {
            type: "error",
            content: "Sorry, there was an error processing your request."
        };
    }
}

async function generateResponse(functionResult, conversationLog) {
    openaiLogger.debug({ functionResult }, "Generating response with function result");
    
    // Add the function result to the conversation log
    conversationLog.push({
        role: 'system',
        content: `The result of the function call is: ${functionResult}`,
    });

    openaiLogger.debug({ conversationLog }, "Conversation log before generating response");

    // Create a completion with OpenAI, including the updated conversation log
    const completion = await retryWithBreaker(
        () => openai.chat.completions.create({
            model: 'o4-mini',
            messages: conversationLog,
            max_tokens: 256,
        }),
        {
            maxRetries: 3,
            breakerLimit: 5,
            breakerTimeoutMs: 120000,
            onBreakerOpen: (err) => {
                openaiLogger.error({ error: err }, 'OpenAI circuit breaker triggered: too many failures');
            }
        }
    );

    // Get the GPT response
    return completion.choices[0].message.content;
}

// openaiConfig.js

module.exports = {
  processMessage,
  generateResponse,
};
