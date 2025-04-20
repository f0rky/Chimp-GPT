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
const cors = require('cors');
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
const { runConversationLogTests, runOpenAITests, runQuakeTests, runCorsTests, runRateLimiterTests } = require('./tests/testRunner');

// Import rate limiter
const { createRateLimiter } = require('./rateLimiter');

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
  
  // Create rate limiter for the status page
  const statusPageRateLimiter = createRateLimiter({
    keyPrefix: 'status-page',
    points: config.STATUS_RATE_LIMIT_POINTS || 60,       // Use configured value or default to 60 requests
    duration: config.STATUS_RATE_LIMIT_DURATION || 60     // Use configured value or default to 60 seconds
  });
  
  logger.info({
    points: config.STATUS_RATE_LIMIT_POINTS || 60,
    duration: config.STATUS_RATE_LIMIT_DURATION || 60
  }, 'Status page rate limiter configured');
  
  // Rate limiting middleware
  app.use((req, res, next) => {
    // Get client IP address
    const clientIp = req.ip || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress || 
                     req.connection.socket.remoteAddress || 
                     '0.0.0.0';
    
    // Skip rate limiting for localhost in development
    if (process.env.NODE_ENV === 'development' && 
        (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost')) {
      return next();
    }
    
    // Apply rate limiting
    statusPageRateLimiter.consume(clientIp)
      .then(() => {
        // Not rate limited, proceed
        next();
      })
      .catch((rateLimitInfo) => {
        // Rate limited
        const secondsBeforeNext = Math.ceil(rateLimitInfo.msBeforeNext / 1000) || 30;
        
        logger.warn({ 
          clientIp, 
          path: req.path,
          method: req.method,
          secondsBeforeNext 
        }, 'Rate limit exceeded for status page');
        
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Please try again in ${secondsBeforeNext} seconds.`,
          retryAfter: secondsBeforeNext
        });
      });
  });
  
  // Configure CORS
  const corsOptions = {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, etc)
      if (!origin) return callback(null, true);
      
      // Get allowed origins from environment or use defaults
      const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS 
        ? process.env.CORS_ALLOWED_ORIGINS.split(',') 
        : ['http://localhost', 'http://127.0.0.1'];
      
      // Add the current hostname to allowed origins
      const hostname = process.env.STATUS_HOSTNAME || 'localhost';
      allowedOrigins.push(`http://${hostname}`);
      
      // Check if the origin is allowed
      if (allowedOrigins.some(allowedOrigin => origin.startsWith(allowedOrigin))) {
        callback(null, true);
      } else {
        // Log CORS violations as warnings, not errors
        logger.warn({ origin }, 'CORS blocked request from unauthorized origin');
        // Use a custom error object that doesn't print a stack trace
        const corsError = new Error('Not allowed by CORS');
        corsError.name = 'CORSError';
        corsError.stack = undefined; // Prevent stack trace in logs
        callback(corsError);
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
    maxAge: 86400 // 24 hours
  };
  
  // Apply CORS middleware
  app.use(cors(corsOptions));
  
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
      
      // Run CORS configuration tests
      // Determine the base URL for CORS tests
      const protocol = req.protocol;
      const host = req.get('host');
      const baseUrl = `${protocol}://${host}`;
      const corsResults = await runCorsTests(baseUrl);
      
      // Run rate limiter tests
      const rateLimiterResults = await runRateLimiterTests(baseUrl);
      
      // Return all test results
      res.json({
        conversationLog: conversationLogResults,
        openaiIntegration: openaiResults,
        quakeServerStats: quakeResults,
        corsConfiguration: corsResults,
        rateLimiter: rateLimiterResults
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
      const server = app.listen(portNumber, async () => {
        logger.info(`Status server running on port ${portNumber}`);
        logger.info(`Status page available at http://localhost:${portNumber}`);
        logger.info(`For remote access: http://${hostname}:${portNumber}`);
        
        // Run CORS test on startup to verify configuration
        try {
          const baseUrl = `http://localhost:${portNumber}`;
          logger.info({ baseUrl }, 'Running startup CORS configuration test');
          const corsResults = await runCorsTests(baseUrl);
          
          if (corsResults.success) {
            logger.info('CORS configuration test passed');
          } else {
            logger.warn({ results: corsResults.details }, 'CORS configuration test failed');
          }
        } catch (error) {
          logger.error({ error }, 'Error running startup CORS test');
        }
        
        // Run rate limiter test on startup to verify configuration
        try {
          const baseUrl = `http://localhost:${portNumber}`;
          logger.info({ baseUrl }, 'Running startup rate limiter test');
          const rateLimiterResults = await runRateLimiterTests(baseUrl);
          
          if (rateLimiterResults.success) {
            logger.info('Rate limiter test passed');
          } else {
            logger.warn({ results: rateLimiterResults.details }, 'Rate limiter test failed');
          }
        } catch (error) {
          logger.error({ error }, 'Error running startup rate limiter test');
        }
        
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

/**
 * Gracefully shut down the status server
 * 
 * This function handles the graceful shutdown of the status server,
 * ensuring that all connections are properly closed and resources
 * are released before the process exits.
 * 
 * @param {Object} serverInstance - The server instance to shut down
 * @param {string} signal - The signal that triggered the shutdown
 * @param {Error} [error] - Optional error that caused the shutdown
 * @returns {Promise<void>}
 */
async function shutdownGracefully(serverInstance, signal, error) {
  let exitCode = 0;
  const shutdownStart = Date.now();
  
  try {
    logger.info({ signal }, 'Status server graceful shutdown initiated');
    
    if (error) {
      logger.error({ error }, 'Status server shutdown triggered by error');
      exitCode = 1;
    }
    
    // Set a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      logger.fatal('Forced exit due to status server shutdown timeout');
      process.exit(exitCode || 1);
    }, 5000); // 5 seconds timeout
    
    // Clear the timeout if we exit normally
    forceExitTimeout.unref();
    
    // Close the server
    if (serverInstance && serverInstance.server) {
      try {
        logger.info('Closing status server connections');
        
        await new Promise((resolve, reject) => {
          serverInstance.server.close((err) => {
            if (err) {
              logger.error({ error: err }, 'Error closing status server');
              reject(err);
            } else {
              logger.info('Status server closed successfully');
              resolve();
            }
          });
        });
      } catch (closeError) {
        logger.error({ error: closeError }, 'Error during status server shutdown');
      }
    } else {
      logger.warn('No server instance to close');
    }
    
    // Log successful shutdown
    const shutdownDuration = Date.now() - shutdownStart;
    logger.info({ durationMs: shutdownDuration }, 'Status server graceful shutdown completed');
    
    // If this is a standalone process, exit
    if (require.main === module) {
      process.exit(exitCode);
    }
  } catch (shutdownError) {
    logger.fatal({ error: shutdownError }, 'Fatal error during status server shutdown process');
    
    if (require.main === module) {
      process.exit(1);
    }
  }
}

// Register signal handlers for graceful shutdown if this is the main module
if (require.main === module) {
  let serverInstance = null;
  
  // Handle signals
  process.on('SIGTERM', () => {
    if (serverInstance) shutdownGracefully(serverInstance, 'SIGTERM');
  });
  
  process.on('SIGINT', () => {
    if (serverInstance) shutdownGracefully(serverInstance, 'SIGINT');
  });
  
  process.on('SIGHUP', () => {
    if (serverInstance) shutdownGracefully(serverInstance, 'SIGHUP');
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    shutdownGracefully(serverInstance, 'uncaughtException', error);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    shutdownGracefully(serverInstance, 'unhandledRejection', new Error(`Unhandled promise rejection: ${reason}`));
  });
  
  // Start the server
  initStatusServer().then(instance => {
    serverInstance = instance;
  }).catch(error => {
    logger.fatal({ error }, 'Failed to start status server');
    process.exit(1);
  });
} else {
  // If imported as a module, just export the functions
  initStatusServer().catch(error => {
    logger.error({ error }, 'Error initializing status server as module');
  });
}

module.exports = {
  initStatusServer,
  shutdownGracefully
};
