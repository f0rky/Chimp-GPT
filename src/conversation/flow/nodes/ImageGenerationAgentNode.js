const BaseConversationNode = require('./BaseNode');
const { createLogger } = require('../../../core/logger');
const { generateImage, enhanceImagePrompt } = require('../../../services/imageGeneration');
const {
  checkImageGenerationRateLimit,
  constants: { IMAGE_GEN_POINTS },
} = require('../../../middleware/rateLimiter');

const logger = createLogger('ImageGenerationAgentNode');

/**
 * Specialized PocketFlow agent for image generation with dynamic status updates
 * This agent provides a more engaging user experience with varied status messages
 * and better integration with the PocketFlow architecture
 */
class ImageGenerationAgentNode extends BaseConversationNode {
  constructor(options = {}) {
    const action = async (store, data) => {
      return await this.executeImageGeneration(store, data);
    };

    super('image_generation_agent', action, {
      timeout: 180000, // 3 minutes for image generation
      logLevel: 'info',
      ...options,
    });

    this.config = {
      updateInterval: 3000, // 3 seconds between status updates
      enableEnhancement: true,
      defaultSize: '1024x1024',
      maxRetries: 2,
      ...options.config,
    };

    // Dynamic status messages for more engaging user experience
    this.statusMessages = {
      initializing: [
        '🎨 Preparing the digital canvas...',
        '⚙️ Warming up the AI art studio...',
        '🖌️ Getting ready to create magic...',
        '✨ Initializing creative algorithms...',
      ],
      enhancing: [
        '🧠 Analyzing your vision with AI...',
        '✨ Enhancing your prompt for better results...',
        '🎯 Fine-tuning the creative direction...',
        '💡 Adding artistic intelligence to your idea...',
      ],
      generating: [
        '🎨 Painting your vision into reality...',
        '🖼️ Crafting pixels with artistic precision...',
        '✨ Weaving digital art from your imagination...',
        '🎭 Bringing your creative vision to life...',
        '🌟 Generating artistic masterpiece...',
      ],
      downloading: [
        '⬇️ Retrieving your artistic creation...',
        '📥 Downloading the masterpiece...',
        '🎨 Collecting your digital artwork...',
      ],
      finalizing: [
        '🎁 Preparing your image for delivery...',
        '✨ Adding final touches...',
        '📸 Getting ready to share your creation...',
      ],
    };

    this.completedMessages = {
      initializing: ['✅ Canvas ready'],
      enhancing: ['✅ Prompt optimized'],
      generating: ['✅ Image created'],
      downloading: ['✅ Artwork retrieved'],
      finalizing: ['✅ Ready to share'],
    };
  }

  async executeImageGeneration(store, data) {
    const startTime = Date.now();
    const { message } = data;

    try {
      // Extract parameters from the message
      const parameters = this.extractImageParameters(message.content);

      if (!parameters.prompt || parameters.prompt.trim() === '') {
        return {
          success: false,
          error: 'Please provide a description for the image you want to generate.',
          type: 'validation_error',
        };
      }

      // Initialize progress tracking in the store
      const progressKey = `image_progress_${message.id}`;
      store.set(progressKey, {
        startTime,
        currentPhase: 'initializing',
        phases: {
          initializing: { start: startTime, end: null },
          enhancing: { start: null, end: null },
          generating: { start: null, end: null },
          downloading: { start: null, end: null },
          finalizing: { start: null, end: null },
        },
        completedPhases: [],
      });

      // Start the image generation agent workflow
      const result = await this.runImageGenerationWorkflow(store, message, parameters, progressKey);

      // Clean up progress tracking
      store.delete(progressKey);

      return result;
    } catch (error) {
      logger.error('Error in image generation agent:', error);
      store.delete(`image_progress_${message.id}`);

      return {
        success: false,
        error: this.getErrorMessage(error),
        type: 'execution_error',
        executionTime: Date.now() - startTime,
      };
    }
  }

  async runImageGenerationWorkflow(store, message, parameters, progressKey) {
    const progress = store.get(progressKey);

    try {
      // Phase 1: Rate limiting and validation
      await this.updatePhase(store, progressKey, 'initializing');

      const username = message.author?.username || 'Unknown User';
      const rateLimitResult = await checkImageGenerationRateLimit(
        message.author?.id || 'unknown',
        IMAGE_GEN_POINTS
      );

      if (rateLimitResult.limited) {
        return {
          success: false,
          error: rateLimitResult.message,
          type: 'rate_limit_error',
        };
      }

      // Phase 2: Prompt enhancement
      await this.updatePhase(store, progressKey, 'enhancing');

      let enhancedPrompt = parameters.prompt;
      if (this.config.enableEnhancement && parameters.enhance !== false) {
        try {
          enhancedPrompt = await enhanceImagePrompt(parameters.prompt);
          logger.info('Prompt enhanced successfully', {
            original: parameters.prompt,
            enhanced: enhancedPrompt,
          });
        } catch (enhanceError) {
          logger.warn('Failed to enhance prompt, using original', { error: enhanceError });
          enhancedPrompt = parameters.prompt;
        }
      }

      // Phase 3: Image generation
      await this.updatePhase(store, progressKey, 'generating');

      const imageOptions = {
        model: parameters.model || 'gpt-image-1',
        size: parameters.size || this.config.defaultSize,
        quality: parameters.quality || 'standard',
        username,
        rateLimitInfo: rateLimitResult,
      };

      logger.info('Starting image generation', {
        prompt: enhancedPrompt,
        options: imageOptions,
      });

      const imageResult = await generateImage(enhancedPrompt, imageOptions);

      // Phase 4: Processing and downloading
      await this.updatePhase(store, progressKey, 'downloading');

      // Simulate some processing time for better UX
      await this.sleep(1000);

      // Phase 5: Finalizing
      await this.updatePhase(store, progressKey, 'finalizing');

      const executionTime = Date.now() - progress.startTime;

      // Process the image result
      const processedResult = this.processImageResult(imageResult, {
        originalPrompt: parameters.prompt,
        enhancedPrompt,
        executionTime,
        ...imageOptions,
      });

      return {
        success: true,
        type: 'image_generated',
        result: processedResult,
        executionTime,
        phases: store.get(progressKey).phases,
      };
    } catch (error) {
      logger.error('Error in image generation workflow:', error);
      throw error;
    }
  }

  async updatePhase(store, progressKey, newPhase) {
    const progress = store.get(progressKey);
    const now = Date.now();

    // Complete current phase
    if (progress.currentPhase && progress.phases[progress.currentPhase]) {
      progress.phases[progress.currentPhase].end = now;
      progress.completedPhases.push(progress.currentPhase);
    }

    // Start new phase
    progress.currentPhase = newPhase;
    progress.phases[newPhase].start = now;

    store.set(progressKey, progress);

    // Log phase transition for monitoring
    logger.debug(`Image generation phase transition: ${newPhase}`);
  }

  /**
   * Get dynamic status message for current phase
   * This provides variety in status updates to make the bot feel more dynamic
   */
  getStatusMessage(phase, completedPhases = []) {
    const messages = this.statusMessages[phase] || ['🔄 Processing...'];
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];

    let statusText = randomMessage;

    // Add completed phases with checkmarks
    if (completedPhases.length > 0) {
      const completedText = completedPhases
        .map(completedPhase => {
          const msgs = this.completedMessages[completedPhase] || [`✅ ${completedPhase} complete`];
          return msgs[0];
        })
        .join(' • ');

      statusText += `\n${completedText}`;
    }

    return statusText;
  }

  extractImageParameters(content) {
    // Extract prompt from various image generation patterns

    const imagePhrases = [
      /^draw (?:me |us |a |an |the )?/i,
      /^generate (?:me |us |a |an |the )?(?:image|picture|photo) (?:of |for )?/i,
      /^create (?:me |us |a |an |the )?(?:image|picture|photo) (?:of |for )?/i,
      /^make (?:me |us |a |an |the )?(?:image|picture|photo) (?:of |for )?/i,
      /^show (?:me |us )?(?:a |an |the )?(?:image|picture|photo) (?:of|for) /i,
    ];

    let prompt = content;
    for (const phrase of imagePhrases) {
      prompt = prompt.replace(phrase, '').trim();
    }

    // Extract size if specified
    let size = this.config.defaultSize;
    const sizeMatch = prompt.match(/(?:size|dimensions?)[:\s]+(\d+x\d+)/i);
    if (sizeMatch) {
      const requestedSize = sizeMatch[1];
      if (['1024x1024', '1536x1024', '1024x1536'].includes(requestedSize)) {
        size = requestedSize;
        prompt = prompt.replace(sizeMatch[0], '').trim();
      }
    }

    // Extract quality if specified
    let quality = 'standard';
    const qualityMatch = prompt.match(/(?:quality|resolution)[:\s]+(low|medium|high|standard)/i);
    if (qualityMatch) {
      quality = qualityMatch[1].toLowerCase();
      prompt = prompt.replace(qualityMatch[0], '').trim();
    }

    return {
      prompt: prompt.trim(),
      size,
      quality,
      enhance: true, // Default to enhancing prompts
    };
  }

  processImageResult(imageResult, metadata) {
    const firstImage =
      imageResult.images && imageResult.images[0] ? imageResult.images[0] : imageResult;

    const result = {
      imageUrl: firstImage.url,
      imageData: firstImage.b64_json,
      revisedPrompt:
        firstImage.revisedPrompt || imageResult.revised_prompt || metadata.enhancedPrompt,
      metadata: {
        originalPrompt: metadata.originalPrompt,
        enhancedPrompt: metadata.enhancedPrompt,
        model: metadata.model,
        size: metadata.size,
        quality: metadata.quality,
        executionTime: metadata.executionTime,
        timestamp: new Date().toISOString(),
      },
    };

    // Create response message
    const timeFormatted = this.formatElapsedTime(metadata.executionTime);

    let responseText = `🎨 **Artistic Creation Complete!**\n\n`;
    responseText += `**Your Vision:** ${metadata.originalPrompt}\n`;

    if (metadata.enhancedPrompt !== metadata.originalPrompt) {
      responseText += `**Enhanced Prompt:** ${metadata.enhancedPrompt}\n`;
    }

    responseText += `**Specifications:** ${metadata.size} • ${metadata.quality} quality\n`;
    responseText += `**Creation Time:** ${timeFormatted}\n\n`;
    responseText += `✨ *Generated with AI artistic intelligence*`;

    result.responseText = responseText;

    return result;
  }

  getErrorMessage(error) {
    if (error.message?.includes('content_policy_violation')) {
      return "🚫 Your request violates OpenAI's content policy. Please try a different prompt.";
    } else if (error.message?.includes('rate_limit')) {
      return '⏱️ Rate limit exceeded. Please wait a moment and try again.';
    } else if (error.message?.includes('insufficient_quota')) {
      return '💳 Insufficient API quota. Please check your OpenAI billing.';
    }
    return '⚠️ An unexpected error occurred during image generation. Please try again.';
  }

  formatElapsedTime(ms) {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a status update function that can be used by the PocketFlow system
   * to provide real-time updates to the user
   */
  createStatusUpdater(store, progressKey, updateCallback) {
    const interval = setInterval(() => {
      const progress = store.get(progressKey);
      if (!progress) {
        clearInterval(interval);
        return;
      }

      const statusMessage = this.getStatusMessage(progress.currentPhase, progress.completedPhases);

      const elapsedTime = Date.now() - progress.startTime;
      const timeFormatted = this.formatElapsedTime(elapsedTime);

      updateCallback(`${statusMessage}\n\n⏱️ Elapsed: ${timeFormatted}`);
    }, this.config.updateInterval);

    return interval;
  }
}

module.exports = ImageGenerationAgentNode;
