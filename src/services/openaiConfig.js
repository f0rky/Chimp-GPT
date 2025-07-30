/**
 * OpenAI Configuration for ChimpGPT
 * Updated to use the latest models and API format with secure API key management
 */
const OpenAI = require('openai');
const apiKeyManager = require('../utils/apiKeyManager');
const { openai: openaiLogger } = require('../core/logger');

// Get the API key with fallback to environment variable if needed
let apiKey;
try {
  apiKey = apiKeyManager.getApiKey('OPENAI_API_KEY');
  openaiLogger.info('Using API key from secure manager');
} catch (error) {
  openaiLogger.warn(
    { error: error.message },
    'Failed to get API key from manager, falling back to environment variable'
  );
  apiKey = process.env.OPENAI_API_KEY;
}

// Initialize the OpenAI client with the API key
const openai = new OpenAI({
  apiKey: apiKey,
});

// Wrapper function to log OpenAI API calls
async function logOpenAICall(method, params) {
  const callId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const startTime = Date.now();

  try {
    openaiLogger.debug(
      {
        callId,
        method,
        params: {
          ...params,
          // Don't log the full messages array as it can be very large
          messages: params.messages ? `[${params.messages.length} messages]` : undefined,
        },
        timestamp: new Date().toISOString(),
        status: 'started',
      },
      'OpenAI API call started'
    );

    const response = await method.call(openai.chat.completions, params);
    const duration = Date.now() - startTime;

    openaiLogger.info(
      {
        callId,
        method: 'chat.completions.create',
        durationMs: duration,
        model: params.model,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        timestamp: new Date().toISOString(),
        status: 'completed',
      },
      'OpenAI API call completed'
    );

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    openaiLogger.error(
      {
        callId,
        method: 'chat.completions.create',
        durationMs: duration,
        error: error.message,
        status: 'failed',
        timestamp: new Date().toISOString(),
      },
      'OpenAI API call failed'
    );
    throw error;
  }
}

// Create a proxy to intercept API calls
const openaiWithLogging = new Proxy(openai, {
  get(target, prop) {
    if (prop === 'chat') {
      return new Proxy(target.chat, {
        get(chatTarget, chatProp) {
          if (chatProp === 'completions') {
            return new Proxy(chatTarget.completions, {
              get(completionsTarget, completionsProp) {
                if (completionsProp === 'create') {
                  return params => logOpenAICall(openai.chat.completions.create, params);
                }
                return completionsTarget[completionsProp];
              },
            });
          }
          return chatTarget[chatProp];
        },
      });
    }
    return target[prop];
  },
});

const retryWithBreaker = require('../utils/retryWithBreaker');
const { sanitizeUserMessage } = require('../utils/inputSanitizer');

/**
 * Filter conversation log to improve function calling reliability
 * Removes patterns that interfere with OpenAI's function calling behavior
 * @param {Array} conversationLog - The conversation log to filter
 * @returns {Array} - Filtered conversation log
 */
function filterConversationForFunctionCalling(conversationLog) {
  const filtered = [];

  for (let i = 0; i < conversationLog.length; i++) {
    const message = conversationLog[i];

    // Always keep system messages
    if (message.role === 'system') {
      filtered.push(message);
      continue;
    }

    // For user messages requesting images, check if the following assistant response was negative
    if (message.role === 'user' && isImageRequest(message.content)) {
      const nextMessage = conversationLog[i + 1];

      // If the next message is an assistant response that refused/couldn't generate image, skip both
      if (nextMessage && nextMessage.role === 'assistant' && isImageRefusal(nextMessage.content)) {
        openaiLogger.debug(
          'Filtered out failed image request sequence to improve function calling',
          {
            userRequest: message.content.substring(0, 50) + '...',
            assistantRefusal: nextMessage.content.substring(0, 50) + '...',
          }
        );
        i++; // Skip the next message too
        continue;
      }
    }

    // Keep all other messages
    filtered.push(message);
  }

  openaiLogger.debug('Conversation filtering completed', {
    originalLength: conversationLog.length,
    filteredLength: filtered.length,
    messagesRemoved: conversationLog.length - filtered.length,
  });

  return filtered;
}

/**
 * Check if a message is an image generation request
 * @param {string} content - Message content to check
 * @returns {boolean} - True if this looks like an image request
 */
function isImageRequest(content) {
  const imageKeywords = [
    'draw',
    'create',
    'generate',
    'make',
    'show',
    'picture',
    'image',
    'art',
    'paint',
    'sketch',
    'illustrate',
    'design',
    'render',
  ];

  const lowerContent = content.toLowerCase();
  return imageKeywords.some(
    keyword =>
      lowerContent.includes(keyword + ' me') ||
      lowerContent.includes(keyword + ' an') ||
      lowerContent.includes(keyword + ' a ') ||
      lowerContent.includes('an image') ||
      lowerContent.includes('a picture')
  );
}

/**
 * Check if a message is an assistant refusal to generate images
 * @param {string} content - Message content to check
 * @returns {boolean} - True if this looks like an image generation refusal
 */
function isImageRefusal(content) {
  const refusalPatterns = [
    "can't generate",
    "can't create",
    "can't draw",
    "can't make",
    'unable to generate',
    'unable to create',
    'unable to draw',
    'cannot generate',
    'cannot create',
    'cannot draw',
    "i can't",
    'sorry',
    "i'm here to",
    'not able to',
    "can't exactly",
    "can't directly",
    "don't generate",
  ];

  const lowerContent = content.toLowerCase();
  return refusalPatterns.some(pattern => lowerContent.includes(pattern));
}

async function processMessage(userMessage, conversationLog) {
  try {
    // Sanitize the user message and conversation log before processing
    const sanitizedMessage = sanitizeUserMessage(userMessage);

    // Create a sanitized copy of the conversation log
    const sanitizedLog = conversationLog.map(entry => ({
      role: entry.role,
      content: entry.role === 'user' ? sanitizeUserMessage(entry.content) : entry.content,
    }));

    // Filter conversation to improve function calling reliability
    const filteredLog = filterConversationForFunctionCalling(sanitizedLog);

    // Log if the message was modified during sanitization
    if (sanitizedMessage !== userMessage) {
      openaiLogger.warn('User message was sanitized before processing');
    }
    const completion = await retryWithBreaker(
      async () => {
        try {
          // Debug logging to confirm new tool calling format is being used
          openaiLogger.debug(
            'Using new tool calling format with tools array and tool_choice parameter'
          );
          return await openaiWithLogging.chat.completions.create({
            model: 'gpt-4.1-nano', // Using faster model for better responsiveness
            messages: filteredLog,
            max_completion_tokens: 512, // Limit token usage (optional)
            tools: [
              {
                type: 'function',
                function: {
                  name: 'lookupTime',
                  description: 'get the current time in a given location',
                  parameters: {
                    type: 'object',
                    properties: {
                      location: {
                        type: 'string',
                        description:
                          'The location, e.g., Beijing, China. But it should be written in a timezone name like Asia/Shanghai',
                      },
                    },
                    required: ['location'],
                  },
                },
              },
              {
                type: 'function',
                function: {
                  name: 'lookupWeather',
                  description: 'get the current weather in a given location',
                  parameters: {
                    type: 'object',
                    properties: {
                      location: {
                        type: 'string',
                        description: 'The location, e.g., New York, NY',
                      },
                    },
                    required: ['location'],
                  },
                },
              },
              {
                type: 'function',
                function: {
                  name: 'lookupExtendedForecast',
                  description: 'get the extended weather forecast for a given location',
                  parameters: {
                    type: 'object',
                    properties: {
                      location: {
                        type: 'string',
                        description: 'The location, e.g., New York, NY',
                      },
                      days: {
                        type: 'integer',
                        description: 'Number of days to forecast (1-5)',
                      },
                    },
                    required: ['location'],
                  },
                },
              },
              {
                type: 'function',
                function: {
                  name: 'quakeLookup',
                  description:
                    'Get current Quake Live server statistics and player information for active servers. Only use when specifically asked about Quake servers, server stats, or gaming server information.',
                  parameters: {
                    type: 'object',
                    properties: {
                      serverFilter: {
                        type: 'string',
                        description: 'Optional server name or IP to filter by',
                      },
                      eloMode: {
                        type: 'integer',
                        description:
                          'Optional ELO display mode (0=Off, 1=Categorized, 2=Actual value)',
                      },
                    },
                  },
                },
              },
              {
                type: 'function',
                function: {
                  name: 'getWolframShortAnswer',
                  description: 'get a short answer from Wolfram Alpha for a given query',
                  parameters: {
                    type: 'object',
                    properties: {
                      query: {
                        type: 'string',
                        description: 'The question or query to send to Wolfram Alpha',
                      },
                    },
                    required: ['query'],
                  },
                },
              },
              {
                type: 'function',
                function: {
                  name: 'getVersion',
                  description: "Get information about the bot's version and system details",
                  parameters: {
                    type: 'object',
                    properties: {
                      detailed: {
                        type: 'boolean',
                        description: 'Whether to include detailed system information',
                      },
                      technical: {
                        type: 'boolean',
                        description:
                          'Whether to include technical details like memory usage and uptime',
                      },
                    },
                    required: [],
                  },
                },
              },
              {
                type: 'function',
                function: {
                  name: 'generateImage',
                  description: 'Generate an image using AI based on a text description',
                  parameters: {
                    type: 'object',
                    properties: {
                      prompt: {
                        type: 'string',
                        description: 'The text description of the image to generate',
                      },
                      size: {
                        type: 'string',
                        description:
                          'Image size: 1024x1024 (square), 1536x1024 (portrait), or 1024x1536 (landscape)',
                        enum: ['1024x1024', '1536x1024', '1024x1536'],
                      },
                      quality: {
                        type: 'string',
                        description: 'Image quality level',
                        enum: ['low', 'medium', 'high'],
                      },
                    },
                    required: ['prompt'],
                  },
                },
              },
            ],
            tool_choice: 'auto',
          });
        } catch (error) {
          // Record API key error for monitoring
          apiKeyManager.recordApiKeyError('OPENAI_API_KEY', error);
          throw error; // Re-throw for the retry handler
        }
      },
      {
        maxRetries: 3,
        breakerLimit: 5,
        breakerTimeoutMs: 120000,
        onBreakerOpen: err => {
          openaiLogger.error({ error: err }, 'OpenAI circuit breaker triggered: too many failures');
        },
      }
    );
    openaiLogger.debug('Received response from OpenAI');

    // Check if GPT recognized a tool call
    if (
      completion.data.choices[0].finish_reason === 'tool_calls' &&
      completion.data.choices[0].message.tool_calls
    ) {
      const toolCall = completion.data.choices[0].message.tool_calls[0];
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);

      // Debug logging for successful tool call detection
      openaiLogger.debug('Tool call detected successfully', {
        functionName,
        finishReason: completion.data.choices[0].finish_reason,
        toolCallsCount: completion.data.choices[0].message.tool_calls.length,
      });

      return {
        type: 'functionCall',
        functionName: functionName,
        parameters: functionArgs,
      };
    }

    // Debug logging when no tool call is detected
    openaiLogger.debug('No tool call detected', {
      finishReason: completion.data.choices[0].finish_reason,
      hasToolCalls: !!completion.data.choices[0].message.tool_calls,
      messageContent: completion.data.choices[0].message.content?.substring(0, 100) + '...',
    });
    // Get the GPT response
    const gptResponse = completion.data.choices[0].message.content;
    return {
      type: 'message',
      content: gptResponse,
    };
  } catch (error) {
    openaiLogger.error({ error }, 'Error processing message');
    return {
      type: 'error',
      content: 'Sorry, there was an error processing your request.',
    };
  }
}

async function generateResponse(functionResult, conversationLog) {
  openaiLogger.debug({ functionResult }, 'Generating response with function result');

  // Add the function result to the conversation log
  conversationLog.push({
    role: 'system',
    content: `The result of the function call is: ${functionResult}`,
  });

  openaiLogger.debug({ conversationLog }, 'Conversation log before generating response');

  // Create a completion with OpenAI, including the updated conversation log
  const completion = await retryWithBreaker(
    async () => {
      try {
        return await openaiWithLogging.chat.completions.create({
          model: 'gpt-4.1-nano', // Using faster model for better responsiveness
          messages: conversationLog,
          max_completion_tokens: 256,
        });
      } catch (error) {
        // Record API key error for monitoring
        apiKeyManager.recordApiKeyError('OPENAI_API_KEY', error);
        throw error; // Re-throw for the retry handler
      }
    },
    {
      maxRetries: 3,
      breakerLimit: 5,
      breakerTimeoutMs: 120000,
      onBreakerOpen: err => {
        openaiLogger.error({ error: err }, 'OpenAI circuit breaker triggered: too many failures');
      },
    }
  );
  openaiLogger.debug('Received response from OpenAI');

  // Get the GPT response
  return completion.choices[0].message.content;
}

/**
 * Get the current OpenAI model being used
 *
 * @returns {string} The model name
 */
function getOpenAIModel() {
  return 'gpt-4.1-nano'; // Using faster model for better responsiveness
}

// openaiConfig.js

module.exports = {
  client: openaiWithLogging, // Export the OpenAI client for PocketFlow
  processMessage,
  generateResponse,
  getOpenAIModel,
};
