/**
 * @typedef {Object} StatusObject
 * @property {import('discord.js').ActivityType} type - Discord activity type
 * @property {string} name - Status message to display
 *
 * @typedef {Object} LastActivity
 * @property {string|null} type - Activity type ('quake', 'weather', 'conversation', etc.)
 * @property {Object|null} data - Activity-specific data
 * @property {number|null} timestamp - Unix timestamp (ms) of last activity
 * @property {string|null} username - Username associated with activity
 *
 * @typedef {Object} StatusManagerAPI
 * @property {function(import('discord.js').Client): Object} initStatusManager
 */
/**
 * Status Manager for ChimpGPT
 *
 * This module manages dynamic status updates for the Discord bot.
 * It provides functionality to update the bot's status based on recent
 * activities, such as Quake server lookups or ongoing conversations.
 *
 * @module StatusManager
 * @author Brett
 * @version 1.0.0
 */

// const axios = require('axios'); // Removed unused import
const { createLogger } = require('./logger');
const { ActivityType } = require('discord.js');
const logger = createLogger('status');

// Constants
const STATUS_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const CONVERSATION_SUMMARY_DELAY = 5 * 1000; // 5 seconds before showing conversation summary
// Time before returning to default status (used in updateStatus logic)
// Commented out as it's not currently used, but kept for future reference
// const CONVERSATION_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const MAX_WEATHER_ERRORS = 3; // Disable weather status after 3 consecutive errors

// Last activity tracking
let lastActivity = {
  type: null,
  data: {},
  timestamp: null,
  username: null,
  conversationStarted: null,
  conversationSummary: null,
  conversationPhase: 'initial', // 'initial', 'summary', or 'idle'
};

// Error tracking for weather API
let weatherErrorCount = 0;
let weatherDisabled = false;

// Status rotation for when there's no recent activity
const defaultStatuses = [
  { type: ActivityType.Playing, name: 'with neural networks' },
  { type: ActivityType.Listening, name: 'to Discord' },
  { type: ActivityType.Playing, name: 'with GPT-4' },
  { type: ActivityType.Watching, name: 'Quake servers' },
  { type: ActivityType.Listening, name: 'to your requests' },
];

/**
 * Initialize the status manager.
 *
 * Sets up periodic status updates and returns functions to track activities.
 *
 * @param {import('discord.js').Client} client - Discord.js client
 * @returns {{ trackQuakeLookup: function(number, string): void, trackWeatherLookup: function(string, string): void, trackConversation: function(string, string): void, shutdown: function(): void }} Status manager functions
 */
function initStatusManager(client) {
  logger.info('Initializing status manager');

  // Start with a default status
  updateStatus(client);

  // Set up interval for status updates
  const intervalId = setInterval(() => updateStatus(client), STATUS_UPDATE_INTERVAL);

  // Track when the bot is used for Quake server lookups
  function trackQuakeLookup(serverCount, username = null) {
    lastActivity = {
      type: 'quake',
      data: { serverCount },
      timestamp: Date.now(),
      username,
      conversationStarted: null,
      conversationSummary: null,
      conversationPhase: 'initial',
    };

    logger.debug({ serverCount, username }, 'Tracked Quake lookup');
    updateStatus(client);
  }

  // Track when the bot is used for weather lookups
  function trackWeatherLookup(location, weather) {
    // Check if weather status is disabled due to repeated errors
    if (weatherDisabled) {
      logger.warn('Weather status updates are disabled due to repeated API errors');
      return;
    }

    // Only track successful weather lookups
    if (location && weather) {
      // Reset error count on successful lookup
      weatherErrorCount = 0;

      lastActivity = {
        type: 'weather',
        data: { location, weather },
        timestamp: Date.now(),
        username: null,
        conversationStarted: null,
        conversationSummary: null,
        conversationPhase: 'initial',
      };

      logger.debug({ location, weather }, 'Tracked weather lookup');
      updateStatus(client);
    } else {
      // Increment error count and possibly disable weather status
      weatherErrorCount++;

      if (weatherErrorCount >= MAX_WEATHER_ERRORS) {
        weatherDisabled = true;
        logger.error(
          `Weather status updates disabled after ${MAX_WEATHER_ERRORS} consecutive errors`
        );
      } else {
        logger.warn(
          `Skipped tracking weather lookup due to missing data (error ${weatherErrorCount}/${MAX_WEATHER_ERRORS})`
        );
      }
    }
  }

  // Track when the bot is having a conversation
  // Flag to control status update frequency
  let statusUpdateDebounceTimeout = null;
  
  function trackConversation(username, summary = null) {
    const now = Date.now();
    const isNewConversation =
      !lastActivity.timestamp ||
      lastActivity.type !== 'conversation' ||
      lastActivity.username !== username;

    if (isNewConversation) {
      lastActivity = {
        type: 'conversation',
        data: {},
        timestamp: now,
        username,
        conversationStarted: now,
        conversationSummary: summary,
        conversationPhase: 'initial',
      };
    } else {
      // Update existing conversation
      lastActivity.timestamp = now;

      // If we have a summary and enough time has passed, update the phase
      if (summary && now - lastActivity.conversationStarted > CONVERSATION_SUMMARY_DELAY) {
        lastActivity.conversationSummary = summary;
        lastActivity.conversationPhase = 'summary';

        logger.debug(
          { username, summary: lastActivity.conversationSummary },
          'Updated conversation to summary phase'
        );
      }
    }

    // Debounce status updates to prevent multiple rapid updates
    // which can slow down message processing
    if (statusUpdateDebounceTimeout) {
      clearTimeout(statusUpdateDebounceTimeout);
    }
    
    statusUpdateDebounceTimeout = setTimeout(() => {
      updateStatus(client);
      statusUpdateDebounceTimeout = null;
    }, 100); // Delay status updates by 100ms to allow batching
  }

  // Track when the bot is generating images
  function trackImageGeneration(username, prompt, size = '1024x1024') {
    const now = Date.now();
    lastActivity = {
      type: 'image',
      data: {
        prompt,
        size,
        startTime: now,
      },
      timestamp: now,
      username,
      imagePhase: 'generating', // 'generating' or 'completed'
    };

    logger.debug(
      { username, prompt: prompt.substring(0, 30) + '...' },
      'Tracking image generation'
    );

    // Update status immediately
    updateStatus(client);
  }

  // Track when image generation is complete
  function trackImageComplete(generationTime, size = '1024x1024', quality = 'auto') {
    if (lastActivity.type === 'image') {
      const now = Date.now();
      lastActivity.imagePhase = 'completed';
      lastActivity.data.generationTime = generationTime;
      lastActivity.data.size = size;
      lastActivity.data.quality = quality;
      lastActivity.timestamp = now;

      logger.debug(
        { username: lastActivity.username, generationTime },
        'Image generation completed'
      );

      // Update status immediately
      updateStatus(client);
    }
  }

  // Clean up on shutdown
  function shutdown() {
    clearInterval(intervalId);
    logger.info('Status manager shutdown');
  }

  return {
    trackQuakeLookup,
    trackWeatherLookup,
    trackConversation,
    trackImageGeneration,
    trackImageComplete,
    shutdown,
  };
}

/**
 * Update the bot's status based on recent activity.
 *
 * @param {import('discord.js').Client} client - Discord.js client
 * @returns {Promise<void>} Resolves when status update is complete
 */
async function updateStatus(client) {
  try {
    let status;

    // Check if there was recent activity (within the last 5 minutes)
    // Using a shorter timeout to prevent getting stuck on a status
    const isRecentActivity =
      lastActivity.timestamp && Date.now() - lastActivity.timestamp < 5 * 60 * 1000;

    if (isRecentActivity) {
      // Generate status based on the type of recent activity
      // Variable declarations before switch statement to avoid case declaration errors
      let isFetching = false;

      switch (lastActivity.type) {
        case 'quake':
          // Check if we're fetching Quake stats for a specific user
          isFetching = Date.now() - lastActivity.timestamp < 10000; // Consider "fetching" for 10 seconds
          status = getQuakeStatus(lastActivity.data.serverCount, lastActivity.username, isFetching);
          break;
        case 'weather':
          // Add extra validation for weather data
          if (lastActivity.data && lastActivity.data.location && lastActivity.data.weather) {
            status = getWeatherStatus(lastActivity.data.location, lastActivity.data.weather);
          } else {
            logger.warn('Invalid weather data in lastActivity, using default status');
            status = getRandomDefaultStatus();
          }
          break;
        case 'conversation':
          // Use the appropriate conversation status based on the phase
          status = getConversationStatus(
            lastActivity.username,
            lastActivity.conversationPhase,
            lastActivity.conversationSummary
          );
          break;
        case 'image':
          // Use the appropriate image generation status based on the phase
          status = getImageGenerationStatus(
            lastActivity.username,
            lastActivity.imagePhase,
            lastActivity.data
          );
          break;
        default:
          status = getRandomDefaultStatus();
      }
    } else {
      // If no recent activity, check current Quake servers
      try {
        const quakeServerCount = await getActiveQuakeServerCount();
        if (quakeServerCount > 0) {
          status = getQuakeStatus(quakeServerCount);
        } else {
          status = getRandomDefaultStatus();
        }
      } catch (error) {
        logger.error({ error }, 'Error getting Quake server count');
        status = getRandomDefaultStatus();
      }
    }

    // Update the client status
    client.user.setActivity(status.name, { type: status.type });
    logger.info({ status }, 'Updated bot status');
  } catch (error) {
    logger.error({ error }, 'Error updating status');
  }
}

/**
 * Get a random default status.
 *
 * @returns {StatusObject} Status object with type and name
 */
function getRandomDefaultStatus() {
  const index = Math.floor(Math.random() * defaultStatuses.length);
  return defaultStatuses[index];
}

/**
 * Get a status related to Quake servers.
 *
 * @param {number} serverCount - Number of active Quake servers
 * @param {string} username - Username if requested by a specific user
 * @param {boolean} isFetching - Whether currently fetching Quake stats
 * @returns {StatusObject} Status object with type and name
 */
function getQuakeStatus(serverCount, username = null, isFetching = false) {
  if (isFetching) {
    return {
      type: ActivityType.Playing,
      name: username ? `Quake stats for ${username}` : 'Fetching Quake stats',
    };
  }

  return {
    type: ActivityType.Watching,
    name: `${serverCount} Quake server${serverCount !== 1 ? 's' : ''}`,
  };
}

/**
 * Get a status related to weather.
 *
 * @param {string} location - Location name
 * @param {string} weather - Weather condition
 * @returns {StatusObject} Status object with type and name
 */
function getWeatherStatus(location, weather) {
  return {
    type: ActivityType.Watching,
    name: `${weather} in ${location}`,
  };
}

/**
 * Get a status related to conversation.
 *
 * @param {string} username - Discord username
 * @param {string} phase - Conversation phase ('initial', 'summary', or 'idle')
 * @param {string} summary - Conversation summary (if in summary phase)
 * @returns {StatusObject} Status object with type and name
 */
function getConversationStatus(username, phase = 'initial', summary = null) {
  if (!username) {
    return getRandomDefaultStatus();
  }

  // Different status based on conversation phase
  switch (phase) {
    case 'initial':
      return {
        type: ActivityType.Listening,
        name: `${username}'s request`,
      };
    case 'summary':
      if (summary) {
        return {
          type: ActivityType.Playing,
          name: `with ${username} about ${summary}`,
        };
      } else {
        return {
          type: ActivityType.Playing,
          name: `with ${username}`,
        };
      }
    default:
      return getRandomDefaultStatus();
  }
}

/**
 * Get a status related to image generation.
 *
 * @param {string} username - Discord username
 * @param {string} phase - Image generation phase ('generating' or 'completed')
 * @param {Object} data - Image generation data
 * @returns {StatusObject} Status object with type and name
 */
function getImageGenerationStatus(username, phase = 'generating', data = {}) {
  if (!username) {
    return getRandomDefaultStatus();
  }

  // Different status based on image generation phase
  switch (phase) {
    case 'generating':
      // Show a creative status when generating an image
      return {
        type: ActivityType.Playing,
        name: `Creating art for ${username}`,
      };
    case 'completed':
      // If we have generation time data, include it in the status
      if (data && data.generationTime) {
        return {
          type: ActivityType.Competing,
          name: `Generated ${data.size} image in ${data.generationTime}s`,
        };
      } else {
        return {
          type: ActivityType.Competing,
          name: `Created art for ${username}`,
        };
      }
    default:
      return getRandomDefaultStatus();
  }
}

/**
 * Get the current count of active Quake servers.
 *
 * @returns {Promise<number>} Number of active servers
 */
async function getActiveQuakeServerCount() {
  // This is a simplified version - in a real implementation, you would
  // make an API call to get the actual server count
  return 5; // Default to 5 active servers for demonstration
}

/**
 * Generates a concise summary of the conversation topic based on the message
 * Used internally by getConversationStatus
 * This function is currently not used but kept for future reference
 * @param {string} message - The message to analyze
 * @returns {string} A concise summary of the conversation topic
 * @private
 */
// eslint-disable-next-line no-unused-vars
function _generateConversationSummary(message) {
  if (!message || typeof message !== 'string') {
    return 'a conversation';
  }

  // Convert to lowercase for easier pattern matching
  const lowerMessage = message.toLowerCase();

  // Check for common command patterns
  if (
    lowerMessage.includes('quake') ||
    lowerMessage.includes('ql') ||
    lowerMessage.includes('server')
  ) {
    return 'Quake servers';
  }

  if (
    lowerMessage.includes('weather') ||
    lowerMessage.includes('forecast') ||
    lowerMessage.includes('temperature')
  ) {
    return 'weather updates';
  }

  if (
    lowerMessage.includes('help') ||
    lowerMessage.includes('command') ||
    lowerMessage.includes('how to')
  ) {
    return 'help and commands';
  }

  if (
    lowerMessage.includes('time') ||
    lowerMessage.includes('date') ||
    lowerMessage.includes('clock')
  ) {
    return 'time information';
  }

  if (lowerMessage.includes('stats') || lowerMessage.includes('statistics')) {
    return 'bot statistics';
  }

  // Check for more specific topics
  if (
    lowerMessage.includes('discord') ||
    lowerMessage.includes('server') ||
    lowerMessage.includes('channel')
  ) {
    return 'Discord features';
  }

  if (
    lowerMessage.includes('game') ||
    lowerMessage.includes('play') ||
    lowerMessage.includes('gaming')
  ) {
    return 'gaming talk';
  }

  // If no specific patterns match, extract significant words
  // Focus on nouns and verbs which tend to carry more meaning
  const words = message.split(/\s+/).filter(word => word.length > 3);

  if (words.length > 0) {
    // Use up to 2 significant words from the message for the summary
    const significantWords = words.slice(0, 2);
    return significantWords.join(' ');
  }

  // Default fallback
  return 'a conversation';
}

/**
 * Status Manager API exports.
 *
 * @type {StatusManagerAPI}
 */
module.exports = {
  initStatusManager,
};
