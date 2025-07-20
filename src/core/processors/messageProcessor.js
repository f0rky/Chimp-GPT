const { openai: openaiLogger } = require('../logger');
const performanceMonitor = require('../../middleware/performanceMonitor');
const { trackApiCall, trackError } = require('../healthCheck');
// Legacy conversation intelligence removed - PocketFlow handles all conversation logic

class MessageProcessor {
  constructor(openaiClient, config) {
    this.openai = openaiClient;
    this.config = config;
  }

  async processOpenAIMessage(content, conversationLog, timings = {}) {
    // Debug: Log the conversation log to understand what's being passed
    openaiLogger.debug('processOpenAIMessage called with:', {
      contentParam: content,
      conversationLogLength: conversationLog.length,
      conversationLogPreview: conversationLog.map(msg => ({
        role: msg.role,
        contentPreview: msg.content ? msg.content.substring(0, 50) : 'N/A',
      })),
    });

    // Get the latest user message from the conversation log
    const latestUserMessage = [...conversationLog].reverse().find(msg => msg.role === 'user');
    const currentContent = latestUserMessage ? latestUserMessage.content : content;

    // Debug logging to help track conversation flow issues
    if (currentContent !== content) {
      openaiLogger.debug('Using conversation log content instead of passed content', {
        passedContent: content,
        conversationLogContent: currentContent,
        conversationLength: conversationLog.length,
      });
    }

    const timerId = performanceMonitor.startTimer('openai_api_detail', {
      messageLength: currentContent.length,
      contextLength: JSON.stringify(conversationLog).length,
    });

    try {
      // Check for explicit image generation intent in the current message
      const lowerContent = currentContent.toLowerCase().trim();
      const imagePhrases = [
        /^draw (?:me |us |a |an |the )?/i,
        /^generate (?:me |us |a |an |the )?(?:image|picture|photo)/i,
        /^create (?:me |us |a |an |the )?(?:image|picture|photo)/i,
        /^make (?:me |us |a |an |the )?(?:image|picture|photo)/i,
        /^show (?:me |us )?(?:a |an |the )?(?:image|picture|photo) (?:of|for)/i,
        /^(?:generate|create|make) (?:me |us )?an? image (?:of|for|showing)/i,
        /^i (?:need|want) (?:a|an|the) (?:image|picture|photo) (?:of|for)/i,
      ];

      const isImageRequest = imagePhrases.some(regex => regex.test(lowerContent));

      // If it's clearly an image request, bypass the full context
      if (isImageRequest) {
        openaiLogger.debug('Detected image generation request', { content: currentContent });
        // Clean up the prompt by removing the command phrases
        let cleanPrompt = currentContent;
        for (const phrase of imagePhrases) {
          cleanPrompt = cleanPrompt.replace(phrase, '').trim();
        }
        return {
          type: 'functionCall',
          functionName: 'generateImage',
          parameters: { prompt: cleanPrompt },
        };
      }

      // SIMPLE CONTEXT OPTIMIZATION
      // PocketFlow handles intelligent conversation processing, this is just a fallback
      let optimizedConversationLog = conversationLog;

      // Simple fallback: limit to last 15 messages if too long
      if (conversationLog.length > 15) {
        openaiLogger.debug('Applying simple context truncation for fallback processing', {
          originalLength: conversationLog.length,
          truncatedLength: 15,
        });

        // Keep system message (if present) and last 14 messages
        const systemMessages = conversationLog.filter(msg => msg.role === 'system');
        const nonSystemMessages = conversationLog.filter(msg => msg.role !== 'system').slice(-14);
        optimizedConversationLog = [...systemMessages, ...nonSystemMessages];
      }

      // Log detailed token estimation for debugging
      const tokenEstimate = this.estimateTokens(optimizedConversationLog);

      // Add tokens for function definitions (rough estimate)
      const functionDefsTokens = 6 * 100; // 6 functions, ~100 tokens each
      const totalEstimatedTokens = tokenEstimate + functionDefsTokens;

      openaiLogger.info(
        {
          conversationLogLength: optimizedConversationLog.length,
          messages: optimizedConversationLog.map(msg => ({
            role: msg.role,
            contentLength: msg.content ? msg.content.length : 0,
            contentPreview: msg.content ? msg.content.substring(0, 100) : 'N/A',
            isReference: msg.isReference || false,
            relevanceScore: msg.relevanceScore || undefined,
            isIntelligent: msg.isIntelligent || false,
          })),
          estimatedPromptTokens: totalEstimatedTokens,
          functionDefinitions: 6,
        },
        'Sending request to OpenAI with intelligent context'
      );

      // Safety check: Ensure we never send empty messages array
      if (!optimizedConversationLog || optimizedConversationLog.length === 0) {
        openaiLogger.error('Empty conversation log detected, cannot send to OpenAI', {
          originalConversationLogLength: conversationLog ? conversationLog.length : 0,
          optimizedConversationLogLength: optimizedConversationLog
            ? optimizedConversationLog.length
            : 0,
        });
        throw new Error('Cannot send empty messages array to OpenAI API');
      }

      const response = await this.openai.chat.completions.create({
        model: this.config.OPENAI_MODEL || 'gpt-4.1-nano',
        messages: optimizedConversationLog,
        tool_choice: 'auto',
        tools: [
          {
            type: 'function',
            function: {
              name: 'quakeLookup',
              description:
                'ONLY use when user says "quake stats" - retrieves Quake Live server data',
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'lookupTime',
              description:
                'Look up the current time and timezone information for a specific geographic location or city. Use for time zone queries, NOT for gaming or server statistics.',
              parameters: {
                type: 'object',
                properties: {
                  location: {
                    type: 'string',
                    description: 'The location to look up the time for',
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
              description: 'Look up the current weather for a specific location',
              parameters: {
                type: 'object',
                properties: {
                  location: {
                    type: 'string',
                    description: 'The location to look up the weather for',
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
              description: 'Look up the extended weather forecast for a specific location',
              parameters: {
                type: 'object',
                properties: {
                  location: {
                    type: 'string',
                    description: 'The location to look up the forecast for',
                  },
                },
                required: ['location'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'getWolframShortAnswer',
              description: 'Get a short answer from Wolfram Alpha',
              parameters: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'The query to send to Wolfram Alpha',
                  },
                },
                required: ['query'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'generateImage',
              description: 'Generate an image using GPT Image-1 based on a text prompt',
              parameters: {
                type: 'object',
                properties: {
                  prompt: {
                    type: 'string',
                    description: 'The text prompt describing the image to generate',
                  },
                  model: {
                    type: 'string',
                    enum: ['gpt-image-1'],
                    description: 'The image generation model to use (gpt-image-1 is the default)',
                  },
                  size: {
                    type: 'string',
                    enum: ['1024x1024', '1024x1536', '1536x1024'],
                    description: 'The size of the generated image',
                  },
                  enhance: {
                    type: 'boolean',
                    description: 'Whether to enhance the prompt with AI for better results',
                  },
                },
                required: ['prompt'],
              },
            },
          },
        ],
      });

      const responseMessage = response.choices[0].message;

      // Extract token usage information
      const usage = response.usage || {};

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        const toolCall = responseMessage.tool_calls[0];
        const result = {
          type: 'functionCall',
          functionName: toolCall.function.name,
          parameters: JSON.parse(toolCall.function.arguments),
          usage: {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          },
        };

        performanceMonitor.stopTimer(timerId, {
          responseType: 'functionCall',
          functionName: toolCall.function.name,
          success: true,
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
        });

        return result;
      }

      // Track successful OpenAI API call
      trackApiCall('openai');
      if (timings.apiCalls) {
        timings.apiCalls.openai = (timings.apiCalls.openai || 0) + 1;
      }

      openaiLogger.debug({ response: responseMessage }, 'Received response from OpenAI');
      const result = {
        type: 'message',
        content: responseMessage.content,
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
      };

      performanceMonitor.stopTimer(timerId, {
        responseType: 'message',
        success: true,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
      });

      return result;
    } catch (error) {
      // Track OpenAI API error
      trackError('openai');

      openaiLogger.error({ error }, 'OpenAI API Error');
      return {
        type: 'error',
        content: 'Sorry, I encountered an error processing your request.',
      };
    }
  }

  // Helper method to estimate token usage
  estimateTokens(conversationLog) {
    return conversationLog.reduce((sum, msg) => {
      const contentLength = msg.content ? msg.content.length : 0;
      // Function definitions also consume tokens
      const roleTokens = msg.role === 'system' ? 10 : 5;
      return sum + Math.ceil(contentLength / 4) + roleTokens;
    }, 0);
  }
}

module.exports = MessageProcessor;
