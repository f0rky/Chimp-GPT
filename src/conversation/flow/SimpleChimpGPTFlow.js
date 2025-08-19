/**
 * SimpleChimpGPTFlow - True PocketFlow Implementation
 *
 * Follows the "Keep it Simple, Stupid" philosophy of PocketFlow.
 * Single node that handles conversation with bot personality and memory.
 */

const { Node, SharedStore, Flow } = require('./PocketFlow');
const config = require('../../core/configValidator');
const { createLogger } = require('../../core/logger');
const KnowledgeFlow = require('./KnowledgeFlow');

const logger = createLogger('SimpleChimpGPTFlow');

class SimpleChimpGPTFlow {
  constructor(openaiClient, pfpManager, options = {}) {
    this.openaiClient = openaiClient;
    this.pfpManager = pfpManager;
    this.options = {
      maxConversationLength: 10,
      maxTokens: 2000,
      ...options,
    };

    // Initialize knowledge system if enabled
    if (config.ENABLE_KNOWLEDGE_SYSTEM) {
      this.knowledgeFlow = new KnowledgeFlow(openaiClient, {
        maxSearchResults: config.KNOWLEDGE_MAX_SEARCH_RESULTS,
        confidenceThreshold: config.KNOWLEDGE_CONFIDENCE_THRESHOLD,
        maxResponseTokens: this.options.maxTokens,
      });
      logger.info('Knowledge system initialized with multi-agent PocketFlow');
    }

    this.initializeFlow();
  }

  initializeFlow() {
    // Create shared store with bot personality and features
    this.store = new SharedStore();
    this.store.set('conversations', new Map());
    this.store.set(
      'botPersonality',
      config.BOT_PERSONALITY || 'You are ChimpGPT, a helpful AI assistant.'
    );

    // Create single unified processing node
    const unifiedNode = new Node('unified_processor', async (store, data) => {
      return await this.handleUnifiedProcessing(store, data);
    });

    // Create flow with single node for reliability
    this.flow = new Flow(unifiedNode, this.store);
  }

  async handleUnifiedProcessing(store, data) {
    try {
      const { message } = data;
      const content = message.content.toLowerCase();

      logger.debug(`Processing unified request for user ${message.author?.id}`);

      // Detect intent and process accordingly

      // Check for knowledge system patterns first (if enabled)
      if (config.ENABLE_KNOWLEDGE_SYSTEM && this.knowledgeFlow) {
        // Skip knowledge system for natural conversation requests
        if (
          content.includes('natural') &&
          (content.includes('response') || content.includes('conversation'))
        ) {
          logger.info('Bypassing knowledge system for natural conversation request');
          return await this.handleConversation(store, data);
        }

        const knowledgePatterns = [
          // Explicit search/lookup requests
          /(?:search|lookup|look\s+up|find)\s+(?:for\s+)?(?:the\s+)?(?:top|best|latest|current|information|docs|documentation)/i,
          /(?:search|lookup|look\s+up|find)\s+(?:for\s+)?(?:information\s+)?about/i,
          /(?:search|lookup|look\s+up|find)/i, // More general search pattern
          /can\s+you\s+(?:search|lookup|look\s+up|find)/i,
          /(?:what\s+(?:are|is)|tell\s+me\s+about|information\s+about)\s+(?:the\s+)?(?:top|best|latest)/i,

          // "Give me" requests - expanded patterns
          /(?:give\s+me|show\s+me)\s+(?:the\s+)?(?:top|best|latest|current|information)/i,
          /(?:give\s+me|show\s+me)\s+(?:some\s+)?(?:information|details|facts)/i,
          /can\s+you\s+(?:give\s+me|show\s+me)\s+(?:the\s+)?(?:latest|current|top|best)/i,

          // Question patterns that benefit from web search - more inclusive
          /what\s+(?:are|is)\s+the\s+(?:top|best|latest|current)/i,
          /what\s+(?:are|is)/i, // More general "what is" pattern
          /(?:what's|whats)\s+the\s+(?:latest|current|top|best)/i,
          /(?:what's|whats)/i, // More general "what's" pattern
          /is\s+(?:it\s+)?true\s+that/i,
          /can\s+you\s+(?:confirm|verify|tell\s+me)/i,
          /do\s+you\s+know\s+(?:about|anything\s+about)/i,
          /have\s+you\s+heard\s+(?:of|about)/i,

          // Tech and documentation queries - expanded
          /(?:top|best|latest)\s+(?:tech|technology|websites|sites|apps|tools|frameworks|libraries)/i,
          /(?:what\s+are\s+the\s+)?(?:top|best|latest)\s+.*(?:sites|websites|platforms|tools|languages|frameworks)/i,
          /(?:javascript|python|react|node|programming|coding|development)/i, // Tech keywords

          // More natural language patterns
          /tell\s+me\s+about/i,
          /explain\s+(?:to\s+me\s+)?(?:what|how)/i,
          /how\s+(?:does|do|can|to)/i,
          /why\s+(?:is|are|does|do)/i,
          /where\s+(?:is|are|can|to)/i,
          /when\s+(?:is|are|was|were|did)/i,

          // PocketFlow specific patterns
          /give\s+me\s+(?:the\s+)?pocketflow\s+code/i,
          /show\s+me\s+pocketflow\s+(?:implementation|code)/i,
          /how\s+to\s+implement\s+pocketflow/i,
          /pocketflow\s+(?:implementation|example|code|documentation)/i,
          /(?:search|find|lookup)\s+pocketflow/i,

          // Current events and trends
          /(?:current|latest|recent|new)\s+(?:trends|news|updates|developments)/i,
          /(?:price|cost|value)\s+of/i,
          /(?:tutorial|guide|example)\s+(?:for|on|about)/i,
        ];

        // Test knowledge patterns and log which one matched
        const matchedPattern = knowledgePatterns.find(pattern => pattern.test(content));
        if (matchedPattern) {
          logger.info(
            `Processing as knowledge system request - matched pattern: ${matchedPattern.source}`
          );
          return await this.handleKnowledgeRequest(store, data);
        }
        logger.debug(`No knowledge patterns matched for: "${content.substring(0, 50)}..."`);
      }

      // Check for image generation patterns
      const imagePatterns = [
        // Direct drawing/creation requests
        /^(?:draw|create|generate|make)\s+(?:me\s+|us\s+|a\s+|an\s+|the\s+)?/i,
        // Specific image/picture requests
        /(?:draw|create|generate|make)\s+(?:an?\s+)?(?:image|picture|photo|artwork|art)/i,
        /(?:image|picture|photo)\s+of/i,
        /(?:show\s+me|give\s+me)\s+(?:an?\s+)?(?:image|picture|photo)/i,
        // "I want/need" patterns
        /^(?:i\s+(?:want|need|would\s+like))\s+(?:a|an|you\s+to\s+draw)/i,
      ];

      if (imagePatterns.some(pattern => pattern.test(content))) {
        logger.info('Processing as image generation request');
        return await this.handleImageGeneration(store, data);
      }

      // Check for weather patterns
      const weatherPatterns = [
        /(?:weather|forecast|temperature).*(?:in|for|at|of)\s+(.+)/i,
        /(?:what'?s|how'?s|tell me)\s+(?:the\s+)?(?:weather|forecast|temperature).*(?:in|for|at|of)\s+(.+)/i,
        /(?:weather|forecast|temperature)\s+(.+)/i,
      ];

      if (weatherPatterns.some(pattern => pattern.test(content))) {
        logger.info('Processing as weather request');
        return await this.handleWeatherRequest(store, data);
      }

      // Check for time patterns
      const timePatterns = [
        /(?:what'?s|what\s+is|tell me)?\s*(?:the\s+)?time\s+(?:in|for|at|of)\s+(.+)/i,
        /(?:current\s+)?time\s+(?:in|for|at|of)\s+(.+)/i,
        /(?:what\s+time\s+is\s+it)\s+(?:in|for|at|of)\s+(.+)/i,
        /time\s+(.+)/i,
      ];

      if (timePatterns.some(pattern => pattern.test(content))) {
        logger.info('Processing as time request');
        return await this.handleTimeRequest(store, data);
      }

      // Check for quake stats patterns
      if (content.includes('quake') && (content.includes('stats') || content.includes('server'))) {
        logger.info('Processing as quake stats request');
        return await this.handleQuakeStats(store, data);
      }

      // Default to conversation
      logger.info('Processing as conversation request');
      return await this.handleConversation(store, data);
    } catch (error) {
      logger.error('Error in unified processing:', {
        error: error.message,
        stack: error.stack,
        messageContent: data?.message?.content || 'unknown',
        userId: data?.message?.author?.id || 'unknown',
      });
      return {
        success: false,
        error: error.message,
        response: 'I encountered an error while processing your message. Please try again.',
      };
    }
  }

  async handleImageGeneration(store, data) {
    try {
      const { message } = data;

      // Extract prompt from message content
      const prompt =
        message.content
          .replace(
            /^(?:draw|create|generate|make)\s+(?:an?\s+)?(?:image|picture|photo|artwork|art)\s+(?:of\s+)?/i,
            ''
          )
          .replace(/^(?:image|picture|photo)\s+of\s+/i, '')
          .replace(
            /^(?:show\s+me|give\s+me)\s+(?:an?\s+)?(?:image|picture|photo)\s+(?:of\s+)?/i,
            ''
          )
          .trim() || message.content;

      logger.info(`Processing image generation request: ${prompt.substring(0, 50)}...`);

      // Create OpenAI client (same approach as PocketFlowFunctionProcessor)
      const configFile = require('../../core/configValidator');
      const { OpenAI } = require('openai');
      const openaiClient = new OpenAI({ apiKey: configFile.OPENAI_API_KEY });

      // Call OpenAI DALL-E API
      const imageResponse = await openaiClient.images.generate({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
        response_format: 'url',
      });

      const imageUrl = imageResponse.data[0].url;

      try {
        // Download the image for attachment
        const https = require('https');
        const http = require('http');

        const downloadImage = url => {
          return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;

            client
              .get(url, response => {
                if (response.statusCode !== 200) {
                  reject(new Error(`Failed to download image: ${response.statusCode}`));
                  return;
                }

                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () => {
                  const buffer = Buffer.concat(chunks);
                  resolve(buffer);
                });
              })
              .on('error', reject);
          });
        };

        const imageBuffer = await downloadImage(imageUrl);
        const fileName = `generated_image_${Date.now()}.png`;

        // Validate buffer before using it
        if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
          logger.error('Downloaded image buffer is invalid:', {
            bufferExists: !!imageBuffer,
            isBuffer: Buffer.isBuffer(imageBuffer),
            bufferType: typeof imageBuffer,
          });
          throw new Error('Failed to download image - invalid buffer');
        }

        logger.debug('Image downloaded successfully:', {
          bufferSize: imageBuffer.length,
          fileName: fileName,
        });

        // Save image to PFP rotation if PFPManager is available
        if (this.pfpManager) {
          try {
            const savedPath = await this.pfpManager.addImage(imageBuffer, fileName);
            logger.info(`Image saved to PFP rotation: ${savedPath}`);
          } catch (pfpError) {
            logger.warn('Failed to save image to PFP rotation:', pfpError.message);
            // Don't fail the whole request if PFP save fails
          }
        }

        return {
          success: true,
          response: `Here's your generated image for: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`,
          type: 'image',
          imageUrl: imageUrl,
          attachment: {
            buffer: imageBuffer,
            name: fileName,
          },
        };
      } catch (downloadError) {
        logger.warn('Failed to download image, falling back to URL:', downloadError.message);

        // Fallback to clean link if download fails
        return {
          success: true,
          response: `Your image has been generated! [Click to view](${imageUrl})`,
          type: 'image',
          imageUrl: imageUrl,
        };
      }
    } catch (error) {
      logger.error('Error generating image:', {
        error: error.message,
        stack: error.stack,
        errorType: error.constructor.name,
        errorCode: error.code || 'unknown',
      });

      // Handle specific error types with user-friendly messages
      let userMessage = "I'm having trouble generating that image right now. Please try again.";

      if (
        error.code === 'billing_hard_limit_reached' ||
        error.message?.includes('Billing hard limit')
      ) {
        userMessage =
          '🎰 Oops! The image generation slot machine needs more coins! The OpenAI account has hit its billing limit. Time to feed the machine some more credits! 💰';
      } else if (error.code === 'rate_limit_exceeded' || error.message?.includes('rate limit')) {
        userMessage =
          "🐌 Whoa there, speed racer! I'm generating images too fast. Let me catch my breath for a moment and try again in a few seconds!";
      } else if (error.code === 'invalid_request_error' || error.message?.includes('invalid')) {
        userMessage =
          '🤔 Hmm, something about that request confused my artistic brain. Could you try describing the image a bit differently?';
      } else if (error.message?.includes('content_policy')) {
        userMessage =
          "🚫 Uh oh! That image request bumped into OpenAI's content policy. Let's try something a bit more family-friendly!";
      }

      return {
        success: false,
        error: error.message,
        response: userMessage,
      };
    }
  }

  async handleKnowledgeRequest(store, data) {
    try {
      if (!this.knowledgeFlow) {
        return {
          success: false,
          error: 'Knowledge system not available',
          response: 'The knowledge system is currently disabled.',
        };
      }

      const { message } = data;

      logger.info(`Processing knowledge request: ${message.content.substring(0, 50)}...`);

      // Use the multi-agent KnowledgeFlow to process the request
      const knowledgeResult = await this.knowledgeFlow.processKnowledgeRequest(message);

      logger.debug(`[KNOWLEDGE_RESULT_DEBUG] KnowledgeFlow returned:`, {
        success: knowledgeResult.success,
        hasResponse: !!knowledgeResult.response,
        responseLength: knowledgeResult.response ? knowledgeResult.response.length : 0,
        responsePreview: knowledgeResult.response
          ? knowledgeResult.response.substring(0, 100) + '...'
          : 'no response',
        confidence: knowledgeResult.confidence,
        hasCode: knowledgeResult.hasCode,
        error: knowledgeResult.error,
      });

      return {
        success: knowledgeResult.success,
        response: knowledgeResult.response,
        type: 'knowledge',
        confidence: knowledgeResult.confidence,
        hasCode: knowledgeResult.hasCode,
        attachments: knowledgeResult.attachments || [],
        error: knowledgeResult.error,
      };
    } catch (error) {
      logger.error('Error in knowledge request handling:', {
        error: error.message,
        stack: error.stack,
        messageContent: data?.message?.content || 'unknown',
        userId: data?.message?.author?.id || 'unknown',
      });
      // Handle specific error types with user-friendly messages
      let userMessage =
        "I'm having trouble processing your knowledge request right now. Please try again.";

      if (
        error.code === 'billing_hard_limit_reached' ||
        error.message?.includes('Billing hard limit')
      ) {
        userMessage =
          '🧠 My knowledge bank ran out of research credits! The OpenAI account hit its billing limit. Time to refill the intellectual fuel tank! 📚💰';
      } else if (error.code === 'rate_limit_exceeded' || error.message?.includes('rate limit')) {
        userMessage =
          "🔍 I'm searching for answers too fast and making the knowledge servers dizzy! Let me slow down my research pace... 📖";
      }

      return {
        success: false,
        error: error.message,
        response: userMessage,
      };
    }
  }

  async handleWeatherRequest(store, data) {
    let weatherData = null;
    try {
      const { message } = data;
      const _content = message.content.toLowerCase();

      logger.info(`Processing weather request: ${message.content.substring(0, 50)}...`);

      // Extract location from the message using regex patterns
      let location = null;
      const weatherPatterns = [
        /(?:weather|forecast|temperature).*(?:in|for|at|of)\s+(.+)/i,
        /(?:what'?s|how'?s|tell me)\s+(?:the\s+)?(?:weather|forecast|temperature).*(?:in|for|at|of)\s+(.+)/i,
        /(?:weather|forecast|temperature)\s+(.+)/i,
      ];

      for (const pattern of weatherPatterns) {
        const match = message.content.match(pattern);
        if (match && match[1]) {
          location = match[1].trim();
          // Remove common trailing words
          location = location
            .replace(/\?+$/, '')
            .replace(/\s+(please|today|now|currently)$/i, '')
            .trim();
          break;
        }
      }

      if (!location) {
        return {
          success: false,
          error: 'Location not found',
          response:
            "I'd be happy to help with the weather! Please specify a location, like 'What's the weather in Auckland?'",
        };
      }

      logger.info(`Extracted location: ${location}`);

      // Use the simplified weather service for structured data
      const { getWeatherResponse } = require('../../services/simplified-weather');
      weatherData = await getWeatherResponse(location, message.content);

      // If we got structured weather data, format it with the bot's personality
      if (weatherData && weatherData.formattedSummary) {
        // Create a conversation context with the weather data for the bot to respond with personality
        const botPersonality = store.get('botPersonality');
        const weatherContext = `The user asked: "${message.content}"\n\nWeather data: ${weatherData.formattedSummary}\n\nRespond naturally with your personality while providing this weather information.`;

        try {
          // Generate response with bot personality
          const completion = await this.openaiClient.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: botPersonality,
              },
              {
                role: 'user',
                content: weatherContext,
              },
            ],
            max_tokens: 500,
            temperature: 0.7,
          });

          const personalizedResponse = completion.choices[0].message.content;

          return {
            success: true,
            response: personalizedResponse,
            type: 'weather',
            location: location,
            weatherData: weatherData.weatherData,
          };
        } catch (personalityError) {
          logger.warn(
            'Failed to apply personality to weather response, using formatted summary',
            personalityError
          );
          // Fallback to the formatted summary if personality application fails
          return {
            success: true,
            response: weatherData.formattedSummary,
            type: 'weather',
            location: location,
            weatherData: weatherData.weatherData,
          };
        }
      }

      // Fallback if structured data is not available
      return {
        success: false,
        error: 'Weather data formatting error',
        response:
          "I'm having trouble formatting the weather information right now. Please try again.",
      };
    } catch (error) {
      logger.error('Error in weather request handling:', {
        error: error.message,
        stack: error.stack,
        messageContent: data?.message?.content || 'unknown',
        userId: data?.message?.author?.id || 'unknown',
        weatherDataReceived: !!weatherData,
        weatherDataType: weatherData?.type || 'unknown',
        hasFormattedSummary: !!weatherData?.formattedSummary,
      });
      // Handle specific error types with user-friendly messages
      let userMessage =
        "I'm having trouble getting the weather right now. Please try again in a moment.";

      if (
        error.code === 'billing_hard_limit_reached' ||
        error.message?.includes('Billing hard limit')
      ) {
        userMessage =
          '🌧️ Looks like my weather radar ran out of coins! The OpenAI account hit its billing limit. Time to refuel the forecast machine! ⛽💰';
      } else if (error.code === 'rate_limit_exceeded' || error.message?.includes('rate limit')) {
        userMessage =
          "🌪️ Whoa! I'm checking the weather too fast and causing a storm in the servers! Let the clouds settle for a moment... ☁️";
      }

      return {
        success: false,
        error: error.message,
        response: userMessage,
      };
    }
  }

  async handleTimeRequest(store, data) {
    try {
      const { message } = data;
      const _content = message.content.toLowerCase();

      logger.info(`Processing time request: ${message.content.substring(0, 50)}...`);

      // Extract location from the message using regex patterns
      let location = null;
      const timePatterns = [
        /(?:what'?s|what\s+is|tell me)?\s*(?:the\s+)?time\s+(?:in|for|at|of)\s+(.+)/i,
        /(?:current\s+)?time\s+(?:in|for|at|of)\s+(.+)/i,
        /(?:what\s+time\s+is\s+it)\s+(?:in|for|at|of)\s+(.+)/i,
        /time\s+(.+)/i,
      ];

      for (const pattern of timePatterns) {
        const match = message.content.match(pattern);
        if (match && match[1]) {
          location = match[1].trim();
          // Remove common trailing words
          location = location
            .replace(/\?+$/, '')
            .replace(/\s+(please|now|currently|right\s+now)$/i, '')
            .trim();
          break;
        }
      }

      if (!location) {
        return {
          success: false,
          error: 'Location not found',
          response:
            "I'd be happy to help with the time! Please specify a location, like 'What time is it in Tokyo?'",
        };
      }

      logger.info(`Extracted location for time lookup: ${location}`);

      // Use the existing time lookup service
      const lookupTime = require('../../services/timeLookup');
      const timeData = await lookupTime(location);

      // Format response with bot personality
      const botPersonality = store.get('botPersonality');
      const timeContext = `The user asked: "${message.content}"\n\nTime information: ${timeData}\n\nRespond naturally with your personality while providing this time information.`;

      try {
        // Generate response with bot personality
        const completion = await this.openaiClient.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: botPersonality,
            },
            {
              role: 'user',
              content: timeContext,
            },
          ],
          max_tokens: 300,
          temperature: 0.7,
        });

        const personalizedResponse = completion.choices[0].message.content;

        return {
          success: true,
          response: personalizedResponse,
          type: 'time',
          location: location,
          rawTimeData: timeData,
        };
      } catch (personalityError) {
        logger.warn(
          'Failed to apply personality to time response, using raw data',
          personalityError
        );
        // Fallback to the raw time data if personality application fails
        return {
          success: true,
          response: timeData,
          type: 'time',
          location: location,
          rawTimeData: timeData,
        };
      }
    } catch (error) {
      logger.error('Error in time request handling:', {
        error: error.message,
        stack: error.stack,
        messageContent: data?.message?.content || 'unknown',
        userId: data?.message?.author?.id || 'unknown',
      });
      // Handle specific error types with user-friendly messages
      let userMessage =
        "I'm having trouble getting the time right now. Please try again in a moment.";

      if (
        error.code === 'billing_hard_limit_reached' ||
        error.message?.includes('Billing hard limit')
      ) {
        userMessage =
          '⏰ Oops! My internal clock ran out of battery! The OpenAI account hit its billing limit. Time to charge up those time-telling tokens! 🔋💰';
      } else if (error.code === 'rate_limit_exceeded' || error.message?.includes('rate limit')) {
        userMessage =
          "🕐 Tick tock, I'm checking time too fast! Let me slow down my clock for a moment... ⏳";
      }

      return {
        success: false,
        error: error.message,
        response: userMessage,
      };
    }
  }

  async handleQuakeStats(_store, data) {
    try {
      const { message: _message } = data;

      logger.info('Processing quake stats request');

      // Use the underlying quake lookup service directly
      const lookupQuakeServer = require('../../services/quakeLookup');

      // Get default server stats (no specific server specified)
      const serverData = await lookupQuakeServer(null, 1); // Default server, elo mode 1

      return {
        success: true,
        response: serverData || 'No server stats available at the moment.',
        type: 'quake',
      };
    } catch (error) {
      logger.error('Error fetching quake stats:', error);
      return {
        success: false,
        error: error.message,
        response: "I'm having trouble fetching server stats right now. Please try again.",
      };
    }
  }

  async handleConversation(store, data) {
    try {
      const { message } = data;
      const userId = message.author?.id;

      if (!userId) {
        return { success: false, error: 'No user ID provided' };
      }

      // Get or create conversation history
      const conversations = store.get('conversations');
      const conversation = conversations.get(userId) || { messages: [] };

      // Add user message to conversation
      conversation.messages.push({
        role: 'user',
        content: message.content,
        timestamp: Date.now(),
      });

      // Keep conversation length manageable
      if (conversation.messages.length > this.options.maxConversationLength) {
        conversation.messages = conversation.messages.slice(-this.options.maxConversationLength);
      }

      // Build OpenAI conversation with personality
      const botPersonality = store.get('botPersonality');
      const openaiMessages = [
        {
          role: 'system',
          content: botPersonality,
        },
        ...conversation.messages,
      ];

      logger.debug(
        `Processing conversation for user ${userId} with ${openaiMessages.length} messages`
      );

      // Call OpenAI
      const completion = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: openaiMessages,
        max_tokens: this.options.maxTokens,
        temperature: 0.7,
      });

      const response = completion.choices[0].message.content;

      // Add bot response to conversation history
      conversation.messages.push({
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      });

      // Save updated conversation
      conversations.set(userId, conversation);

      logger.info(`Generated response for user ${userId}: ${response.substring(0, 50)}...`);

      return {
        success: true,
        response: response,
        type: 'conversation',
        conversationLength: conversation.messages.length,
      };
    } catch (error) {
      logger.error('Error in conversation handling:', error);

      // Handle specific error types with user-friendly messages
      let userMessage = "I'm having trouble processing your message right now. Please try again.";

      if (
        error.code === 'billing_hard_limit_reached' ||
        error.message?.includes('Billing hard limit')
      ) {
        userMessage =
          "💸 Uh oh! My brain ran out of thinking tokens! The OpenAI account hit its billing limit. Time to top up the ol' digital wallet! 🧠💰";
      } else if (error.code === 'rate_limit_exceeded' || error.message?.includes('rate limit')) {
        userMessage =
          "🏃‍♂️ Whoa, I'm thinking too fast and my brain is overheating! Give me a sec to cool down and I'll be right back! ❄️";
      } else if (error.code === 'invalid_request_error' || error.message?.includes('invalid')) {
        userMessage =
          '🤷‍♂️ Something about your message scrambled my circuits a bit. Could you try rephrasing that?';
      } else if (error.message?.includes('content_policy')) {
        userMessage =
          "🚫 Oops! That topic bumped into my content guidelines. Let's chat about something else! 😊";
      }

      return {
        success: false,
        error: error.message,
        response: userMessage,
      };
    }
  }

  async processMessage(discordMessage) {
    const startTime = Date.now();

    try {
      logger.info(`Starting SimpleChimpGPTFlow processing for message ${discordMessage.id}`, {
        userId: discordMessage.author?.id,
        content: discordMessage.content.substring(0, 50) + '...',
        messageId: discordMessage.id,
        architecture: 'simplified_single_node',
      });

      const result = await this.flow.run({ message: discordMessage });

      const duration = Date.now() - startTime;

      logger.info(`Flow completed for message ${discordMessage.id}:`, {
        success: result.success,
        hasResponse: !!result.response,
        type: result.type,
        duration: duration + 'ms',
        responsePreview: result.response
          ? result.response.substring(0, 100) + '...'
          : 'no response',
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error in SimpleChimpGPTFlow:', {
        error: error.message,
        stack: error.stack,
        messageId: discordMessage.id,
        duration: duration + 'ms',
      });

      return {
        success: false,
        error: error.message,
        response: 'I encountered an error while processing your message.',
      };
    }
  }

  // Get conversation stats for monitoring
  getStats() {
    const conversations = this.store.get('conversations');
    const totalConversations = conversations.size;
    let totalMessages = 0;

    for (const conversation of conversations.values()) {
      totalMessages += conversation.messages.length;
    }

    return {
      architecture: 'simplified_pocketflow',
      implementation: 'single_node_unified_processor',
      performance: 'optimized_for_speed',
      totalConversations,
      totalMessages,
      avgMessagesPerConversation: totalConversations > 0 ? totalMessages / totalConversations : 0,
      knowledgeSystemEnabled: !!this.knowledgeFlow,
      uptime: Math.floor(process.uptime()),
    };
  }

  // Cleanup old conversations
  cleanup(maxAge = 24 * 60 * 60 * 1000) {
    // 24 hours default
    const conversations = this.store.get('conversations');
    const now = Date.now();
    let cleaned = 0;

    for (const [userId, conversation] of conversations) {
      const lastMessage = conversation.messages[conversation.messages.length - 1];
      if (lastMessage && now - lastMessage.timestamp > maxAge) {
        conversations.delete(userId);
        cleaned++;
      }
    }

    logger.info(`Cleaned up ${cleaned} old conversations`);
    return cleaned;
  }

  /**
   * Graceful shutdown - save knowledge before exit
   */
  async shutdown() {
    if (this.knowledgeFlow) {
      logger.info('Shutting down SimpleChimpGPTFlow...');
      await this.knowledgeFlow.shutdown();
    }
  }
}

module.exports = SimpleChimpGPTFlow;
