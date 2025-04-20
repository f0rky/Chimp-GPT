/**
 * Health Check System for ChimpGPT
 * 
 * This module provides health monitoring capabilities including:
 * - HTTP endpoint for external monitoring tools
 * - Periodic status reports to the bot owner
 * - On-demand stats command via DM to the owner
 * 
 * @module HealthCheck
 * @author Brett
 * @version 1.0.0
 */

const express = require('express');
const { createLogger } = require('./logger');
const logger = createLogger('health');
const os = require('os');
const { version } = require('./package.json');

// Import configuration and test runners
const config = require('./configValidator');
const { runConversationLogTests, runOpenAITests, runQuakeTests } = require('./tests/testRunner');
const statsStorage = require('./statsStorage');

/**
 * Statistics tracking object for monitoring bot health
 * 
 * @typedef {Object} StatsObject
 * @property {Date} startTime - When the bot was started
 * @property {number} messageCount - Number of messages processed
 * @property {Object} apiCalls - Count of API calls by service
 * @property {Object} errors - Count of errors by service
 * @property {Date} lastRestart - When the bot was last restarted
 * @property {Object} rateLimits - Rate limiting statistics
 */
const stats = {
  startTime: new Date(),
  messageCount: 0,
  apiCalls: {
    openai: 0,
    weather: 0,
    time: 0,
    wolfram: 0,
    quake: 0,
    dalle: 0
  },
  errors: {
    openai: 0,
    discord: 0,
    weather: 0,
    time: 0,
    wolfram: 0,
    quake: 0,
    dalle: 0,
    other: 0
  },
  lastRestart: new Date(),
  rateLimits: {
    hit: 0,
    users: new Set()
  }
};

/**
 * Initialize the health check system
 * 
 * Sets up an Express server for health monitoring endpoints and
 * schedules periodic health reports to be sent to the bot owner.
 * 
 * @param {import('discord.js').Client} client - Discord.js client instance
 * @returns {Object} - Object containing the Express app and stats tracking object
 * @returns {import('express').Application} returns.app - Express application instance
 * @returns {StatsObject} returns.stats - Statistics tracking object
 */
function initHealthCheck(client) {
  const app = express();
  const path = require('path');
  
  // Serve static files from the public directory
  app.use(express.static(path.join(__dirname, 'public')));
  
  // Basic info endpoint
  app.get('/api', (req, res) => {
    res.json({ 
      name: 'ChimpGPT',
      status: 'online',
      version
    });
  });
  
  // Detailed health check endpoint
  app.get('/health', (req, res) => {
    const uptime = Math.floor((new Date() - stats.startTime) / 1000);
    const memoryUsage = process.memoryUsage();
    
    const health = {
      status: 'ok',
      uptime: uptime,
      version: version,
      memory: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`
      },
      system: {
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        loadAvg: os.loadavg(),
        freeMemory: `${Math.round(os.freemem() / 1024 / 1024)} MB`,
        totalMemory: `${Math.round(os.totalmem() / 1024 / 1024)} MB`
      },
      stats: {
        messageCount: stats.messageCount,
        apiCalls: stats.apiCalls,
        errors: stats.errors,
        rateLimits: {
          count: stats.rateLimits.hit,
          uniqueUsers: stats.rateLimits.users.size
        }
      },
      discord: {
        ping: client.ws.ping,
        status: client.ws.status,
        guilds: client.guilds.cache.size,
        channels: client.channels.cache.size
      }
    };
    
    // Check if any error counts are high
    const errorSum = Object.values(stats.errors).reduce((a, b) => a + b, 0);
    if (errorSum > 20 || stats.errors.openai > 10) {
      health.status = 'warning';
    }
    
    res.json(health);
  });
  
  // Add test endpoint
  app.get('/run-tests', async (req, res) => {
    logger.info('Running tests from web interface');
    
    try {
      // Run conversation log tests
      const conversationLogResults = await runConversationLogTests();
      
      // Run OpenAI integration tests
      const openaiResults = await runOpenAITests();
      
      // Run Quake server stats tests
      const quakeResults = await runQuakeTests();
      
      // Return all test results
      res.json({
        conversationLog: conversationLogResults,
        openaiIntegration: openaiResults,
        quakeServerStats: quakeResults
      });
    } catch (error) {
      logger.error({ error }, 'Error running tests');
      res.status(500).json({ error: 'Failed to run tests' });
    }
  });
  
  // Start the server
  // Determine which port to use based on environment
  let port;
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  if (nodeEnv === 'production') {
    port = config.PROD_PORT || config.HEALTH_PORT || 3000;
  } else {
    port = config.DEV_PORT || config.HEALTH_PORT || 3001;
  }
  
  app.listen(port, () => {
    logger.info(`Health check server running on port ${port} (${nodeEnv} mode)`);
    logger.info(`Status page available at http://localhost:${port}`);
  });
  
  // Schedule periodic health reports to owner
  if (config.OWNER_ID) {
    scheduleHealthReports(client);
  }
  
  return { app, stats };
}

/**
 * Schedule periodic health reports to be sent to the bot owner
 * 
 * Sets up two intervals:
 * 1. A regular interval (every 12 hours) to send health reports
 * 2. A one-time delayed report sent shortly after startup
 * 
 * @param {import('discord.js').Client} client - Discord.js client
 * @returns {void}
 */
function scheduleHealthReports(client) {
  // Send a health report every 12 hours
  const REPORT_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
  
  setInterval(async () => {
    try {
      const owner = await client.users.fetch(config.OWNER_ID);
      if (owner) {
        const report = generateHealthReport();
        await owner.send(report);
        logger.info('Sent scheduled health report to owner');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to send health report to owner');
    }
  }, REPORT_INTERVAL);
  
  // Also send a report on startup
  setTimeout(async () => {
    try {
      const owner = await client.users.fetch(config.OWNER_ID);
      if (owner) {
        const report = generateHealthReport(true);
        await owner.send(report);
        logger.info('Sent startup health report to owner');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to send startup health report to owner');
    }
  }, 10000); // Wait 10 seconds after startup
}

/**
 * Generate a health report message
 * 
 * Creates a formatted report containing:
 * - Bot uptime and version
 * - Memory usage statistics
 * - API call counts by service
 * - Error counts by service
 * - Rate limiting statistics
 * 
 * @param {boolean} isStartup - Whether this is a startup report
 * @returns {string} - Formatted health report as a Markdown string
 */
function generateHealthReport(isStartup = false) {
  const uptime = Math.floor((new Date() - stats.startTime) / 1000);
  const memoryUsage = process.memoryUsage();
  
  let title = '📊 ChimpGPT Health Report';
  if (isStartup) {
    title = '🚀 ChimpGPT Started Successfully';
  }
  
  const errorSum = Object.values(stats.errors).reduce((a, b) => a + b, 0);
  let statusEmoji = '✅';
  if (errorSum > 20 || stats.errors.openai > 10) {
    statusEmoji = '⚠️';
  }
  
  const report = `
${title}

**Status:** ${statusEmoji} ${errorSum > 20 ? 'Warning' : 'Healthy'}
**Version:** ${version}
**Uptime:** ${formatDuration(uptime)}
**Memory:** ${Math.round(memoryUsage.rss / 1024 / 1024)} MB

**Statistics:**
• Messages Processed: ${stats.messageCount}
• OpenAI API Calls: ${stats.apiCalls.openai}
• Weather API Calls: ${stats.apiCalls.weather}
• Time Lookups: ${stats.apiCalls.time}
• Wolfram Alpha Queries: ${stats.apiCalls.wolfram}
• Quake Server Lookups: ${stats.apiCalls.quake}

**Errors:**
• Total Errors: ${errorSum}
• OpenAI Errors: ${stats.errors.openai}
• Discord Errors: ${stats.errors.discord}
• Other API Errors: ${stats.errors.weather + stats.errors.time + stats.errors.wolfram + stats.errors.quake}

**Rate Limiting:**
• Rate Limits Hit: ${stats.rateLimits.hit}
• Unique Users Limited: ${stats.rateLimits.users.size}

For more details, use one of these commands: 'stats', '!stats', '.stats', or '/stats'
`;
  
  return report;
}

/**
 * Check if a message is a stats command
 * 
 * Determines if a message content matches any of the supported
 * formats for the stats command (e.g., /stats, !stats, etc.)
 * 
 * @param {import('discord.js').Message} message - Discord message
 * @returns {boolean} - Whether the message is a stats command
 */
function isStatsCommand(message) {
  const statsCommands = [
    '/stats', 
    '!stats', 
    '.stats',
    'stats',
    '/stat',
    '!stat',
    '.stat'
  ];
  
  return statsCommands.includes(message.content.toLowerCase().trim());
}

/**
 * Handle a stats command
 * 
 * Processes a stats command request, generates a health report,
 * and sends it as a reply to the message.
 * 
 * @param {import('discord.js').Message} message - Discord message
 * @returns {Promise<void>}
 */
async function handleStatsCommand(message) {
  logger.info({ 
    userId: message.author.id, 
    command: message.content,
    isOwner: message.author.id === config.OWNER_ID
  }, 'Stats command used');
  
  const report = generateHealthReport();
  await message.reply(report);
}

/**
 * Format a duration in seconds to a human-readable string
 * 
 * Converts a duration in seconds to a formatted string showing
 * days, hours, minutes, and seconds as appropriate.
 * 
 * @param {number} seconds - Duration in seconds
 * @returns {string} - Formatted duration string (e.g., "2d 5h 30m 15s")
 */
function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  
  return parts.join(' ');
}

/**
 * Track an API call
 * 
 * Increments the counter for a specific API call type.
 * Used for monitoring API usage across different services.
 * 
 * @param {string} type - Type of API call (openai, weather, time, wolfram, quake)
 * @returns {void}
 */
function trackApiCall(type) {
  if (stats.apiCalls[type] !== undefined) {
    stats.apiCalls[type]++;
    // Also store in persistent storage
    statsStorage.incrementStat(`apiCalls.${type}`);
  }
}

/**
 * Track an error
 * 
 * Increments the counter for a specific error type.
 * Used for monitoring error rates across different services.
 * 
 * @param {string} type - Type of error (openai, discord, weather, time, wolfram, quake, other)
 * @returns {void}
 */
function trackError(type) {
  if (stats.errors[type] !== undefined) {
    stats.errors[type]++;
    // Also store in persistent storage
    statsStorage.incrementStat(`errors.${type}`);
  } else {
    stats.errors.other++;
    // Also store in persistent storage
    statsStorage.incrementStat('errors.other');
  }
}

/**
 * Track a rate limit hit
 * 
 * Records when a user hits a rate limit. Tracks both the total count
 * and the unique users who have been rate limited.
 * 
 * @param {string} userId - Discord user ID
 * @returns {void}
 */
function trackRateLimit(userId) {
  stats.rateLimits.hit++;
  stats.rateLimits.users.add(userId);
  // Also store in persistent storage
  statsStorage.incrementStat('rateLimits.hit');
  statsStorage.addRateLimitedUser(userId);
}

/**
 * Track a message
 * 
 * Increments the message counter in the stats object.
 * Used to monitor overall bot usage.
 * 
 * @returns {void}
 */
function trackMessage() {
  stats.messageCount++;
  // Also store in persistent storage
  statsStorage.incrementStat('messageCount');
}

module.exports = {
  initHealthCheck,
  trackApiCall,
  trackError,
  trackRateLimit,
  trackMessage,
  stats,
  isStatsCommand,
  handleStatsCommand
};
