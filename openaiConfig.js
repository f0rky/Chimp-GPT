/**
 * OpenAI Configuration for ChimpGPT
 * Updated to use the latest models and API format with secure API key management
 */
const OpenAI = require('openai');
const apiKeyManager = require('./utils/apiKeyManager');
const { openai: openaiLogger } = require('./logger');

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

const retryWithBreaker = require('./utils/retryWithBreaker');
const { sanitizeUserMessage } = require('./utils/inputSanitizer');

async function processMessage(userMessage, conversationLog) {
  try {
    // Sanitize the user message and conversation log before processing
    const sanitizedMessage = sanitizeUserMessage(userMessage);

    // Create a sanitized copy of the conversation log
    const sanitizedLog = conversationLog.map(entry => ({
      role: entry.role,
      content: entry.role === 'user' ? sanitizeUserMessage(entry.content) : entry.content,
    }));

    // Log if the message was modified during sanitization
    if (sanitizedMessage !== userMessage) {
      openaiLogger.warn('User message was sanitized before processing');
    }
    const completion = await retryWithBreaker(
      async () => {
        try {
          return await openaiWithLogging.chat.completions.create({
            model: 'gpt-4.1-nano', // Using faster model for better responsiveness
            messages: sanitizedLog,
            max_completion_tokens: 512, // Limit token usage (optional)
            functions: [
              {
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
              {
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
              {
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
              {
                name: 'lookupQuakeServer',
                description: 'get information about Quake Live servers',
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
              {
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
              {
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
            ],
            function_call: 'auto',
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

    // Check if GPT recognized a function call
    if (completion.data.choices[0].finish_reason === 'function_call') {
      const functionName = completion.data.choices[0].message.function_call.name;
      const functionArgs = JSON.parse(completion.data.choices[0].message.function_call.arguments);
      return {
        type: 'functionCall',
        functionName: functionName,
        parameters: functionArgs,
      };
    }
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
  processMessage,
  generateResponse,
  getOpenAIModel,
};
