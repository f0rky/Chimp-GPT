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
const { handleImageGeneration } = require('../../handlers/imageGenerationHandler');
const { handleQuakeStats } = require('../../handlers/quakeStatsHandler');

/**
 * PocketFlow Function Call Processor
 * Provides a simplified interface for PocketFlow to execute functions
 */
class PocketFlowFunctionProcessor {
  constructor() {
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
          result = await this.handleImageGeneration(functionArgs, message);
          break;

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
   * Handle image generation
   * Note: This needs special handling since the original expects Discord message objects
   */
  async handleImageGeneration(args, message) {
    const { prompt } = args;
    if (!prompt) {
      throw new Error('Prompt parameter is required for image generation');
    }

    // Create a minimal mock feedback message for the legacy handler
    let imageUrl = null;
    let finalContent = null;

    const mockFeedback = {
      edit: async content => {
        finalContent = content;
        // Extract image URL if present in the content (improved patterns)
        const urlPatterns = [
          /https?:\/\/[^\s\n]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s\n]*)?/gi, // Image URLs with extensions
          /https?:\/\/oaidalleapiprodscus\.blob\.core\.windows\.net\/[^\s\n]+/gi, // OpenAI DALL-E URLs
          /https?:\/\/[^\s\n]+/gi, // Any complete URL
        ];

        for (const pattern of urlPatterns) {
          const urlMatch = content.match(pattern);
          if (urlMatch && urlMatch.length > 0) {
            // Take the first URL found
            imageUrl = urlMatch[0];
            // Clean up any trailing characters that might have been captured
            imageUrl = imageUrl.replace(/[.,;!?\\s]*$/, '');
            break;
          }
        }
        return { content };
      },
    };

    // Use bot personality in mock conversation
    const config = require('../configValidator');
    const mockConversationLog = [
      { role: 'system', content: config.BOT_PERSONALITY || 'You are a helpful AI assistant.' },
      { role: 'user', content: `Generate an image: ${prompt}` },
    ];

    const mockTimings = { apiCalls: {} };
    const mockFormatSubtext = (startTime, _usage, _timings) => {
      const elapsed = Date.now() - startTime;
      return `\n\n⏱️ Generated in ${Math.round(elapsed / 1000)}s`;
    };
    const mockStoreMessageRelationship = () => {
      // Store message relationship - placeholder for legacy compatibility
      return null;
    };
    const mockStatusManager = {
      trackImageGeneration: () => {
        // Track image generation - placeholder for legacy compatibility
        return null;
      },
    };

    try {
      await handleImageGeneration(
        { prompt }, // parameters
        mockFeedback, // feedbackMessage
        mockConversationLog, // conversationLog
        Date.now(), // startTime
        {}, // usage
        mockTimings.apiCalls, // timings.apiCalls
        mockFormatSubtext, // formatSubtext
        mockStoreMessageRelationship, // storeMessageRelationship
        mockStatusManager // statusManager
      );

      return {
        prompt,
        imageUrl: imageUrl,
        content: finalContent,
        formatted: imageUrl
          ? `Generated image: ${imageUrl}`
          : finalContent || 'Image generation completed',
      };
    } catch (error) {
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
