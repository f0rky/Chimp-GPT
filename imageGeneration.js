/**
 * @typedef {Object} ImageGenerationOptions
 * @property {string} [model] - The model to use (gpt-image-1)
 * @property {string} [size] - Image size (1024x1024, 1536x1024, 1024x1536, or auto)
 * @property {string} [quality] - Image quality (low, medium, high, auto)
 * @property {string} [format] - Output format (png, jpeg, webp)
 * @property {string} [background] - Background type (opaque, transparent)
 * @property {number} [compression] - Compression level (0-100) for jpeg and webp
 * @property {boolean} [enhance] - Whether to enhance the prompt using GPT
 *
 * @typedef {Object} ImageResult
 * @property {true} success
 * @property {Array<{ url: string, revisedPrompt: string }>} images
 *
 * @typedef {Object} ImageErrorResult
 * @property {false} success
 * @property {string} error
 * @property {string} prompt
 *
 * @typedef {Object} EnhancedPromptResult
 * @property {string} enhancedPrompt
 */
/**
 * Image Generation Module for ChimpGPT
 *
 * This module provides image generation capabilities using OpenAI's GPT Image-1 model.
 * It allows the bot to generate images based on text prompts and send them to Discord.
 *
 * @module ImageGeneration
 * @author Brett
 * @version 2.0.0
 */

const { OpenAI } = require('openai');
const { createLogger } = require('./logger');
const logger = createLogger('image');
const { trackApiCall, trackError } = require('./healthCheck');
const functionResults = require('./functionResults');
const config = require('./configValidator');
const retryWithBreaker = require('./utils/retryWithBreaker');
const breakerManager = require('./breakerManager');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Circuit breaker configuration for image generation API calls
const IMAGE_BREAKER_CONFIG = {
  maxRetries: 1, // Only retry once for image generation to avoid long waits
  breakerLimit: 3, // Opens after 3 consecutive failures
  breakerTimeoutMs: 300000, // 5 minutes timeout
  initialBackoffMs: 500, // Start with shorter backoff
  maxBackoffMs: 2000, // Cap backoff at 2 seconds
  onBreakerOpen: error => {
    logger.error({ error }, 'Image generation API circuit breaker opened');
    breakerManager.notifyOwnerBreakerTriggered(
      'Image generation API circuit breaker opened: ' + error.message
    );
  },
};

/**
 * Available image generation models
 * @enum {string}
 */
const MODELS = {
  GPT_IMAGE_1: 'gpt-image-1',
};

/**
 * Available image sizes
 * @enum {string}
 */
const SIZES = {
  // GPT Image-1 supported sizes (based on official API documentation)
  SQUARE: '1024x1024', // Square (default)
  PORTRAIT: '1536x1024', // Portrait orientation
  LANDSCAPE: '1024x1536', // Landscape orientation
  AUTO: 'auto', // Let the API choose the best size
};

/**
 * Available image quality levels
 * @enum {string}
 */
const QUALITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  AUTO: 'auto',
};

/**
 * Available image formats
 * @enum {string}
 */
const FORMAT = {
  PNG: 'png',
  JPEG: 'jpeg',
  WEBP: 'webp',
};

/**
 * Background options
 * @enum {string}
 */
const BACKGROUND = {
  OPAQUE: 'opaque',
  TRANSPARENT: 'transparent',
};

/**
 * Generate an image using GPT Image-1.
 *
 * Standardized error handling: always returns either an ImageResult or ImageErrorResult.
 * Errors are always logged with stack trace and context.
 *
 * @param {string} prompt - The text prompt to generate an image from
 * @param {Object} options - Additional options for image generation
 * @returns {Promise<ImageResult | ImageErrorResult>} The generated image or an error
 */
async function generateImage(prompt, options = {}) {
  // Check if image generation is enabled - get the latest value from process.env
  const isEnabled =
    process.env.ENABLE_IMAGE_GENERATION === 'true' || config.ENABLE_IMAGE_GENERATION === true;

  if (!isEnabled) {
    logger.warn('Image generation is currently disabled');
    return {
      success: false,
      error: 'Image generation is currently disabled',
      prompt,
    };
  }

  // Log that we're proceeding with image generation
  logger.info('Image generation is enabled, proceeding with request');

  // Track timing information if provided
  if (options._timingInfo) {
    const now = Date.now();
    const totalDelay = now - options._timingInfo.requestStartTime;
    logger.info(
      {
        initDuration: options._timingInfo.initDuration,
        totalDelayToApiCall: totalDelay,
        additionalDelay: totalDelay - options._timingInfo.initDuration,
        requestStartTime: options._timingInfo.requestStartTime,
        currentTime: now,
      },
      'Timing information for image generation request'
    );
  }

  logger.debug(
    {
      configValue: config.ENABLE_IMAGE_GENERATION,
      envValue: process.env.ENABLE_IMAGE_GENERATION,
      isEnabled,
    },
    'Image generation configuration check'
  );
  try {
    // Default to GPT Image-1 model
    const model = options.model || MODELS.GPT_IMAGE_1;
    // Set default size to auto if not specified (let API choose optimal size)
    let size = options.size || SIZES.AUTO;

    // We'll log all parameters together after building the full imageParams object

    // Validate the model and size combination
    // Validate that we're using a supported size
    const validSizes = [SIZES.SQUARE, SIZES.PORTRAIT, SIZES.LANDSCAPE, SIZES.AUTO];
    if (!validSizes.includes(size)) {
      logger.warn(`GPT Image-1 does not support ${size} size, falling back to auto`);
      size = SIZES.AUTO;
    }

    // Set default quality to auto if not specified
    const quality = options.quality || QUALITY.AUTO;

    // Set default format to png if not specified
    const format = options.format || FORMAT.PNG;

    // Set default background to opaque if not specified
    const background = options.background || BACKGROUND.OPAQUE;

    // Build the image parameters object according to OpenAI's API
    const imageParams = {
      model: MODELS.GPT_IMAGE_1,
      prompt,
      size,
      quality,
      output_format: format,
    };

    // Only add background parameter if it's transparent (opaque is default)
    if (background === BACKGROUND.TRANSPARENT) {
      imageParams.background = background;
    }

    // Add compression parameter if format is jpeg or webp and compression is specified
    if ((format === FORMAT.JPEG || format === FORMAT.WEBP) && options.compression !== undefined) {
      // Ensure compression is between 0 and 100
      const compression = Math.max(0, Math.min(100, options.compression));
      imageParams.output_compression = compression;
    }

    logger.info({ imageParams }, 'Generating image with GPT Image-1');

    // Pre-check for potentially problematic content with quick client-side check
    // This helps provide immediate feedback for obvious cases
    const problematicPatterns = [
      /\bbikini\b/i,
      /\bswimsuit\b/i,
      /\bunderwear\b/i,
      /\blingerie\b/i,
      /\bnude\b/i,
      /\bnaked\b/i,
      /\bnsfw\b/i,
      /\bprovocative\b/i,
      /\bseductive\b/i,
      /\bsensual\b/i,
      /\bintimate\b/i,
      /\berotic\b/i
    ];
    
    const containsProblematicContent = problematicPatterns.some(pattern => 
      pattern.test(prompt)
    );
    
    if (containsProblematicContent) {
      logger.info({ prompt }, 'Pre-moderation: Potentially problematic content detected');
      trackError('gptimage', new Error('Pre-moderation block'));
      
      // Return immediately without calling OpenAI
      return {
        success: false,
        error: 'This request may contain content that violates our content policy. Please try a different prompt that doesn\'t include references to swimwear, nudity, or suggestive content.',
        isContentPolicyViolation: true,
        prompt,
      };
    }

    let response;
    const apiCallStartTime = Date.now();
    let apiCallDuration;

    try {
      // Log that we're about to make the API call
      logger.debug('Making OpenAI API call for image generation with circuit breaker protection');

      // Make the API call with circuit breaker protection and timeout
      response = await retryWithBreaker(async () => {
        const callStart = Date.now();
        
        // Create a timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('Image generation request timed out after 30 seconds'));
          }, 30000); // 30 second timeout
        });
        
        // Race between the API call and timeout
        const result = await Promise.race([
          openai.images.generate(imageParams),
          timeoutPromise
        ]);
        
        apiCallDuration = Date.now() - callStart;
        logger.info({ apiCallDuration }, 'OpenAI image generation API call completed');
        return result;
      }, IMAGE_BREAKER_CONFIG);

      // Track the successful API call
      trackApiCall('gptimage');
    } catch (error) {
      // Check for content policy violation
      if (error.status === 400 && 
          (error.code === 'moderation_blocked' || 
           error.message?.includes('safety system') ||
           error.message?.includes('content policy'))) {
        logger.warn({ prompt, error: error.message }, 'Image generation blocked by content policy');
        trackError('gptimage', error);
        
        // Return a specific error result for content policy violations
        return {
          success: false,
          error: 'This image request was blocked by the safety system. Please try a different prompt.',
          isContentPolicyViolation: true,
          prompt,
        };
      }

      // Check for circuit breaker open state
      if (error.message.includes('Circuit breaker is open')) {
        logger.warn({ prompt }, 'Image generation failed due to circuit breaker');
        return {
          success: false,
          error:
            'Image generation service is temporarily unavailable. Please try again in a few minutes.',
          isCircuitBreakerOpen: true,
          prompt,
        };
      }

      // For other errors, re-throw to be handled by the outer try-catch
      throw error;
    }

    // Log the response structure to understand the format
    logger.debug(
      {
        responseStructure: JSON.stringify(response),
      },
      'GPT Image-1 response structure'
    );

    logger.info(
      {
        imageCount: response.data.length,
      },
      'Successfully generated images'
    );

    // Calculate more accurate cost based on GPT Image-1 pricing
    // https://openai.com/pricing
    let estimatedCost = 0;

    // Base cost by size (in dollars) - GPT Image-1 pricing
    const baseCostBySize = {
      '1024x1024': 0.008, // Square
      '1536x1024': 0.012, // Portrait
      '1024x1536': 0.012, // Landscape
      auto: 0.01, // Auto (average estimate)
    };

    // Get the base cost for the selected size
    const baseCost = baseCostBySize[size] || 0.008; // Default to square if size not found

    // Factor in prompt length (longer prompts may require more processing)
    // This is an approximation since OpenAI doesn't specify exact pricing by token for images
    const promptLength = prompt.length;
    const promptFactor = Math.min(1.5, Math.max(1.0, 1.0 + promptLength / 1000)); // 1.0-1.5x based on length

    // Quality factor (higher quality costs more)
    const qualityFactor =
      {
        [QUALITY.LOW]: 0.8,
        [QUALITY.MEDIUM]: 1.0,
        [QUALITY.HIGH]: 1.5,
        [QUALITY.AUTO]: 1.0,
      }[quality] || 1.0;

    // Calculate final estimated cost
    estimatedCost = baseCost * promptFactor * qualityFactor;

    // Log the cost calculation factors
    logger.debug(
      {
        baseCost,
        promptLength,
        promptFactor,
        qualityFactor,
        finalCost: estimatedCost,
      },
      'Cost estimation factors for GPT Image-1'
    );

    // Extract the image URLs based on the response structure
    // GPT Image-1 may have a different structure than DALL-E
    let images = [];

    try {
      // Log the full response to understand its structure
      logger.debug({ fullResponse: JSON.stringify(response) }, 'Full GPT Image-1 response');

      // According to OpenAI's documentation, the response should have a data array
      // Each item in the array can have either a url or b64_json property
      if (response && response.data) {
        // Handle the standard OpenAI v4 SDK response format
        const dataArray = Array.isArray(response.data)
          ? response.data
          : response.data.data && Array.isArray(response.data.data)
            ? response.data.data
            : [response.data];

        images = dataArray.map(img => {
          // For image formats that support base64 encoding
          if (img.b64_json) {
            // Create a data URL with the appropriate MIME type
            const mimeType =
              format === FORMAT.JPEG
                ? 'image/jpeg'
                : format === FORMAT.WEBP
                  ? 'image/webp'
                  : 'image/png';
            return {
              url: `data:${mimeType};base64,${img.b64_json}`,
              revisedPrompt: img.revised_prompt || prompt,
              // Store the raw base64 data for direct file saving if needed
              b64_json: img.b64_json,
            };
          } else if (img.url) {
            // For URL responses
            return {
              url: img.url,
              revisedPrompt: img.revised_prompt || prompt,
            };
          }
          // Fallback for unexpected response format
          logger.warn({ img }, 'Unexpected image data format in response');
          return {
            url: null,
            revisedPrompt: prompt,
          };
        });
      }

      // Ensure we have at least one image with a valid URL
      if (images.length === 0 || !images.some(img => img.url)) {
        // If we couldn't extract a URL, try to find any URL-like string in the response
        const responseStr = JSON.stringify(response);
        const urlMatch = responseStr.match(/https?:\/\/[^"'\s]+/g);
        if (urlMatch && urlMatch.length > 0) {
          images = [
            {
              url: urlMatch[0],
              revisedPrompt: prompt,
            },
          ];
          logger.info({ extractedUrl: urlMatch[0] }, 'Extracted URL from response string');
        } else {
          throw new Error('No valid image URL found in the response');
        }
      }

      // Log the extracted URLs
      logger.debug(
        {
          extractedUrls: images.map(img => (img.url ? 'URL present' : 'URL missing')),
        },
        'Extracted image URLs'
      );
    } catch (error) {
      logger.error({ error, response }, 'Error extracting image URLs');
      throw new Error('Failed to extract image URL from response');
    }

    // Store the function result for the status page
    const result = {
      success: true,
      images: images,
      estimatedCost: estimatedCost,
    };

    // Store the result in the function results storage
    functionResults.storeResult(
      'gptimage',
      {
        prompt,
        model,
        size,
        enhance: options.enhance || false,
      },
      result
    );

    // Return the successful result with API call timing information
    return {
      success: true,
      images,
      prompt,
      revisedPrompt: images[0].revisedPrompt,
      estimatedCost,
      apiCallDuration: apiCallDuration || null, // Time in ms for the API call
      totalProcessingTime: Date.now() - apiCallStartTime, // Total time including processing
    };
  } catch (error) {
    logger.error({ error, prompt }, 'Error generating image with GPT Image-1');
    trackError('gptimage');

    // Check if this is a content policy violation that wasn't caught earlier
    const isContentPolicyViolation = error.status === 400 && error.code === 'moderation_blocked';

    // Store the error result in the function results storage
    const errorResult = {
      success: false,
      error: isContentPolicyViolation
        ? 'This request was rejected due to content policy violations. Please modify your prompt and try again.'
        : error.message,
      isContentPolicyViolation,
      prompt,
    };

    functionResults.storeResult(
      'gptimage',
      {
        prompt,
        model: options.model || MODELS.GPT_IMAGE_1,
        size: options.size || SIZES.SQUARE,
        enhance: options.enhance || false,
      },
      errorResult
    );

    return {
      success: false,
      error: error.message,
      prompt,
    };
  }
}

/**
 * Generate an improved prompt for image generation.
 *
 * This function uses GPT to enhance a basic prompt with more details to produce better image generation results.
 *
 * @param {string} basicPrompt - The basic user prompt
 * @returns {Promise<string>} Enhanced prompt for image generation
 */
async function enhanceImagePrompt(basicPrompt) {
  try {
    // Validate input prompt
    if (!basicPrompt || basicPrompt.trim().length === 0) {
      logger.warn('Empty prompt provided to enhanceImagePrompt, cannot enhance');
      return 'A generic image'; // Provide a safe fallback
    }

    logger.info({ basicPrompt }, 'Enhancing image prompt');

    const response = await openai.chat.completions.create({
      model: 'o4-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert at creating detailed, vivid prompts for GPT Image-1 image generation. ' +
            'Your task is to enhance basic prompts with more details about style, lighting, composition, ' +
            'and other elements that will result in a high-quality, visually appealing image. ' +
            'Do not include any text that would violate content policies (no violence, adult content, etc.). ' +
            'Keep the enhanced prompt concise but descriptive, ideally under 1000 characters.',
        },
        {
          role: 'user',
          content: `Please enhance this basic image prompt for GPT Image-1: "${basicPrompt}"`,
        },
      ],
      max_completion_tokens: 300,
    });

    const enhancedPrompt = response.choices[0].message.content.trim();

    // Track the API call
    trackApiCall('openai');

    // Validate that the enhanced prompt is not empty
    if (!enhancedPrompt || enhancedPrompt.trim().length === 0) {
      logger.warn(
        { basicPrompt },
        'OpenAI returned empty enhanced prompt, falling back to original'
      );
      return basicPrompt;
    }

    logger.info(
      {
        basicPrompt,
        enhancedPrompt,
      },
      'Successfully enhanced image prompt'
    );

    return enhancedPrompt;
  } catch (error) {
    logger.error({ error, basicPrompt }, 'Error enhancing image prompt');
    trackError('openai');

    // Fall back to the original prompt
    return basicPrompt;
  }
}

// Export as a single object to avoid circular dependency issues
const imageGenerationModule = {
  generateImage,
  enhanceImagePrompt,
  MODELS,
  SIZES,
  QUALITY,
  FORMAT,
  BACKGROUND,
};

module.exports = imageGenerationModule;
