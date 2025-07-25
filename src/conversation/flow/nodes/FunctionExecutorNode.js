const BaseConversationNode = require('./BaseNode');
const { createLogger } = require('../../../core/logger');

const logger = createLogger('FunctionExecutorNode');

class FunctionExecutorNode extends BaseConversationNode {
  constructor(openaiClient, functionCallProcessor, options = {}) {
    const action = async (store, data) => {
      return await this.executeFunction(store, data);
    };

    super('function_executor', action, {
      timeout: 120000, // 2 minutes for image generation
      logLevel: 'debug',
      ...options,
    });

    this.openaiClient = openaiClient;
    this.functionCallProcessor = functionCallProcessor;

    this.config = {
      model: 'gpt-4.1-nano',
      maxRetries: 2,
      ...options.config,
    };

    this.initializeFunctionDefinitions();
  }

  initializeFunctionDefinitions() {
    this.functions = [
      {
        type: 'function',
        function: {
          name: 'lookupTime',
          description: 'Get the current time in a given location',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'The location (should be timezone name like Asia/Shanghai)',
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
          description: 'Get the current weather in a given location',
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
          description: 'Get the extended weather forecast for a given location',
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
                minimum: 1,
                maximum: 5,
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
                description: 'Optional ELO display mode (0=Off, 1=Categorized, 2=Actual value)',
              },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'getWolframShortAnswer',
          description: 'Get a short answer from Wolfram Alpha for a given query',
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
    ];
  }

  async executeFunction(store, data) {
    const { context, message } = data;

    if (!context || !Array.isArray(context)) {
      return {
        success: false,
        error: 'Invalid context provided for function execution',
      };
    }

    try {
      const startTime = Date.now();

      const isImageRequest = this.detectImageRequest(message.content);
      if (isImageRequest) {
        return await this.handleDirectImageRequest(store, message);
      }

      const completion = await this.callOpenAI(context);

      if (completion.choices[0].finish_reason === 'tool_calls') {
        const toolCall = completion.choices[0].message.tool_calls[0];
        const functionResult = await this.executeFunctionCall(toolCall, store, message);

        const naturalResponse = await this.generateNaturalResponse(
          context,
          toolCall,
          functionResult,
          store
        );

        return {
          success: true,
          type: 'function_call',
          functionName: toolCall.function.name,
          functionResult: functionResult,
          response: naturalResponse,
          executionTime: Date.now() - startTime,
        };
      }
      return {
        success: true,
        type: 'direct_response',
        response: completion.choices[0].message.content,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('Error executing function:', error);
      return {
        success: false,
        error: error.message,
        type: 'error',
      };
    }
  }

  async callOpenAI(context, includeTools = true) {
    const requestData = {
      model: this.config.model,
      messages: context,
      temperature: 0.7,
      max_tokens: 150,
    };

    if (includeTools) {
      requestData.tools = this.functions;
      requestData.tool_choice = 'auto';
    }

    return await this.openaiClient.chat.completions.create(requestData);
  }

  async executeFunctionCall(toolCall, store, message) {
    try {
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);

      logger.debug(`Executing function: ${functionName}`, functionArgs);

      const result = await this.functionCallProcessor.processFunction({
        functionName,
        functionArgs,
        message,
        store,
      });

      store.set('lastFunctionCall', {
        name: functionName,
        arguments: functionArgs,
        result: result,
        timestamp: Date.now(),
        messageId: message.id,
      });

      return result;
    } catch (error) {
      logger.error('Error executing function call:', error);
      return {
        success: false,
        error: error.message,
        functionName: toolCall.function.name,
      };
    }
  }

  async generateNaturalResponse(context, toolCall, functionResult, store) {
    try {
      // Get bot personality from SharedStore if available
      const botPersonality =
        store?.get('botPersonality') ||
        'You are a helpful AI assistant. Respond naturally and helpfully to user messages.';

      const responseContext = [
        {
          role: 'system',
          content: botPersonality,
        },
        ...context,
        {
          role: 'assistant',
          content: null,
          tool_calls: [toolCall],
        },
        {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(functionResult),
        },
      ];

      const naturalCompletion = await this.callOpenAI(responseContext, false);
      return naturalCompletion.choices[0].message.content;
    } catch (error) {
      logger.error('Error generating natural response:', error);
      return `I executed the ${toolCall.function.name} function, but encountered an error generating a natural response: ${error.message}`;
    }
  }

  detectImageRequest(content) {
    const lowerContent = content.toLowerCase().trim();
    const imagePhrases = [
      /^draw (?:me |us |a |an |the )?/i,
      /^generate (?:me |us |a |an |the )?(?:image|picture|photo)/i,
      /^create (?:me |us |a |an |the )?(?:image|picture|photo)/i,
      /^make (?:me |us |a |an |the )?(?:image|picture|photo)/i,
      /^show (?:me |us )?(?:a |an |the )?(?:image|picture|photo) (?:of|for)/i,
      /^(?:generate|create|make) (?:me |us )?an? image (?:of|for|showing)/i,
      /^i (?:need|want) (?:a|an|the) (?:image|picture|photo) (?:of|for)/i,
    ];

    return imagePhrases.some(regex => regex.test(lowerContent));
  }

  async handleDirectImageRequest(store, message) {
    try {
      const content = message.content;
      const imagePhrases = [
        /^draw (?:me |us |a |an |the )?/i,
        /^generate (?:me |us |a |an |the )?(?:image|picture|photo)/i,
        /^create (?:me |us |a |an |the )?(?:image|picture|photo)/i,
        /^make (?:me |us |a |an |the )?(?:image|picture|photo)/i,
        /^show (?:me |us )?(?:a |an |the )?(?:image|picture|photo) (?:of|for)/i,
        /^(?:generate|create|make) (?:me |us )?an? image (?:of|for|showing)/i,
        /^i (?:need|want) (?:a|an|the) (?:image|picture|photo) (?:of|for)/i,
      ];

      let cleanPrompt = content;
      for (const phrase of imagePhrases) {
        cleanPrompt = cleanPrompt.replace(phrase, '').trim();
      }

      const functionResult = await this.functionCallProcessor.processFunction({
        functionName: 'generateImage',
        functionArgs: { prompt: cleanPrompt },
        message,
        store,
      });

      return {
        success: true,
        type: 'direct_image_generation',
        functionName: 'generateImage',
        functionResult: functionResult,
        response: functionResult.success
          ? `I've generated an image for you: ${functionResult.imageUrl}`
          : `I couldn't generate the image: ${functionResult.error}`,
      };
    } catch (error) {
      logger.error('Error handling direct image request:', error);
      return {
        success: false,
        error: error.message,
        type: 'direct_image_generation',
      };
    }
  }
}

module.exports = FunctionExecutorNode;
