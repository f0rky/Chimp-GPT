const { discord: discordLogger } = require('../core/logger');
const { generateImage, enhanceImagePrompt } = require('../services/imageGeneration');
const {
  checkImageGenerationRateLimit,
  constants: { IMAGE_GEN_POINTS },
} = require('../middleware/rateLimiter');
const { trackApiCall, trackError, handleStatsCommand } = require('../core/healthCheck');

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
        // Silently ignore update errors to avoid spamming logs
        discordLogger.debug({ error: updateError }, 'Error updating progress message');
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
        await feedbackMessage.delete().catch(() => {
          /* Ignore deletion errors */
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
        } catch (enhanceError) {
          discordLogger.warn(
            { error: enhanceError, prompt },
            'Failed to enhance prompt, using original'
          );
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

      const imageResult = await generateImage({
        prompt: enhancedPrompt,
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
      const imageUrl = imageResult.url;
      const revisedPrompt = imageResult.revised_prompt || enhancedPrompt;

      // Create subtext with performance information
      const subtext = formatSubtext(actualStartTime, usage, apiCalls);

      let finalMessage = `🎨 **Image Generated Successfully!**\n\n`;
      finalMessage += `**Original Prompt:** ${prompt}\n`;
      if (enhance && revisedPrompt !== prompt) {
        finalMessage += `**Enhanced Prompt:** ${revisedPrompt}\n`;
      }
      finalMessage += `**Model:** ${model} | **Size:** ${size}\n`;
      finalMessage += `**Generation Time:** ${formatElapsed(totalElapsed)}\n\n`;
      finalMessage += `${imageUrl}`;
      finalMessage += subtext;

      // Update the message with the final result
      await feedbackMessage.edit(finalMessage);

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

      discordLogger.error(
        {
          error,
          prompt: parameters.prompt,
          model: parameters.model,
          size: parameters.size,
        },
        'Error during image generation'
      );

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
        discordLogger.error(
          { error: editError },
          'Error editing message after image generation failure'
        );
      }
    }
  } catch (error) {
    // Track OpenAI API error
    trackError('gptimage');

    discordLogger.error(
      {
        error,
        prompt: parameters.prompt,
        model: parameters.model,
        size: parameters.size,
      },
      'Error during image generation'
    );

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
      discordLogger.error(
        { error: editError },
        'Error editing message after image generation failure'
      );
    }
  }
}

module.exports = {
  handleImageGeneration,
};
