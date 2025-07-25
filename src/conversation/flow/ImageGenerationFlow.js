const { Node, SharedStore, Flow } = require('./PocketFlow');
const ImageGenerationAgentNode = require('./nodes/ImageGenerationAgentNode');
const { createLogger } = require('../../core/logger');

const _logger = createLogger('ImageGenerationFlow');

/**
 * Specialized PocketFlow for image generation with enhanced user experience
 * This flow provides dynamic status updates, better error handling, and
 * a more engaging interaction pattern for image creation requests
 */
class ImageGenerationFlow {
  constructor(options = {}) {
    this.options = {
      enableStatusUpdates: true,
      updateInterval: 3000,
      maxExecutionTime: 180000, // 3 minutes
      ...options,
    };

    this.activeGenerations = new Map();
    this.logger = createLogger('ImageGenerationFlow');
  }

  /**
   * Create a new image generation flow for a specific request
   */
  createFlow(originalMessage, originalFeedbackMessage) {
    const store = new SharedStore();

    // Store message context
    store.set('originalMessage', originalMessage);
    store.set('feedbackMessage', originalFeedbackMessage);
    store.set('startTime', Date.now());

    // Create the image generation agent node
    const imageAgent = new ImageGenerationAgentNode({
      config: {
        updateInterval: this.options.updateInterval,
        enableEnhancement: true,
        defaultSize: '1024x1024',
      },
    });

    // Create validation node
    const validationNode = new Node('validate_request', async (flowStore, data) => {
      const { message } = data;

      // Basic validation
      if (!message || !message.content) {
        return {
          success: false,
          error: 'Invalid message content',
          type: 'validation_error',
        };
      }

      // Check if this is actually an image request
      if (!this.isImageRequest(message.content)) {
        return {
          success: false,
          error: 'Not an image generation request',
          type: 'validation_error',
        };
      }

      return {
        success: true,
        message,
        type: 'validation_success',
      };
    });

    // Create status update node
    const statusUpdateNode = new Node('status_updater', async (flowStore, data) => {
      if (!this.options.enableStatusUpdates) {
        return data;
      }

      const feedbackMessage = flowStore.get('feedbackMessage');
      if (!feedbackMessage || typeof feedbackMessage.edit !== 'function') {
        this.logger.warn('No valid feedback message for status updates');
        return data;
      }

      // Start status update interval
      const progressKey = `image_progress_${originalMessage.id}`;
      const updateInterval = this.startStatusUpdates(flowStore, progressKey, feedbackMessage);

      // Store interval ID for cleanup
      flowStore.set('updateInterval', updateInterval);

      return data;
    });

    // Create cleanup node
    const cleanupNode = new Node('cleanup', async (flowStore, data) => {
      // Clear status update interval
      const updateInterval = flowStore.get('updateInterval');
      if (updateInterval) {
        clearInterval(updateInterval);
      }

      // Remove from active generations
      if (this.activeGenerations.has(originalMessage.id)) {
        this.activeGenerations.delete(originalMessage.id);
      }

      return data;
    });

    // Create result processing node
    const resultProcessorNode = new Node('process_result', async (flowStore, data) => {
      const feedbackMessage = flowStore.get('feedbackMessage');

      if (data.success && data.result) {
        // Image generation successful
        await this.sendSuccessfulResult(feedbackMessage, data.result);

        return {
          success: true,
          type: 'image_delivered',
          result: data.result,
          executionTime: data.executionTime,
        };
      }
      // Image generation failed
      await this.sendErrorResult(feedbackMessage, data.error || 'Unknown error');

      return {
        success: false,
        type: 'image_failed',
        error: data.error,
        executionTime: data.executionTime,
      };
    });

    // Connect the nodes in a flow
    validationNode
      .connect(statusUpdateNode, result => result.success)
      .connect(imageAgent, result => result.success)
      .connect(resultProcessorNode, () => true)
      .connect(cleanupNode, () => true);

    // Handle validation failures
    validationNode.connect(cleanupNode, result => !result.success);

    const flow = new Flow(validationNode, store);

    // Track this generation
    this.activeGenerations.set(originalMessage.id, {
      flow,
      store,
      startTime: Date.now(),
      message: originalMessage,
      feedbackMessage: originalFeedbackMessage,
    });

    return flow;
  }

  /**
   * Execute image generation with PocketFlow
   */
  async generateImage(message, feedbackMessage) {
    try {
      const flow = this.createFlow(message, feedbackMessage);

      const result = await flow.run({
        message,
        context: [], // Basic context for now
      });

      this.logger.info('Image generation flow completed', {
        messageId: message.id,
        success: result.success,
        executionTime: result.executionTime,
      });

      return result;
    } catch (error) {
      this.logger.error('Error in image generation flow:', error);

      // Ensure cleanup
      if (this.activeGenerations.has(message.id)) {
        const generation = this.activeGenerations.get(message.id);
        const updateInterval = generation.store.get('updateInterval');
        if (updateInterval) {
          clearInterval(updateInterval);
        }
        this.activeGenerations.delete(message.id);
      }

      // Send error message
      if (feedbackMessage && typeof feedbackMessage.edit === 'function') {
        await this.sendErrorResult(feedbackMessage, error.message);
      }

      return {
        success: false,
        error: error.message,
        type: 'flow_error',
      };
    }
  }

  /**
   * Start dynamic status updates
   */
  startStatusUpdates(store, progressKey, feedbackMessage) {
    const imageAgent = new ImageGenerationAgentNode();

    return imageAgent.createStatusUpdater(store, progressKey, async statusMessage => {
      try {
        await feedbackMessage.edit(statusMessage);
      } catch (error) {
        this.logger.debug('Error updating status message:', error);
      }
    });
  }

  /**
   * Send successful image result to Discord
   */
  async sendSuccessfulResult(feedbackMessage, result) {
    try {
      if (result.imageData) {
        // Send as attachment with base64 data
        const imageBuffer = Buffer.from(result.imageData, 'base64');
        const fileName = `ai_artwork_${Date.now()}.png`;

        await feedbackMessage.edit({
          content: result.responseText,
          files: [
            {
              attachment: imageBuffer,
              name: fileName,
            },
          ],
        });
      } else if (result.imageUrl && !result.imageUrl.startsWith('data:')) {
        // Send with URL
        await feedbackMessage.edit(`${result.responseText}\n\n${result.imageUrl}`);
      } else {
        // Handle data URLs
        if (result.imageUrl && result.imageUrl.startsWith('data:')) {
          const base64Match = result.imageUrl.match(/data:([^;]+);base64,(.+)/);
          if (base64Match) {
            const mimeType = base64Match[1];
            const base64Data = base64Match[2];
            const imageBuffer = Buffer.from(base64Data, 'base64');

            let fileExtension = 'png';
            if (mimeType.includes('jpeg')) fileExtension = 'jpg';
            else if (mimeType.includes('webp')) fileExtension = 'webp';

            const fileName = `ai_artwork_${Date.now()}.${fileExtension}`;

            await feedbackMessage.edit({
              content: result.responseText,
              files: [
                {
                  attachment: imageBuffer,
                  name: fileName,
                },
              ],
            });
            return;
          }
        }

        // Fallback
        await feedbackMessage.edit(
          `${result.responseText}\n\n⚠️ Image generated but could not be displayed properly.`
        );
      }
    } catch (error) {
      this.logger.error('Error sending successful result:', error);
      try {
        await feedbackMessage.edit(
          `${result.responseText}\n\n⚠️ Image generated but encountered an error displaying it.`
        );
      } catch (editError) {
        this.logger.error('Error editing message after display error:', editError);
      }
    }
  }

  /**
   * Send error result to Discord
   */
  async sendErrorResult(feedbackMessage, errorMessage) {
    try {
      const errorResponse = `❌ **Image Generation Failed**\n\n${errorMessage}`;
      await feedbackMessage.edit(errorResponse);
    } catch (error) {
      this.logger.error('Error sending error result:', error);
    }
  }

  /**
   * Check if the message is an image generation request
   */
  isImageRequest(content) {
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

  /**
   * Get status of active image generations
   */
  getActiveGenerations() {
    const active = [];
    for (const [messageId, generation] of this.activeGenerations) {
      active.push({
        messageId,
        startTime: generation.startTime,
        elapsed: Date.now() - generation.startTime,
        username: generation.message.author?.username || 'Unknown',
      });
    }
    return active;
  }

  /**
   * Cancel an active image generation
   */
  cancelGeneration(messageId) {
    if (this.activeGenerations.has(messageId)) {
      const generation = this.activeGenerations.get(messageId);

      // Clear status updates
      const updateInterval = generation.store.get('updateInterval');
      if (updateInterval) {
        clearInterval(updateInterval);
      }

      // Remove from tracking
      this.activeGenerations.delete(messageId);

      this.logger.info(`Cancelled image generation for message ${messageId}`);
      return true;
    }
    return false;
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown() {
    // Cancel all active generations
    for (const messageId of this.activeGenerations.keys()) {
      this.cancelGeneration(messageId);
    }

    this.logger.info('Image generation flow shut down');
  }
}

module.exports = ImageGenerationFlow;
