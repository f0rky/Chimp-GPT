/**
 * ChimpGPT Status Server
 * 
 * This script runs a standalone status server for ChimpGPT,
 * providing a web interface to monitor bot health, run tests,
 * and view real-time statistics.
 * 
 * @module StatusServer
 * @author Brett
 * @version 1.0.0
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const { createLogger } = require('./logger');
const logger = createLogger('status');
const os = require('os');
const { version } = require('./package.json');

// Import configuration
const config = require('./configValidator');

// Import stats storage
const statsStorage = require('./statsStorage');

// Import function results storage
const functionResults = require('./functionResults');

// Import test runners
const { runConversationLogTests, runOpenAITests, runQuakeTests } = require('./tests/testRunner');

/**
 * Statistics tracking object for monitoring bot health
 * 
 * This is a mock object for the standalone server that will
 * be populated with real data when connected to the bot.
 */
const stats = {
  startTime: new Date(),
  messageCount: 0,
  apiCalls: {
    openai: 0,
    weather: 0,
    time: 0,
    wolfram: 0,
    quake: 0
  },
  errors: {
    openai: 0,
    discord: 0,
    weather: 0,
    time: 0,
    wolfram: 0,
    quake: 0,
    other: 0
  },
  rateLimits: {
    hit: 0,
    users: new Set()
  },
  lastRestart: new Date()
};

/**
 * Initialize the status server
 * 
 * @returns {Promise<Object>} A promise that resolves when the server is started
 */
function initStatusServer() {
  return new Promise((resolve, reject) => {
  const app = express();
  
  // Serve static files from the public directory
  app.use(express.static(path.join(__dirname, 'public')));
  
  // Basic info endpoint
  app.get('/api', (req, res) => {
    res.json({ 
      name: config.BOT_NAME,
      status: 'online',
      version
    });
  });
  
  // Detailed health check endpoint
  app.get('/health', async (req, res) => {
    const uptime = Math.floor((new Date() - stats.startTime) / 1000);
    const memoryUsage = process.memoryUsage();
    
    // Load persistent stats from storage
    const persistentStats = await statsStorage.loadStats();
    
    // Merge in-memory stats with persistent stats (persistent stats take precedence)
    const mergedStats = {
      messageCount: persistentStats.messageCount || stats.messageCount,
      apiCalls: { ...stats.apiCalls, ...persistentStats.apiCalls },
      errors: { ...stats.errors, ...persistentStats.errors },
      rateLimits: {
        hit: persistentStats.rateLimits?.hit || stats.rateLimits.hit,
        users: persistentStats.rateLimits?.users || stats.rateLimits.users,
        userCounts: persistentStats.rateLimits?.userCounts || {}
      }
    };
    
    const health = {
      status: 'ok',
      name: config.BOT_NAME,
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
        messageCount: mergedStats.messageCount,
        apiCalls: mergedStats.apiCalls,
        errors: mergedStats.errors,
        rateLimits: {
          count: mergedStats.rateLimits.hit,
          uniqueUsers: Array.isArray(mergedStats.rateLimits.users) 
            ? mergedStats.rateLimits.users.length 
            : (mergedStats.rateLimits.users instanceof Set ? mergedStats.rateLimits.users.size : 0),
          userDetails: mergedStats.rateLimits.userCounts || {}
        }
      },
      discord: {
        ping: 0,
        status: 'disconnected',
        guilds: 0,
        channels: 0
      }
    };
    
    res.json(health);
  });
  
  // Add function results endpoint
  app.get('/function-results', async (req, res) => {
    logger.info('Getting function results');
    
    try {
      const results = await functionResults.getAllResults();
      res.json(results);
    } catch (error) {
      logger.error({ error }, 'Error getting function results');
      res.status(500).json({ success: false, message: 'Error getting function results' });
    }
  });
  
  // Add stats reset endpoint
  app.post('/reset-stats', async (req, res) => {
    logger.info('Resetting stats from web interface');
    
    try {
      const success = await statsStorage.resetStats();
      
      if (success) {
        // Reset in-memory stats too
        stats.messageCount = 0;
        Object.keys(stats.apiCalls).forEach(key => stats.apiCalls[key] = 0);
        Object.keys(stats.errors).forEach(key => stats.errors[key] = 0);
        stats.rateLimits.hit = 0;
        stats.rateLimits.users = new Set();
        stats.startTime = new Date();
        
        res.json({ success: true, message: 'Stats reset successfully' });
      } else {
        res.status(500).json({ success: false, message: 'Failed to reset stats' });
      }
    } catch (error) {
      logger.error({ error }, 'Error resetting stats');
      res.status(500).json({ success: false, message: 'Error resetting stats' });
    }
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
  
  // Check if this is a secondary deployment
  const isSecondaryDeployment = process.env.SECONDARY_DEPLOYMENT === 'true';
  
  // Determine which port to use based on environment and deployment type
  const nodeEnv = process.env.NODE_ENV || 'development';
  let port;
  
  if (nodeEnv === 'production') {
    // In production, use production port with fallback to secondary deployment port
    const defaultProdPort = isSecondaryDeployment ? 3005 : 3000;
    port = config.PROD_PORT || config.STATUS_PORT || defaultProdPort;
  } else {
    // In development, use development port with fallback to secondary deployment port
    const defaultDevPort = isSecondaryDeployment ? 3006 : 3001;
    port = config.DEV_PORT || config.STATUS_PORT || defaultDevPort;
  }
  
  // Get hostname for remote access from config or environment variable
  const hostname = process.env.STATUS_HOSTNAME || config.STATUS_HOSTNAME || 'localhost';
  
  // Try to start the server, with fallback to alternative ports if the port is in use
  const startServer = (attemptPort, maxAttempts = 3) => {
    try {
      // Ensure port is a number
      const portNumber = parseInt(attemptPort, 10);
      if (isNaN(portNumber) || portNumber < 1 || portNumber > 65535) {
        throw new Error(`Invalid port number: ${attemptPort}`);
      }
      
      // Start the server
      const server = app.listen(portNumber, () => {
        logger.info(`Status server running on port ${portNumber}`);
        logger.info(`Status page available at http://localhost:${portNumber}`);
        logger.info(`For remote access: http://${hostname}:${portNumber}`);
        
        // Resolve the promise with the server instance
        resolve({ server, port: portNumber });
      });
      
      // Handle server errors
      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE' && maxAttempts > 0) {
          const nextPort = portNumber + 1;
          logger.warn(`Port ${portNumber} is already in use, trying port ${nextPort}`);
          startServer(nextPort, maxAttempts - 1);
        } else {
          logger.error({ error }, 'Failed to start status server');
          reject(error);
        }
      });
    } catch (error) {
      if (error.code === 'EADDRINUSE' && maxAttempts > 0) {
        const nextPort = parseInt(attemptPort, 10) + 1;
        logger.warn(`Port ${attemptPort} is already in use, trying port ${nextPort}`);
        startServer(nextPort, maxAttempts - 1);
      } else {
        logger.error({ error }, 'Failed to start status server');
        reject(error);
      }
    }
  };
  
  // Start the server with automatic port selection
  startServer(port);
  });
}

// Start the server if this file is run directly
if (require.main === module) {
  initStatusServer();
}

module.exports = {
  initStatusServer
};
