/**
 * PocketFlow Function Call Processor
 *
 * This module provides a simplified function call processor interface
 * that's compatible with PocketFlow's architecture. It maps PocketFlow
 * function calls to the existing service implementations.
 *
 * @module PocketFlowFunctionProcessor
 * @author Claude/Brett
 * @version 1.0.0
 */

const { createLogger } = require('../logger');
const logger = createLogger('PocketFlowFunctionProcessor');

// Import service modules
const lookupTime = require('../../services/timeLookup');
const { lookupWeather, lookupExtendedForecast } = require('../../services/weatherLookup');
const lookupWolfram = require('../../services/wolframLookup');
// Note: Using direct OpenAI API call instead of legacy handler for PocketFlow compatibility
const { handleQuakeStats } = require('../../handlers/quakeStatsHandler');

/**
 * PocketFlow Function Call Processor
 * Provides a simplified interface for PocketFlow to execute functions
 */
class PocketFlowFunctionProcessor {
  constructor(pfpManager = null) {
    this.pfpManager = pfpManager;
    this.supportedFunctions = [
      'lookupTime',
      'lookupWeather',
      'lookupExtendedForecast',
      'getWolframShortAnswer',
      'quakeLookup',
      'generateImage',
      'getVersion',
    ];
  }

  /**
   * Process a function call from PocketFlow
   * @param {Object} params - Function call parameters
   * @param {string} params.functionName - Name of the function to call
   * @param {Object} params.functionArgs - Arguments for the function
   * @param {Object} params.message - Discord message object
   * @param {Object} params.store - PocketFlow conversation store
   * @returns {Promise<Object>} Function execution result
   */
  async processFunction({ functionName, functionArgs, message, store: _store }) {
    try {
      logger.debug(`Processing function call: ${functionName}`, { functionArgs });

      if (!this.supportedFunctions.includes(functionName)) {
        return {
          success: false,
          error: `Unsupported function: ${functionName}`,
          functionName,
        };
      }

      let result;

      switch (functionName) {
        case 'lookupTime':
          result = await this.handleTimeLookup(functionArgs);
          break;

        case 'lookupWeather':
          result = await this.handleWeatherLookup(functionArgs);
          break;

        case 'lookupExtendedForecast':
          result = await this.handleExtendedForecast(functionArgs);
          break;

        case 'getWolframShortAnswer':
          result = await this.handleWolframLookup(functionArgs);
          break;

        case 'quakeLookup':
          result = await this.handleQuakeLookup(functionArgs, message);
          break;

        case 'generateImage':
          // Image generation is now handled directly by SimpleChimpGPTFlow
          return {
            success: false,
            error: 'Image generation is handled by SimpleChimpGPTFlow, not function calls',
            functionName,
          };

        case 'getVersion':
          result = await this.handleVersionLookup(functionArgs);
          break;

        default:
          return {
            success: false,
            error: `Function ${functionName} not implemented`,
            functionName,
          };
      }

      return {
        success: true,
        functionName,
        result,
        data: result, // Provide both for compatibility
      };
    } catch (error) {
      logger.error(`Error processing function ${functionName}:`, error);
      return {
        success: false,
        error: error.message,
        functionName,
      };
    }
  }

  /**
   * Handle time lookup
   */
  async handleTimeLookup(args) {
    const { location } = args;
    if (!location) {
      throw new Error('Location parameter is required for time lookup');
    }

    const result = await lookupTime(location);
    return {
      location,
      time: result,
      formatted: `Current time in ${location}: ${result}`,
    };
  }

  /**
   * Handle weather lookup
   */
  async handleWeatherLookup(args) {
    const { location } = args;
    if (!location) {
      throw new Error('Location parameter is required for weather lookup');
    }

    const weatherData = await lookupWeather(location);

    if (weatherData && weatherData.current && weatherData.location) {
      return {
        location: weatherData.location.name,
        temperature: `${weatherData.current.temp_c}°C`,
        condition: weatherData.current.condition.text,
        humidity: `${weatherData.current.humidity}%`,
        windSpeed: `${weatherData.current.wind_kph} km/h`,
        formatted: `Current weather in ${weatherData.location.name}: ${weatherData.current.condition.text}, ${weatherData.current.temp_c}°C`,
        raw: weatherData,
      };
    }

    throw new Error('Unable to retrieve weather data');
  }

  /**
   * Handle extended forecast lookup
   */
  async handleExtendedForecast(args) {
    const { location, days = 3 } = args;
    if (!location) {
      throw new Error('Location parameter is required for forecast lookup');
    }

    const forecastData = await lookupExtendedForecast(location, days);

    if (forecastData && forecastData.forecast && forecastData.location) {
      const forecast = forecastData.forecast.forecastday.map(day => ({
        date: day.date,
        maxTemp: `${day.day.maxtemp_c}°C`,
        minTemp: `${day.day.mintemp_c}°C`,
        condition: day.day.condition.text,
      }));

      return {
        location: forecastData.location.name,
        days,
        forecast,
        formatted: `${days}-day forecast for ${forecastData.location.name}`,
        raw: forecastData,
      };
    }

    throw new Error('Unable to retrieve forecast data');
  }

  /**
   * Handle Wolfram Alpha lookup
   */
  async handleWolframLookup(args) {
    const { query } = args;
    if (!query) {
      throw new Error('Query parameter is required for Wolfram lookup');
    }

    const result = await lookupWolfram.getWolframShortAnswer(query);
    return {
      query,
      answer: result,
      formatted: `Wolfram Alpha result for "${query}": ${result}`,
    };
  }

  /**
   * Handle quake server stats lookup
   * Note: This needs to be adapted since the original expects Discord message objects
   */
  async handleQuakeLookup(_args, _message) {
    // Create a minimal mock feedback message for the legacy handler
    const mockFeedback = {
      edit: async content => {
        logger.debug('Quake stats result:', content);
        return { content };
      },
    };

    const mockStatusManager = {
      trackQuakeStatsLookup: () => {
        // Track quake stats lookup - placeholder for legacy compatibility
        return null;
      },
    };

    try {
      await handleQuakeStats(mockFeedback, '🔍', mockStatusManager);
      return {
        success: true,
        formatted: 'Quake server statistics retrieved successfully',
      };
    } catch (error) {
      throw new Error(`Quake stats lookup failed: ${error.message}`);
    }
  }

  /**
   * Handle image generation using PocketFlow pattern
   * Returns structured data that the flow can properly process
   */
  async handleImageGeneration(args, _message) {
    const { prompt, model = 'dall-e-3', size = '1024x1024', enhance = true } = args;
    if (!prompt) {
      throw new Error('Prompt parameter is required for image generation');
    }

    try {
      logger.info(`Processing image generation request: ${prompt.substring(0, 50)}...`);

      // Get OpenAI client from config
      const config = require('../configValidator');
      const { OpenAI } = require('openai');
      const openaiClient = new OpenAI({ apiKey: config.OPENAI_API_KEY });

      // Call OpenAI DALL-E API directly
      const imageResponse = await openaiClient.images.generate({
        model: model,
        prompt: prompt,
        n: 1,
        size: size,
        quality: 'standard',
        response_format: 'url',
      });

      const imageUrl = imageResponse.data[0].url;
      const revisedPrompt = imageResponse.data[0].revised_prompt || prompt;

      logger.info(`Image generated successfully: ${imageUrl}`);

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

        // Return PocketFlow-compatible result with attachment
        return {
          success: true,
          response: `🎨 **Image Generated Successfully!** ${this.pfpManager ? '*(Added to PFP rotation)*' : ''}`,
          type: 'image',
          prompt: prompt,
          revisedPrompt: revisedPrompt,
          imageUrl: imageUrl,
          attachment: {
            buffer: imageBuffer,
            name: fileName,
          },
          formatted: `🎨 **Image Generated Successfully!**\n\n**Original Prompt:** ${prompt}${
            enhance && revisedPrompt !== prompt ? `\n**Enhanced Prompt:** ${revisedPrompt}` : ''
          }\n**Model:** ${model} | **Size:** ${size}`,
        };
      } catch (downloadError) {
        logger.warn('Failed to download image, returning URL only:', downloadError.message);

        // Return PocketFlow-compatible result with URL only
        return {
          success: true,
          response: `🎨 **Image Generated!** [Click to view your image](${imageUrl})`,
          type: 'image',
          prompt: prompt,
          revisedPrompt: revisedPrompt,
          imageUrl: imageUrl,
          formatted: `🎨 **Image Generated!** [Click to view your image](${imageUrl})`,
        };
      }
    } catch (error) {
      logger.error('Error generating image in PocketFlow processor:', error);
      throw new Error(`Image generation failed: ${error.message}`);
    }
  }

  /**
   * Handle version lookup
   */
  async handleVersionLookup(args) {
    const { detailed = false, technical = false } = args;

    try {
      const { generateVersionResponse } = require('../utils/versionSelfQuery');
      const config = require('../configValidator');

      const versionResponse = generateVersionResponse({
        detailed,
        technical,
        config,
      });

      return {
        detailed,
        technical,
        version: versionResponse,
        formatted: versionResponse,
      };
    } catch (error) {
      throw new Error(`Version lookup failed: ${error.message}`);
    }
  }
}

module.exports = PocketFlowFunctionProcessor;
