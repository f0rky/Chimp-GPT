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
          /(?:search|lookup|find)\s+(?:information|docs|documentation)\s+about/i,
          /is\s+(?:it\s+)?true\s+that/i,
          /can\s+you\s+(?:confirm|verify|search|lookup|look\s+up|find)/i,
          /give\s+me\s+(?:the\s+)?pocketflow\s+code/i,
          /show\s+me\s+pocketflow\s+(?:implementation|code)/i,
          /how\s+to\s+implement\s+pocketflow/i,
          /pocketflow\s+(?:implementation|example|code|documentation)/i,
          /(?:search|find|lookup)\s+pocketflow/i,
        ];

        if (knowledgePatterns.some(pattern => pattern.test(content))) {
          logger.info('Processing as knowledge system request');
          return await this.handleKnowledgeRequest(store, data);
        }
      }

      // Check for image generation patterns
      const imagePatterns = [
        /(?:draw|create|generate|make)\s+(?:an?\s+)?(?:image|picture|photo|artwork|art)/i,
        /(?:image|picture|photo)\s+of/i,
        /(?:show\s+me|give\s+me)\s+(?:an?\s+)?(?:image|picture|photo)/i,
      ];

      if (imagePatterns.some(pattern => pattern.test(content))) {
        logger.info('Processing as image generation request');
        return await this.handleImageGeneration(store, data);
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

      // Call OpenAI DALL-E API
      const imageResponse = await this.openaiClient.images.generate({
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
          response: `🎨 **Image Generated Successfully!** *(Added to PFP rotation)*`,
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
          response: `🎨 **Image Generated!** [Click to view your image](${imageUrl})`,
          type: 'image',
          imageUrl: imageUrl,
        };
      }
    } catch (error) {
      logger.error('Error generating image:', error);
      return {
        success: false,
        error: error.message,
        response: "I'm having trouble generating that image right now. Please try again.",
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
      return {
        success: false,
        error: error.message,
        response:
          "I'm having trouble processing your knowledge request right now. Please try again.",
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
      return {
        success: false,
        error: error.message,
        response: "I'm having trouble processing your message right now. Please try again.",
      };
    }
  }

  async processMessage(discordMessage) {
    const startTime = Date.now();

    try {
      logger.info(`Starting PocketFlow processing for message ${discordMessage.id}`, {
        userId: discordMessage.author?.id,
        content: discordMessage.content.substring(0, 50) + '...',
        messageId: discordMessage.id,
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
      totalConversations,
      totalMessages,
      avgMessagesPerConversation: totalConversations > 0 ? totalMessages / totalConversations : 0,
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
}

module.exports = SimpleChimpGPTFlow;
