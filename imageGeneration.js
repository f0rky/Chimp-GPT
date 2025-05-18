/**
 * @typedef {Object} ImageGenerationOptions
 * @property {string} [model] - The model to use (gpt-image-1)
 * @property {string} [size] - Image size (1024x1024, 1792x1024, or 1024x1792)
 * @property {string} [quality] - Image quality (low, medium, high, auto)
 * @property {string} [format] - Output format (png, jpeg, webp)
 * @property {string} [background] - Background type (opaque, transparent, auto)
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

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  // GPT Image-1 supported sizes (based on API error message)
  SQUARE: '1024x1024', // Square - GPT Image-1
  LANDSCAPE: '1792x1024', // Landscape - GPT Image-1
  PORTRAIT: '1024x1792', // Portrait - GPT Image-1
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
  DEFAULT: 'opaque',
  TRANSPARENT: 'transparent',
  AUTO: 'auto',
};

/**
 * Generate an image using GPT Image-1.
 *
 * Standardized error handling: always returns either an ImageResult or ImageErrorResult.
 * Errors are always logged with stack trace and context.
 *
 * @param {string} prompt - The text prompt to generate an image from
 * @param {ImageGenerationOptions} [options={}] - Generation options
 * @returns {Promise<ImageResult|ImageErrorResult>} The generated image result object
 */
async function generateImage(prompt, options = {}) {
  try {
    // Default to GPT Image-1 with medium size for cost effectiveness
    const model = options.model || MODELS.GPT_IMAGE_1;
    // Set default size to square if not specified
    let size = options.size || SIZES.SQUARE;

    logger.info(
      {
        prompt,
        model,
        size,
      },
      'Generating image with GPT Image-1'
    );

    // Validate the model and size combination
    // Validate that we're using a supported size
    if (![SIZES.SQUARE, SIZES.LANDSCAPE, SIZES.PORTRAIT].includes(size)) {
      logger.warn(`GPT Image-1 does not support ${size} size, falling back to square`);
      size = SIZES.SQUARE;
    }

    // Set default quality to auto if not specified
    const quality = options.quality || QUALITY.AUTO;

    // Set default format to png if not specified
    const format = options.format || FORMAT.PNG;

    // Set default background to opaque if not specified
    const background = options.background || BACKGROUND.DEFAULT;

    // Build the image parameters object according to OpenAI's API
    const imageParams = {
      model: MODELS.GPT_IMAGE_1,
      prompt,
      size,
      quality,
      output_format: format,
    };

    // Only add background parameter if it's not the default
    if (background !== BACKGROUND.DEFAULT) {
      imageParams.background = background;
    }

    // Add compression parameter if format is jpeg or webp and compression is specified
    if ((format === FORMAT.JPEG || format === FORMAT.WEBP) && options.compression !== undefined) {
      // Ensure compression is between 0 and 100
      const compression = Math.max(0, Math.min(100, options.compression));
      imageParams.output_compression = compression;
    }

    logger.info({ imageParams }, 'Generating image with GPT Image-1');
    const response = await openai.images.generate(imageParams);

    // Track the API call
    trackApiCall('gptimage');

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

    // Calculate approximate cost based on size
    let estimatedCost = 0;
    // Approximate costs for GPT Image-1 (these are estimates and may need adjustment)
    if (size === SIZES.SQUARE) estimatedCost = 0.01;
    else if (size === SIZES.LANDSCAPE || size === SIZES.PORTRAIT) estimatedCost = 0.015;

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
          } else {
            // Fallback for unexpected response format
            logger.warn({ img }, 'Unexpected image data format in response');
            return {
              url: null,
              revisedPrompt: prompt,
            };
          }
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

    return {
      success: true,
      images: images,
      estimatedCost: estimatedCost,
    };
  } catch (error) {
    logger.error({ error, prompt }, 'Error generating image with GPT Image-1');
    trackError('gptimage');

    // Store the error result in the function results storage
    const errorResult = {
      success: false,
      error: error.message,
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
            'Do not include any text that would violate content policies (no violence, adult content, etc.).',
        },
        {
          role: 'user',
          content: `Please enhance this basic image prompt for GPT Image-1: "${basicPrompt}"`,
        },
      ],
      max_tokens: 300,
    });

    const enhancedPrompt = response.choices[0].message.content.trim();

    // Track the API call
    trackApiCall('openai');

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
