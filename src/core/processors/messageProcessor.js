const { openai: openaiLogger } = require('../logger');
const performanceMonitor = require('../../middleware/performanceMonitor');
const { trackApiCall, trackError } = require('../healthCheck');
const conversationIntelligence = require('../../conversation/conversationIntelligence');
const contextOptimizer = require('../../conversation/contextOptimizer');

class MessageProcessor {
  constructor(openaiClient, config) {
    this.openai = openaiClient;
    this.config = config;
  }

  async processOpenAIMessage(content, conversationLog, timings = {}) {
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

      // CONVERSATION INTELLIGENCE INTEGRATION
      // Apply intelligent context optimization before OpenAI API call
      let optimizedConversationLog = conversationLog;

      try {
        if (conversationLog.length > 3) {
          // Only optimize if we have enough context
          openaiLogger.debug('Applying conversation intelligence to optimize context', {
            originalLength: conversationLog.length,
            currentMessage: currentContent.substring(0, 100),
          });

          // Get recent bot messages for context
          const recentBotMessages = conversationLog
            .filter(msg => msg.role === 'assistant')
            .slice(-3);

          // Build intelligent weighted context
          const intelligentContext = conversationIntelligence.buildWeightedContext(
            conversationLog,
            {
              maxMessages: 15, // Reasonable limit for context window
              currentTimestamp: Date.now(),
              recentBotMessages,
              userMessage: currentContent,
            }
          );

          // Optimize the context for token efficiency
          const optimizedContext = await contextOptimizer.optimizeContext(intelligentContext, {
            maxTokens: 3000, // Leave room for response and function definitions
            preserveSystemMessage: true,
            summarizeOlderMessages: true,
          });

          optimizedConversationLog = optimizedContext;

          openaiLogger.info('Conversation intelligence applied', {
            originalMessages: conversationLog.length,
            intelligentMessages: intelligentContext.length,
            optimizedMessages: optimizedContext.length,
            tokenSavings:
              this.estimateTokens(conversationLog) - this.estimateTokens(optimizedContext),
          });
        }
      } catch (error) {
        openaiLogger.warn('Conversation intelligence failed, using original context', {
          error: error.message,
        });
        // Fall back to original conversation log if intelligence fails
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

      const response = await this.openai.chat.completions.create({
        model: this.config.OPENAI_MODEL || 'gpt-4.1-nano',
        messages: optimizedConversationLog,
        functions: [
          {
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
          {
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
          {
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
          {
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
          {
            name: 'quakeLookup',
            description:
              'Look up Quake Live video game server statistics, player counts, and match information. Use this for gaming-related queries about Quake Live servers, NOT for location-based time or weather queries.',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
          {
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
        ],
      });

      const responseMessage = response.choices[0].message;

      // Extract token usage information
      const usage = response.usage || {};

      if (responseMessage.function_call) {
        const result = {
          type: 'functionCall',
          functionName: responseMessage.function_call.name,
          parameters: JSON.parse(responseMessage.function_call.arguments),
          usage: {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          },
        };

        performanceMonitor.stopTimer(timerId, {
          responseType: 'functionCall',
          functionName: responseMessage.function_call.name,
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
