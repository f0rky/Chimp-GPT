/**
 * Image Generation Module for ChimpGPT
 * 
 * This module provides image generation capabilities using OpenAI's DALL-E model.
 * It allows the bot to generate images based on text prompts and send them to Discord.
 * 
 * @module ImageGeneration
 * @author Brett
 * @version 1.0.0
 */

const { OpenAI } = require('openai');
const { createLogger } = require('./logger');
const logger = createLogger('image');
const { trackApiCall, trackError } = require('./healthCheck');
const functionResults = require('./functionResults');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Available image generation models
 * @enum {string}
 */
const MODELS = {
  DALLE_2: 'dall-e-2',
  DALLE_3: 'dall-e-3'
};

/**
 * Available image sizes
 * @enum {string}
 */
const SIZES = {
  SMALL: '256x256',      // DALL-E 2 only
  MEDIUM: '512x512',     // DALL-E 2 only
  LARGE: '1024x1024',    // Both models
  WIDE: '1792x1024',     // DALL-E 3 only
  TALL: '1024x1792'      // DALL-E 3 only
};

/**
 * Available image quality levels
 * @enum {string}
 */
const QUALITY = {
  STANDARD: 'standard',
  HD: 'hd'  // DALL-E 3 only
};

/**
 * Generate an image using DALL-E
 * 
 * @param {string} prompt - The text prompt to generate an image from
 * @param {Object} options - Generation options
 * @param {string} [options.model=MODELS.DALLE_3] - The model to use (dall-e-2 or dall-e-3)
 * @param {string} [options.size=SIZES.LARGE] - Image size
 * @param {string} [options.quality=QUALITY.STANDARD] - Image quality
 * @param {number} [options.n=1] - Number of images to generate (DALL-E 2 only)
 * @returns {Promise<Object>} The generated image data
 */
async function generateImage(prompt, options = {}) {
  try {
    // Default to DALL-E 3 with standard quality and large size
    const model = options.model || MODELS.DALLE_3;
    const size = options.size || SIZES.LARGE;
    const quality = options.quality || QUALITY.STANDARD;
    const n = model === MODELS.DALLE_2 ? (options.n || 1) : 1; // DALL-E 3 only supports n=1
    
    logger.info({
      prompt,
      model,
      size,
      quality,
      n
    }, 'Generating image with DALL-E');
    
    // Validate the model and size combination
    if (model === MODELS.DALLE_2 && (size === SIZES.WIDE || size === SIZES.TALL)) {
      logger.warn('DALL-E 2 does not support wide or tall sizes, falling back to large');
      size = SIZES.LARGE;
    }
    
    // Validate the model and quality combination
    if (model === MODELS.DALLE_2 && quality === QUALITY.HD) {
      logger.warn('DALL-E 2 does not support HD quality, falling back to standard');
      quality = QUALITY.STANDARD;
    }
    
    // Generate the image
    const response = await openai.images.generate({
      model,
      prompt,
      n,
      size,
      quality,
      response_format: 'url'
    });
    
    // Track the API call
    trackApiCall('dalle');
    
    logger.info({
      imageCount: response.data.length
    }, 'Successfully generated images');
    
    // Store the function result for the status page
    const result = {
      success: true,
      images: response.data.map(img => ({
        url: img.url,
        revisedPrompt: img.revised_prompt || prompt
      }))
    };
    
    // Store the result in the function results storage
    functionResults.storeResult('dalle', {
      prompt,
      model,
      size,
      quality,
      enhance: options.enhance || false
    }, result);
    
    return {
      success: true,
      images: response.data.map(img => ({
        url: img.url,
        revisedPrompt: img.revised_prompt || prompt
      }))
    };
  } catch (error) {
    logger.error({ error, prompt }, 'Error generating image with DALL-E');
    trackError('dalle');
    
    // Store the error result in the function results storage
    const errorResult = {
      success: false,
      error: error.message,
      prompt
    };
    
    functionResults.storeResult('dalle', {
      prompt,
      model: options.model || MODELS.DALLE_3,
      size: options.size || SIZES.LARGE,
      quality: options.quality || QUALITY.STANDARD,
      enhance: options.enhance || false
    }, errorResult);
    
    return {
      success: false,
      error: error.message,
      prompt
    };
  }
}

/**
 * Generate an improved prompt for image generation
 * 
 * This function uses GPT to enhance a basic prompt with more details
 * to produce better image generation results.
 * 
 * @param {string} basicPrompt - The basic user prompt
 * @returns {Promise<string>} Enhanced prompt for image generation
 */
async function enhanceImagePrompt(basicPrompt) {
  try {
    logger.info({ basicPrompt }, 'Enhancing image prompt');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at creating detailed, vivid prompts for DALL-E image generation. ' +
                   'Your task is to enhance basic prompts with more details about style, lighting, composition, ' +
                   'and other elements that will result in a high-quality, visually appealing image. ' +
                   'Do not include any text that would violate content policies (no violence, adult content, etc.).'
        },
        {
          role: 'user',
          content: `Please enhance this basic image prompt for DALL-E: "${basicPrompt}"`
        }
      ],
      max_tokens: 300
    });
    
    const enhancedPrompt = response.choices[0].message.content.trim();
    
    // Track the API call
    trackApiCall('openai');
    
    logger.info({
      basicPrompt,
      enhancedPrompt
    }, 'Successfully enhanced image prompt');
    
    return enhancedPrompt;
  } catch (error) {
    logger.error({ error, basicPrompt }, 'Error enhancing image prompt');
    trackError('openai');
    
    // Fall back to the original prompt
    return basicPrompt;
  }
}

module.exports = {
  generateImage,
  enhanceImagePrompt,
  MODELS,
  SIZES,
  QUALITY
};
