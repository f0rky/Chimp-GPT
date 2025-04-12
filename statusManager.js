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

const axios = require('axios');
const { createLogger } = require('./logger');
const { ActivityType } = require('discord.js');
const logger = createLogger('status');

// Status update interval in milliseconds (5 minutes)
const STATUS_UPDATE_INTERVAL = 5 * 60 * 1000;

// Last activity tracking
let lastActivity = {
  type: null,
  data: null,
  timestamp: null,
  username: null
};

// Error tracking for weather API
let weatherErrorCount = 0;
let weatherDisabled = false;
const MAX_WEATHER_ERRORS = 3; // Disable weather status after 3 consecutive errors

// Status rotation for when there's no recent activity
const defaultStatuses = [
  { type: ActivityType.Playing, name: 'with neural networks' },
  { type: ActivityType.Listening, name: 'to Discord' },
  { type: ActivityType.Playing, name: 'with GPT-4' },
  { type: ActivityType.Watching, name: 'Quake servers' },
  { type: ActivityType.Listening, name: 'to your requests' }
];

// Quake-related statuses
const quakeStatuses = [
  { type: ActivityType.Watching, name: '{count} Quake servers' },
  { type: ActivityType.Watching, name: '{count} active Quake servers' },
  { type: ActivityType.Watching, name: 'Quake tournaments' }
];

// Weather-related statuses
const weatherStatuses = [
  { type: ActivityType.Watching, name: 'the weather in {location}' },
  { type: ActivityType.Playing, name: 'with {weather} weather' }
];

// Conversation-related statuses
const conversationStatuses = [
  { type: ActivityType.Listening, name: 'to {username}' },
  { type: ActivityType.Playing, name: 'with words' },
  { type: ActivityType.Watching, name: 'for interesting questions' }
];

/**
 * Initialize the status manager
 * 
 * Sets up periodic status updates and returns functions to track activities.
 * 
 * @param {import('discord.js').Client} client - Discord.js client
 * @returns {Object} Status manager functions
 */
function initStatusManager(client) {
  logger.info('Initializing status manager');
  
  // Start with a default status
  updateStatus(client);
  
  // Set up interval for status updates
  const intervalId = setInterval(() => updateStatus(client), STATUS_UPDATE_INTERVAL);
  
  // Track when the bot is used for Quake server lookups
  function trackQuakeLookup(serverCount) {
    lastActivity = {
      type: 'quake',
      data: { serverCount },
      timestamp: Date.now(),
      username: null
    };
    
    logger.debug({ serverCount }, 'Tracked Quake lookup');
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
        username: null
      };
      
      logger.debug({ location, weather }, 'Tracked weather lookup');
      updateStatus(client);
    } else {
      // Increment error count and possibly disable weather status
      weatherErrorCount++;
      
      if (weatherErrorCount >= MAX_WEATHER_ERRORS) {
        weatherDisabled = true;
        logger.error(`Weather status updates disabled after ${MAX_WEATHER_ERRORS} consecutive errors`);
      } else {
        logger.warn(`Skipped tracking weather lookup due to missing data (error ${weatherErrorCount}/${MAX_WEATHER_ERRORS})`);
      }
    }
  }
  
  // Track when the bot is having a conversation
  function trackConversation(username, message) {
    lastActivity = {
      type: 'conversation',
      data: { message },
      timestamp: Date.now(),
      username
    };
    
    logger.debug({ username }, 'Tracked conversation');
    updateStatus(client);
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
    shutdown
  };
}

/**
 * Update the bot's status based on recent activity
 * 
 * @param {import('discord.js').Client} client - Discord.js client
 */
async function updateStatus(client) {
  try {
    let status;
    
    // Check if there was recent activity (within the last 5 minutes)
    // Using a shorter timeout to prevent getting stuck on a status
    const isRecentActivity = lastActivity.timestamp && 
      (Date.now() - lastActivity.timestamp < 5 * 60 * 1000);
    
    if (isRecentActivity) {
      // Generate status based on the type of recent activity
      switch (lastActivity.type) {
        case 'quake':
          status = getQuakeStatus(lastActivity.data.serverCount);
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
          status = getConversationStatus(lastActivity.username);
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
 * Get a random default status
 * 
 * @returns {Object} Status object with type and name
 */
function getRandomDefaultStatus() {
  const index = Math.floor(Math.random() * defaultStatuses.length);
  return defaultStatuses[index];
}

/**
 * Get a status related to Quake servers
 * 
 * @param {number} serverCount - Number of active Quake servers
 * @returns {Object} Status object with type and name
 */
function getQuakeStatus(serverCount) {
  return {
    type: ActivityType.Watching,
    name: `${serverCount} Quake server${serverCount === 1 ? '' : 's'}`
  };
}

/**
 * Get a status related to weather
 * 
 * @param {string} location - Location name
 * @param {string} weather - Weather condition
 * @returns {Object} Status object with type and name
 */
function getWeatherStatus(location, weather) {
  return {
    type: ActivityType.Watching,
    name: `${weather} in ${location}`
  };
}

/**
 * Get a status related to conversation
 * 
 * @param {string} username - Discord username
 * @returns {Object} Status object with type and name
 */
function getConversationStatus(username) {
  if (!username) {
    return getRandomDefaultStatus();
  }
  
  return {
    type: ActivityType.Listening,
    name: `to ${username}`
  };
}

/**
 * Get the current count of active Quake servers
 * 
 * @returns {Promise<number>} Number of active servers
 */
async function getActiveQuakeServerCount() {
  try {
    const response = await axios.get('https://ql.syncore.org/api/servers', {
      params: {
        regions: 'Oceania',
        hasPlayers: true
      },
      timeout: 5000
    });
    
    if (!response.data?.servers?.length) {
      return 0;
    }
    
    // Count servers with players
    const activeServers = response.data.servers.filter(server => server?.info?.players > 0);
    return activeServers.length;
    
  } catch (error) {
    logger.error({ error }, 'Error fetching Quake server count');
    return 0;
  }
}

module.exports = {
  initStatusManager
};
