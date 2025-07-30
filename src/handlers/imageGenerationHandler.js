const { discord: discordLogger } = require('../core/logger');
const { generateImage, enhanceImagePrompt } = require('../services/imageGeneration');
const {
  checkImageGenerationRateLimit,
  constants: { IMAGE_GEN_POINTS },
} = require('../middleware/rateLimiter');
const { trackApiCall, trackError, handleStatsCommand } = require('../core/healthCheck');
const {
  processImageStream,
  createDiscordAttachment,
  shouldUseStreaming,
} = require('../utils/streamingBuffer');
const {
  ChimpError,
  ERROR_CATEGORIES,
  ERROR_SEVERITY,
  _withErrorHandling,
  enhanceError,
  handleOpenAIError,
  handleDiscordError,
  logError,
} = require('../utils/errorHandler');

/**
 * Handles image generation requests with detailed progress tracking
 *
 * This function processes image generation requests from OpenAI function calls,
 * provides real-time progress updates to users, handles rate limiting,
 * and manages the complete image generation workflow.
 *
 * @param {Object} parameters - The parameters from OpenAI function call
 * @param {Object} message - The Discord message object (feedback message)
 * @param {Array} conversationLog - The conversation history
 * @param {number} startTime - When the original request started
 * @param {Object} usage - Token usage information
 * @param {Object} apiCalls - API call tracking object
 * @param {Function} formatSubtext - Function to format response subtext
 * @param {Function} storeMessageRelationship - Function to store message relationships
 * @param {Object} statusManager - Status manager instance for tracking
 * @returns {Promise<void>}
 */
async function handleImageGeneration(
  parameters,
  message,
  _conversationLog = [],
  startTime = null,
  usage = {},
  apiCalls = {},
  formatSubtext,
  storeMessageRelationship,
  statusManager
) {
  try {
    // Use the start time passed in or from handleFunctionCall if available, otherwise use current time
    const actualStartTime = startTime || message.imageGenerationStartTime || Date.now();

    // Calculate how much time has already passed since the initial message
    const initialDelay = Date.now() - actualStartTime;
    discordLogger.debug(
      {
        startTime,
        currentTime: Date.now(),
        initialDelay,
      },
      'Starting handleImageGeneration with timing information'
    );

    let currentPhase = 'initializing';

    // Create a progress tracking object
    const progress = {
      startTime: actualStartTime,
      phases: {
        initializing: { start: actualStartTime, end: null, elapsed: 0 },
        enhancing: { start: null, end: null, elapsed: 0 },
        generating: { start: null, end: null, elapsed: 0 },
        downloading: { start: null, end: null, elapsed: 0 },
        uploading: { start: null, end: null, elapsed: 0 },
      },
      currentPhase,
      totalElapsed: 0,
    };

    // Keep track of completed phases for the status message
    const completedPhases = [];

    // Function to update progress
    const updateProgress = (newPhase = null) => {
      const now = Date.now();

      // If we're changing phases, update the phase timing
      if (newPhase && newPhase !== currentPhase) {
        // End the current phase
        progress.phases[currentPhase].end = now;
        progress.phases[currentPhase].elapsed = now - progress.phases[currentPhase].start;

        // Add the completed phase to our tracking array if it's not already there
        if (!completedPhases.includes(currentPhase)) {
          completedPhases.push(currentPhase);
        }

        // Start the new phase
        progress.phases[newPhase].start = now;
        currentPhase = newPhase;
        progress.currentPhase = newPhase;
      }

      // Update total elapsed time
      progress.totalElapsed = now - startTime;

      return progress;
    };

    // Setup periodic progress updates (every 5 seconds)
    const UPDATE_INTERVAL = 5000; // 5 seconds

    // Format elapsed time nicely
    const formatElapsed = ms => {
      if (ms < 1000) return `${ms}ms`;
      const seconds = Math.floor(ms / 1000);
      if (seconds < 60) return `${seconds}s`;
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    };

    // Use the passed message parameter directly - it should be the feedback message from handleFunctionCall
    const feedbackMessage = message;
    if (!feedbackMessage || typeof feedbackMessage.edit !== 'function') {
      throw new Error(
        'Invalid feedbackMessage passed to handleImageGeneration - must have edit function'
      );
    }

    // Start the progress updater
    const progressUpdater = setInterval(async () => {
      try {
        const currentProgress = updateProgress();
        const elapsedFormatted = formatElapsed(currentProgress.totalElapsed);

        let statusMessage = `🎨 Creating your image... (${elapsedFormatted})`;

        // Add phase-specific messages for current phase
        switch (currentProgress.currentPhase) {
          case 'initializing':
            statusMessage += '\n⚙️ Setting up image generation...';
            break;
          case 'enhancing':
            statusMessage += '\n✨ Enhancing your prompt with AI...';
            break;
          case 'generating':
            statusMessage += '\n🖼️ Generating your image...';
            break;
          case 'downloading':
            statusMessage += '\n⬇️ Downloading image...';
            break;
          case 'uploading':
            statusMessage += '\n⬆️ Uploading to Discord...';
            break;
          default:
            statusMessage += '\n🔄 Processing...';
        }

        // Show completed phases with checkmarks
        completedPhases.forEach(phase => {
          const phaseElapsed = formatElapsed(currentProgress.phases[phase].elapsed);
          switch (phase) {
            case 'initializing':
              statusMessage += `\n✅ Setup complete (${phaseElapsed})`;
              break;
            case 'enhancing':
              statusMessage += `\n✅ Prompt enhanced (${phaseElapsed})`;
              break;
            case 'generating':
              statusMessage += `\n✅ Image generated (${phaseElapsed})`;
              break;
            case 'downloading':
              statusMessage += `\n✅ Downloaded (${phaseElapsed})`;
              break;
            case 'uploading':
              statusMessage += `\n✅ Uploaded (${phaseElapsed})`;
              break;
            default:
              // Unknown phase, skip
              break;
          }
        });

        await feedbackMessage.edit(statusMessage);
      } catch (updateError) {
        // Use standardized error handling for progress updates
        const standardizedError = enhanceError(updateError, {
          operation: 'update_progress_message',
          category: ERROR_CATEGORIES.EXTERNAL_API,
          severity: ERROR_SEVERITY.LOW,
          context: {
            currentPhase: progress.currentPhase,
            totalElapsed: progress.totalElapsed,
          },
          userId: message.author?.id,
        });

        // Log at debug level to avoid spamming
        discordLogger.debug(
          { error: standardizedError.toLogObject() },
          'Error updating progress message'
        );
      }
    }, UPDATE_INTERVAL);

    // Update to enhancing phase
    updateProgress('enhancing');

    try {
      // Update progress before starting image generation
      await feedbackMessage.edit('🎨 Setting up image generation...');

      // Check for stats command in prompt
      if (parameters.prompt && parameters.prompt.toLowerCase().includes('stats')) {
        // Clear the progress updater
        clearInterval(progressUpdater);

        // Handle stats command
        await feedbackMessage.delete().catch(deleteError => {
          // Use standardized error handling for message deletion
          const standardizedError = handleDiscordError(deleteError, {
            operation: 'delete_stats_feedback_message',
            userId: message.author?.id,
          });

          logError(standardizedError);
        });

        // Create a mock message object for handleStatsCommand
        const mockMessage = {
          content: parameters.prompt,
          author: message.author || { username: 'Unknown' },
          channel: message.channel,
        };

        await handleStatsCommand(mockMessage);
        return;
      }

      // Extract and validate parameters
      const { prompt, model = 'gpt-image-1', size = '1024x1024', enhance = true } = parameters;

      if (!prompt || prompt.trim() === '') {
        await feedbackMessage.edit(
          '❌ Please provide a description for the image you want to generate.'
        );
        clearInterval(progressUpdater);
        return;
      }

      // Check rate limit first
      const username =
        message.channel?.guild?.members?.cache?.get(message.author?.id)?.displayName ||
        message.author?.username ||
        'Unknown User';

      // Use high point cost for image generation
      const rateLimitResult = await checkImageGenerationRateLimit(
        message.author?.id || 'unknown',
        IMAGE_GEN_POINTS
      );

      if (rateLimitResult.limited) {
        await feedbackMessage.edit(`⏱️ ${rateLimitResult.message}`);
        clearInterval(progressUpdater);
        return;
      }

      // Track image generation in status manager
      if (statusManager && typeof statusManager.trackImageGeneration === 'function') {
        statusManager.trackImageGeneration(
          message.author?.username || username || 'Unknown',
          prompt.substring(0, 100) // First 100 chars of prompt
        );
      }

      // Move to generating phase
      updateProgress('generating');

      let enhancedPrompt = prompt;

      // Enhance the prompt if requested
      if (enhance) {
        try {
          enhancedPrompt = await enhanceImagePrompt(prompt);
          discordLogger.info(
            { originalPrompt: prompt, enhancedPrompt },
            'Prompt enhanced successfully'
          );
        } catch (error) {
          const standardizedError = enhanceError(error, {
            operation: 'enhance_image_prompt',
            category: ERROR_CATEGORIES.EXTERNAL_API,
            severity: ERROR_SEVERITY.LOW,
            context: { prompt: prompt.substring(0, 100) },
            userId: message.author?.id,
          });

          logError(standardizedError);
          enhancedPrompt = prompt;
        }
      }

      // Track the API call
      trackApiCall('gptimage');
      if (apiCalls.gptimage) {
        apiCalls.gptimage = (apiCalls.gptimage || 0) + 1;
      }

      // Move to downloading phase
      updateProgress('downloading');

      // Generate the image
      discordLogger.info(
        {
          prompt: enhancedPrompt,
          model,
          size,
          username,
          enhance,
        },
        'Starting image generation'
      );

      const imageResult = await generateImage(enhancedPrompt, {
        model,
        size,
        username,
        rateLimitInfo: rateLimitResult,
      });

      // Move to uploading phase
      updateProgress('uploading');

      // Stop the progress updater before final message
      clearInterval(progressUpdater);

      // Calculate final timing
      updateProgress(); // Update final progress
      const totalElapsed = Date.now() - actualStartTime;

      // Track completion in status manager
      if (statusManager && typeof statusManager.trackImageComplete === 'function') {
        statusManager.trackImageComplete(
          message.author?.username || username || 'Unknown',
          totalElapsed
        );
      }

      // Prepare the response with the image
      const imageResult_firstImage =
        imageResult.images && imageResult.images[0] ? imageResult.images[0] : imageResult;
      const imageUrl = imageResult_firstImage.url;
      const revisedPrompt =
        imageResult_firstImage.revisedPrompt || imageResult.revised_prompt || enhancedPrompt;

      // Create subtext with performance information
      const subtext = formatSubtext(actualStartTime, usage, apiCalls);

      let finalMessage = `🎨 **Image Generated Successfully!**\n\n`;
      finalMessage += `**Original Prompt:** ${prompt}\n`;
      if (enhance && revisedPrompt !== prompt) {
        finalMessage += `**Enhanced Prompt:** ${revisedPrompt}\n`;
      }
      finalMessage += `**Model:** ${model} | **Size:** ${size}\n`;
      finalMessage += `**Generation Time:** ${formatElapsed(totalElapsed)}\n\n`;
      finalMessage += subtext;

      // Check if we have base64 data to send as attachment
      if (imageResult_firstImage.b64_json) {
        // Process image data using streaming for better memory efficiency
        const useStreaming = shouldUseStreaming(imageResult_firstImage.b64_json);

        discordLogger.debug(
          {
            base64Length: imageResult_firstImage.b64_json.length,
            useStreaming,
            estimatedSize: Math.round((imageResult_firstImage.b64_json.length * 3) / 4 / 1024),
          },
          'Processing image data for Discord attachment'
        );

        let processedImage;
        if (useStreaming) {
          // Use streaming processing for large images
          processedImage = await processImageStream(imageResult_firstImage.b64_json, {
            fileName: `generated_image_${Date.now()}`,
            maxSize: 25 * 1024 * 1024, // 25MB limit (Discord is 8MB, but allow headroom)
          });
        } else {
          // Direct processing for small images
          const imageBuffer = Buffer.from(imageResult_firstImage.b64_json, 'base64');
          processedImage = {
            success: true,
            buffer: imageBuffer,
            size: imageBuffer.length,
            method: 'direct',
            exceedsDiscordLimit: imageBuffer.length > 8 * 1024 * 1024,
          };
        }

        if (!processedImage.success) {
          const processingError = new ChimpError('Failed to process image data', {
            category: ERROR_CATEGORIES.INTERNAL,
            severity: ERROR_SEVERITY.MEDIUM,
            operation: 'process_image_stream',
            context: {
              error: processedImage.error,
              useStreaming,
              estimatedSize: Math.round((imageResult_firstImage.b64_json.length * 3) / 4 / 1024),
            },
            userId: message.author?.id,
          });

          logError(processingError);
          await feedbackMessage.edit(
            finalMessage + '\n⚠️ Image generated but failed to process for Discord.'
          );
          return;
        }

        // Check Discord file size limit
        if (processedImage.exceedsDiscordLimit) {
          const sizeError = new ChimpError('Generated image exceeds Discord file size limit', {
            category: ERROR_CATEGORIES.VALIDATION,
            severity: ERROR_SEVERITY.MEDIUM,
            operation: 'validate_discord_file_size',
            context: {
              imageSize: processedImage.size,
              discordLimit: 8 * 1024 * 1024,
              sizeMB: (processedImage.size / 1024 / 1024).toFixed(2),
            },
            userId: message.author?.id,
          });

          logError(sizeError);

          await feedbackMessage.edit(
            finalMessage +
              '\n⚠️ Image generated but is too large for Discord (>8MB). Try requesting a smaller size or lower quality.'
          );
          return;
        }

        const fileExtension = model === 'gpt-image-1' ? 'png' : 'png'; // Default to PNG
        const fileName = `generated_image_${Date.now()}.${fileExtension}`;

        // Create Discord attachment from processed image
        const attachment = createDiscordAttachment(processedImage, fileName);

        // Log processing results
        discordLogger.info(
          {
            processingMethod: processedImage.method,
            imageSize: processedImage.size,
            sizeMB: (processedImage.size / 1024 / 1024).toFixed(2),
            processingTime: processedImage.processingTime,
          },
          'Image processed successfully for Discord'
        );

        // Update the message with the final result and attachment
        await feedbackMessage.edit({
          content: finalMessage,
          files: [attachment],
        });
      } else if (imageUrl && !imageUrl.startsWith('data:')) {
        // Regular URL - include it in the message
        finalMessage += `${imageUrl}`;
        await feedbackMessage.edit(finalMessage);
      } else {
        // If we still have a data URL but no b64_json, extract the base64 part
        if (imageUrl && imageUrl.startsWith('data:')) {
          const base64Match = imageUrl.match(/data:([^;]+);base64,(.+)/);
          if (base64Match) {
            const mimeType = base64Match[1];
            const base64Data = base64Match[2];

            // Process image data using streaming for better memory efficiency
            const useStreaming = shouldUseStreaming(base64Data);

            discordLogger.debug(
              {
                mimeType,
                base64Length: base64Data.length,
                useStreaming,
                estimatedSize: Math.round((base64Data.length * 3) / 4 / 1024),
              },
              'Processing data URL image for Discord attachment'
            );

            let processedImage;
            if (useStreaming) {
              // Use streaming processing for large images
              processedImage = await processImageStream(base64Data, {
                fileName: `generated_image_${Date.now()}`,
                maxSize: 25 * 1024 * 1024, // 25MB limit
              });
            } else {
              // Direct processing for small images
              const imageBuffer = Buffer.from(base64Data, 'base64');
              processedImage = {
                success: true,
                buffer: imageBuffer,
                size: imageBuffer.length,
                method: 'direct',
                exceedsDiscordLimit: imageBuffer.length > 8 * 1024 * 1024,
              };
            }

            if (!processedImage.success) {
              const processingError = new ChimpError('Failed to process data URL image', {
                category: ERROR_CATEGORIES.INTERNAL,
                severity: ERROR_SEVERITY.MEDIUM,
                operation: 'process_data_url_image',
                context: {
                  error: processedImage.error,
                  mimeType,
                  useStreaming,
                  estimatedSize: Math.round((base64Data.length * 3) / 4 / 1024),
                },
                userId: message.author?.id,
              });

              logError(processingError);
              await feedbackMessage.edit(
                finalMessage + '\n⚠️ Image generated but failed to process for Discord.'
              );
              return;
            }

            // Check Discord file size limit
            if (processedImage.exceedsDiscordLimit) {
              const sizeError = new ChimpError('Data URL image exceeds Discord file size limit', {
                category: ERROR_CATEGORIES.VALIDATION,
                severity: ERROR_SEVERITY.MEDIUM,
                operation: 'validate_data_url_file_size',
                context: {
                  imageSize: processedImage.size,
                  discordLimit: 8 * 1024 * 1024,
                  sizeMB: (processedImage.size / 1024 / 1024).toFixed(2),
                  mimeType,
                },
                userId: message.author?.id,
              });

              logError(sizeError);

              await feedbackMessage.edit(
                finalMessage +
                  '\n⚠️ Image generated but is too large for Discord (>8MB). Try requesting a smaller size or lower quality.'
              );
              return;
            }

            // Determine file extension from MIME type
            let fileExtension = 'png';
            if (mimeType.includes('jpeg')) fileExtension = 'jpg';
            else if (mimeType.includes('webp')) fileExtension = 'webp';

            const fileName = `generated_image_${Date.now()}.${fileExtension}`;

            // Create Discord attachment from processed image
            const attachment = createDiscordAttachment(processedImage, fileName, mimeType);

            // Log processing results
            discordLogger.info(
              {
                processingMethod: processedImage.method,
                imageSize: processedImage.size,
                sizeMB: (processedImage.size / 1024 / 1024).toFixed(2),
                processingTime: processedImage.processingTime,
              },
              'Data URL image processed successfully for Discord'
            );

            await feedbackMessage.edit({
              content: finalMessage,
              files: [attachment],
            });
          } else {
            // Fallback if we can't parse the data URL
            await feedbackMessage.edit(
              finalMessage + '\n⚠️ Image generated but could not be displayed properly.'
            );
          }
        } else {
          // No image URL available
          await feedbackMessage.edit(finalMessage + '\n⚠️ Image generated but no URL available.');
        }
      }

      // Store message relationship for context preservation
      if (storeMessageRelationship && message.originalMessage) {
        const contextContent = `Generated image: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`;
        storeMessageRelationship(message.originalMessage, feedbackMessage, 'image', contextContent);
      }

      discordLogger.info(
        {
          prompt: enhancedPrompt,
          model,
          size,
          username,
          totalElapsed,
          imageUrl,
        },
        'Image generation completed successfully'
      );
    } catch (error) {
      // Stop the progress updater on error
      clearInterval(progressUpdater);

      // Standardize error handling based on error type
      let standardizedError;
      if (error.message?.includes('openai') || error.status) {
        standardizedError = handleOpenAIError(error, {
          prompt: parameters.prompt?.substring(0, 100),
          model: parameters.model,
          size: parameters.size,
          userId: message.author?.id,
        });
      } else {
        standardizedError = enhanceError(error, {
          operation: 'image_generation',
          category: ERROR_CATEGORIES.EXTERNAL_API,
          severity: ERROR_SEVERITY.HIGH,
          context: {
            prompt: parameters.prompt?.substring(0, 100),
            model: parameters.model,
            size: parameters.size,
          },
          userId: message.author?.id,
        });
      }

      logError(standardizedError);

      let errorMessage = '❌ **Image Generation Failed**\n\n';

      if (error.message?.includes('content_policy_violation')) {
        errorMessage +=
          "🚫 Your request violates OpenAI's content policy. Please try a different prompt.";
      } else if (error.message?.includes('rate_limit')) {
        errorMessage += '⏱️ Rate limit exceeded. Please wait a moment and try again.';
      } else if (error.message?.includes('insufficient_quota')) {
        errorMessage += '💳 Insufficient API quota. Please check your OpenAI billing.';
      } else {
        errorMessage +=
          '⚠️ An unexpected error occurred during image generation. Please try again.';
      }

      const subtext = formatSubtext(actualStartTime, usage, apiCalls);
      errorMessage += subtext;

      try {
        await feedbackMessage.edit(errorMessage);
      } catch (editError) {
        const discordError = handleDiscordError(editError, {
          operation: 'edit_error_message',
          messageContent: errorMessage.substring(0, 100),
          userId: message.author?.id,
        });

        logError(discordError);
      }
    }
  } catch (error) {
    // Track OpenAI API error
    trackError('gptimage');

    // Standardize outer error handling
    const standardizedError = enhanceError(error, {
      operation: 'handle_image_generation',
      category: ERROR_CATEGORIES.INTERNAL,
      severity: ERROR_SEVERITY.HIGH,
      context: {
        prompt: parameters.prompt?.substring(0, 100),
        model: parameters.model,
        size: parameters.size,
      },
      userId: message.author?.id,
    });

    logError(standardizedError);

    let errorMessage = '❌ **Image Generation Failed**\n\n';

    if (error.message?.includes('content_policy_violation')) {
      errorMessage +=
        "🚫 Your request violates OpenAI's content policy. Please try a different prompt.";
    } else if (error.message?.includes('rate_limit')) {
      errorMessage += '⏱️ Rate limit exceeded. Please wait a moment and try again.';
    } else if (error.message?.includes('insufficient_quota')) {
      errorMessage += '💳 Insufficient API quota. Please check your OpenAI billing.';
    } else {
      errorMessage += '⚠️ An unexpected error occurred during image generation. Please try again.';
    }

    const subtext = formatSubtext(startTime, usage, apiCalls);
    errorMessage += subtext;

    try {
      await message.edit(errorMessage);
    } catch (editError) {
      const discordError = handleDiscordError(editError, {
        operation: 'edit_final_error_message',
        messageContent: errorMessage.substring(0, 100),
        userId: message.author?.id,
      });

      logError(discordError);
    }
  }
}

module.exports = {
  handleImageGeneration,
};
