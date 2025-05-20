/**
 * @typedef {Object} ApiCalls
 * @property {number} openai
 * @property {number} weather
 * @property {number} time
 * @property {number} wolfram
 * @property {number} quake
 * @property {@property {number} dalle} gptimage
 *
 * @typedef {Object} Errors
 * @property {number} openai
 * @property {number} discord
 * @property {number} weather
 * @property {number} time
 * @property {number} wolfram
 * @property {number} quake
 * @property {@property {number} dalle} gptimage
 * @property {number} other
 *
 * @typedef {Object} RateLimits
 * @property {number} hit
 * @property {Set<string>} users
 *
 * @typedef {Object} Stats
 * @property {Date} startTime
 * @property {number} messageCount
 * @property {ApiCalls} apiCalls
 * @property {Errors} errors
 * @property {RateLimits} rateLimits
 * @property {Date} lastRestart
 *
 * @typedef {Object} DiscordStats
 * @property {string} status
 * @property {number} ping
 * @property {number} guilds
 * @property {number} channels
 *
 * @typedef {Object} StatusHealth
 * @property {string} status
 * @property {string} name
 * @property {number} uptime
 * @property {string} version
 * @property {Object} memory
 * @property {Object} system
 * @property {Object} stats
 * @property {DiscordStats} discord
 */
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
const { getDetailedVersionInfo, formatUptime } = require('./getBotVersion');
const { getConversationStorageStatus } = require('./conversationManager');
const config = require('./configValidator');
const performanceMonitor = require('./utils/performanceMonitor');

// Import stats storage
const statsStorage = require('./statsStorage');

// Import function results storage
const functionResults = require('./functionResults');

// Track server health status
let serverHealthy = true;
let lastError = null;

// Set up periodic health check
setInterval(() => {
  const memUsage = process.memoryUsage();

  // Check if memory usage is too high (over 80% of 1.5GB)
  if (memUsage.rss > 1200000000) {
    logger.warn({ memoryUsage: memUsage }, 'Memory usage is high, consider restarting server');
  }

  serverHealthy = true;
}, 30000); // Every 30 seconds

// Import test runners
const {
  runConversationLogTests,
  runOpenAITests,
  runQuakeTests,
  runCorsTests,
  runRateLimiterTests,
} = require('./tests/testRunner');

// Import rate limiter
const { createRateLimiter } = require('./rateLimiter');

// --- Breaker Management API ---
const OWNER_TOKEN = process.env.OWNER_TOKEN || 'changeme';

// This function is exported for use in future protected endpoints
function requireOwnerToken(req, res, next) {
  const token = req.headers['x-owner-token'] || req.query.token || req.body.token;
  if (token !== OWNER_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

// Export the middleware for use in route definitions
module.exports.requireOwnerToken = requireOwnerToken;

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
    gptimage: 0,
  },
  errors: {
    openai: 0,
    discord: 0,
    weather: 0,
    time: 0,
    wolfram: 0,
    quake: 0,
    gptimage: 0,
    other: 0,
  },
  rateLimits: {
    hit: 0,
    users: new Set(),
  },
  lastRestart: new Date(),
};

/**
 * Initialize the status server
 *
 * @returns {Promise<Object>} A promise that resolves when the server is started
 */
/**
 * Initialize the status server.
 *
 * @returns {Promise<import('express').Application>} A promise that resolves with the Express app when the server is started
 */
/**
 * Initialize and start the status server
 * @param {Object} options - Configuration options
 * @param {boolean} [options.demoMode=false] - Whether to run in demo mode with mock data
 * @returns {Promise<Object>} The Express app and server instances
 */
function initStatusServer(options = {}) {
  // Extract options with defaults
  const { demoMode = false } = options;

  return new Promise((resolve, reject) => {
    const app = express();

    // If demo mode is enabled, import the demo data generator
    if (demoMode) {
      logger.info('Starting status server in DEMO MODE');
      const { initDemoMode } = require('./utils/demoDataGenerator');
      // Initialize demo mode with mock data
      initDemoMode(stats, functionResults);
    }

    // Create rate limiter for the status page
    const statusPageRateLimiter = createRateLimiter({
      keyPrefix: 'status-page',
      points: config.STATUS_RATE_LIMIT_POINTS || 300, // Use configured value or default to 300 requests
      duration: config.STATUS_RATE_LIMIT_DURATION || 60, // Use configured value or default to 60 seconds
    });

    logger.info(
      {
        points: config.STATUS_RATE_LIMIT_POINTS || 300,
        duration: config.STATUS_RATE_LIMIT_DURATION || 60,
      },
      'Status page rate limiter configured'
    );

    // Rate limiting middleware
    app.use((req, res, next) => {
      // Get client IP address
      const clientIp =
        req.ip ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress ||
        '0.0.0.0';

      // Skip rate limiting for localhost in all environments
      if (
        clientIp === '127.0.0.1' ||
        clientIp === '::1' ||
        clientIp === 'localhost' ||
        clientIp.includes('::ffff:127.0.0.1')
      ) {
        return next();
      }

      // Apply rate limiting
      return statusPageRateLimiter
        .consume(clientIp)
        .then(() => {
          // Not rate limited, proceed
          next();
          return null; // Explicit return to satisfy linter
        })
        .catch(rateLimitInfo => {
          // Rate limited
          const secondsBeforeNext = Math.ceil(rateLimitInfo.msBeforeNext / 1000) || 30;

          logger.warn(
            {
              clientIp,
              path: req.path,
              method: req.method,
              secondsBeforeNext,
            },
            'Rate limit exceeded for status page'
          );

          res.status(429).json({
            error: 'Too Many Requests',
            message: `Rate limit exceeded. Please try again in ${secondsBeforeNext} seconds.`,
            retryAfter: secondsBeforeNext,
          });
          return null; // Explicit return to satisfy linter
        });
    });

    // Configure CORS - use a simple permissive configuration for development
    // This allows all origins in development mode to prevent CORS errors
    app.use((req, res, next) => {
      // Set CORS headers
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Owner-Token'
      );
      res.header('Access-Control-Allow-Credentials', 'true');

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
      }

      next();
    });

    // Log CORS configuration
    logger.info('Using permissive CORS configuration for development');

    // Log startup info (state, CORS, version, etc.)
    // Parse CORS allowed origins, ensuring they are properly formatted
    let allowedOriginsStartup = ['http://localhost', 'http://127.0.0.1'];
    if (process.env.CORS_ALLOWED_ORIGINS) {
      try {
        // Get the raw value and sanitize it
        const rawOrigins = process.env.CORS_ALLOWED_ORIGINS;

        // Check for common environment variable parsing issues
        const sanitizedOrigins = rawOrigins
          .replace(/=true/g, '') // Remove =true which might be from command line args
          .replace(/\s+/g, ''); // Remove any whitespace

        logger.info({ raw: rawOrigins, sanitized: sanitizedOrigins }, 'Sanitized CORS origins');

        // Split by comma
        const originList = sanitizedOrigins.split(',');

        // Process each origin
        const validOrigins = [];
        for (const origin of originList) {
          const trimmed = origin.trim();
          if (!trimmed) continue; // Skip empty entries

          // Validate URL format
          try {
            // Make sure it has a protocol
            const originWithProtocol = trimmed.startsWith('http') ? trimmed : `http://${trimmed}`;
            // Use URL constructor for validation
            const url = new URL(originWithProtocol);
            if (url) {
              validOrigins.push(originWithProtocol);
              logger.info({ origin: originWithProtocol }, 'Added valid CORS origin');
            }
          } catch (e) {
            logger.warn({ origin: trimmed }, 'Invalid origin in CORS_ALLOWED_ORIGINS');
          }
        }

        if (validOrigins.length > 0) {
          allowedOriginsStartup = validOrigins;
        } else {
          logger.warn('No valid origins found in CORS_ALLOWED_ORIGINS, using defaults');
        }
      } catch (err) {
        logger.warn({ err }, 'Error parsing CORS_ALLOWED_ORIGINS, using defaults');
      }
    }
    const hostnameStartup = process.env.STATUS_HOSTNAME || 'localhost';
    allowedOriginsStartup.push(`http://${hostnameStartup}`);
    const portStartup = process.env.STATUS_PORT || 3000;

    // Get version info
    const initialVersionInfo = getDetailedVersionInfo();

    logger.info(
      {
        version: initialVersionInfo.version,
        botName: config.BOT_NAME,
        port: portStartup,
        allowedOrigins: allowedOriginsStartup,
        env: process.env.NODE_ENV || 'development',
      },
      'Status server starting up with configuration'
    );

    // Optionally log a health summary at startup
    (async () => {
      try {
        const uptime = Math.floor((new Date() - stats.startTime) / 1000);
        const memoryUsage = process.memoryUsage();
        const persistentStats = await statsStorage.loadStats();
        const mergedStats = {
          messageCount: persistentStats.messageCount || stats.messageCount,
          apiCalls: { ...stats.apiCalls, ...persistentStats.apiCalls },
          errors: { ...stats.errors, ...persistentStats.errors },
          rateLimits: {
            hit: persistentStats.rateLimits?.hit || stats.rateLimits.hit,
            users: persistentStats.rateLimits?.users || stats.rateLimits.users,
            userCounts: persistentStats.rateLimits?.userCounts || {},
          },
        };
        logger.info(
          {
            status: 'online',
            uptime,
            version: initialVersionInfo.version,
            memory: memoryUsage,
            stats: mergedStats,
            botName: config.BOT_NAME,
          },
          'Initial health summary at status server startup'
        );
      } catch (err) {
        logger.warn({ err }, 'Could not log initial health summary');
      }
    })();

    // Serve static files from the public directory
    app.use(express.static(path.join(__dirname, 'public')));

    /**
     * GET /api
     * Basic info endpoint for bot status and version.
     *
     * @route GET /api
     * @returns {Object} { name, status, version }
     */
    app.get('/api', (req, res) => {
      const apiVersionInfo = getDetailedVersionInfo();
      res.json({
        name: config.BOT_NAME,
        status: 'online',
        version: apiVersionInfo.version,
      });
    });

    /**
     * GET /conversations/status
     * Returns detailed information about the conversation storage system.
     *
     * @route GET /conversations/status
     * @returns {Object} Detailed conversation storage status
     */
    app.get('/conversations/status', (req, res) => {
      logger.info('Getting conversation storage status');

      try {
        const status = getConversationStorageStatus();
        res.json({
          success: true,
          ...status,
          lastChecked: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Error getting conversation storage status');
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    /**
     * GET /health
     * Detailed health check endpoint.
     *
     * @route GET /health
     * @returns {StatusHealth} Health and stats object
     */
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
          userCounts: persistentStats.rateLimits?.userCounts || {},
        },
      };

      // Prefer bot name from persistent stats, then config/env, then fallback
      const botName = persistentStats.name || config.BOT_NAME || process.env.BOT_NAME || 'ChimpGPT';

      // Prefer discord status from persistent stats, fallback to 'offline' if not present
      const discordStats = persistentStats.discord || {};
      const discordStatus =
        typeof discordStats.status === 'string' ? discordStats.status : 'offline';
      const discordPing = typeof discordStats.ping === 'number' ? discordStats.ping : 0;
      const discordGuilds = typeof discordStats.guilds === 'number' ? discordStats.guilds : 0;
      const discordChannels = typeof discordStats.channels === 'number' ? discordStats.channels : 0;

      // Get detailed version information
      const versionInfo = getDetailedVersionInfo();

      const health = {
        status: discordStatus === 'ok' ? 'ok' : 'offline', // overall status reflects Discord status
        name: botName,
        uptime: uptime,
        formattedUptime: formatUptime(uptime),
        version: versionInfo.version,
        versionInfo: {
          name: versionInfo.name,
          description: versionInfo.description,
          author: versionInfo.author,
          nodeVersion: versionInfo.nodeVersion,
          environment: versionInfo.environment,
          startTime: new Date(Date.now() - uptime * 1000).toISOString(),
        },
        memory: {
          rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
          heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
          heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
        },
        system: {
          platform: process.platform,
          arch: process.arch,
          cpus: os.cpus().length,
          loadAvg: os.loadavg(),
          freeMemory: `${Math.round(os.freemem() / 1024 / 1024)} MB`,
          totalMemory: `${Math.round(os.totalmem() / 1024 / 1024)} MB`,
        },
        stats: {
          messageCount: mergedStats.messageCount,
          apiCalls: mergedStats.apiCalls,
          errors: mergedStats.errors,
          rateLimits: {
            count: mergedStats.rateLimits.hit,
            uniqueUsers: Array.isArray(mergedStats.rateLimits.users)
              ? mergedStats.rateLimits.users.length
              : mergedStats.rateLimits.users instanceof Set
                ? mergedStats.rateLimits.users.size
                : 0,
            userDetails: mergedStats.rateLimits.userCounts || {},
          },
        },
        discord: {
          ping: discordPing,
          status: discordStatus,
          guilds: discordGuilds,
          channels: discordChannels,
        },
        conversations: {
          ...getConversationStorageStatus(),
          lastChecked: new Date().toISOString(),
        },
      };

      res.json(health);
    });

    /**
     * GET /version
     * Returns detailed version information about the bot.
     *
     * @route GET /version
     * @returns {Object} Detailed version information
     */
    app.get('/version', (req, res) => {
      logger.info('Getting version information');

      try {
        const versionInfo = getDetailedVersionInfo();
        const uptime = process.uptime();

        res.json({
          success: true,
          version: versionInfo.version,
          name: versionInfo.name,
          description: versionInfo.description,
          author: versionInfo.author,
          uptime: uptime,
          formattedUptime: formatUptime(uptime),
          nodeVersion: versionInfo.nodeVersion,
          platform: versionInfo.platform,
          environment: versionInfo.environment,
          memory: {
            rss: Math.round(versionInfo.memory / 1024 / 1024),
            unit: 'MB',
          },
          startTime: new Date(Date.now() - uptime * 1000).toISOString(),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Error getting version information');
        res.status(500).json({ success: false, message: 'Error getting version information' });
      }
    });

    /**
     * GET /function-results
     * Returns all stored function results.
     *
     * @route GET /function-results
     * @returns {Array<Object>} Array of function results
     */
    // Rate limiting for function results logging
    let lastLoggedTime = 0;
    const LOG_INTERVAL_MS = 60000; // Log at most once per minute

    app.get('/function-results', async (req, res) => {
      const now = Date.now();
      if (now - lastLoggedTime > LOG_INTERVAL_MS) {
        logger.debug('Getting function results');
        lastLoggedTime = now;
      }

      try {
        const results = await functionResults.getAllResults();
        res.json(results);
      } catch (error) {
        logger.error({ error }, 'Error getting function results');
        res.status(500).json({ success: false, message: 'Error getting function results' });
      }
    });

    /**
     * GET /performance
     * Returns performance monitoring data.
     *
     * @route GET /performance
     * @returns {Object} Performance metrics and timing statistics
     */
    app.get('/performance', (req, res) => {
      logger.info('Getting performance metrics');

      try {
        // Wrap in try/catch to prevent crashes
        let metrics = {};
        try {
          metrics = performanceMonitor.getAllTimingStats() || {};
        } catch (statsError) {
          logger.error({ error: statsError }, 'Error retrieving performance stats');
          metrics = { error: 'Failed to retrieve performance metrics' };
          lastError = statsError;
          serverHealthy = false;
        }

        // Create a summary object with avg and p95 for each operation
        const summary = {};
        for (const op in metrics) {
          if (metrics[op] && metrics[op].count > 0) {
            summary[op] = {
              avg: Math.round(metrics[op].avg) || 0,
              p95: Math.round(metrics[op].p95) || 0,
              count: metrics[op].count || 0,
              max: Math.round(metrics[op].max) || 0,
            };
          }
        }

        // Add memory usage info to help with debugging
        const memUsage = process.memoryUsage();
        const memoryInfo = {
          rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
          heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
          heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
          external: `${Math.round(memUsage.external / 1024 / 1024)} MB`,
        };

        res.json({
          success: true,
          summary,
          detailed: metrics,
          serverHealth: {
            status: serverHealthy ? 'healthy' : 'degraded',
            lastError: lastError ? lastError.message : null,
            memory: memoryInfo,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Critical error getting performance metrics');
        lastError = error;
        serverHealthy = false;

        // Simplified response in case of critical error
        res.status(500).json({
          success: false,
          error: error.message,
          serverHealth: {
            status: 'critical',
            message: 'Server encountered a critical error',
          },
        });
      }
    });

    /**
     * POST /reset-stats
     * Resets all statistics (in-memory and persistent).
     *
     * @route POST /reset-stats
     * @returns {Object} { success, message }
     */
    app.post('/reset-stats', async (req, res) => {
      logger.info('Resetting stats from web interface');

      try {
        const success = await statsStorage.resetStats();

        if (success) {
          // Reset in-memory stats too
          stats.messageCount = 0;
          Object.keys(stats.apiCalls).forEach(key => (stats.apiCalls[key] = 0));
          Object.keys(stats.errors).forEach(key => (stats.errors[key] = 0));
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

    /**
     * POST /repair-stats
     * Repairs the stats file if it's corrupted.
     *
     * @route POST /repair-stats
     * @returns {Object} { success, message }
     */
    app.post('/repair-stats', async (req, res) => {
      logger.info('Manual stats file repair requested');

      try {
        const repairResult = await statsStorage.repairStatsFile();

        if (repairResult) {
          logger.info('Manual stats file repair completed successfully');
          res.json({
            success: true,
            message: 'Stats file repaired successfully',
          });
        } else {
          logger.warn('Manual stats file repair failed');
          res.status(500).json({
            success: false,
            message: 'Failed to repair stats file',
          });
        }
      } catch (error) {
        logger.error({ error }, 'Error repairing stats file');
        res.status(500).json({
          success: false,
          error: 'Error repairing stats file: ' + error.message,
        });
      }
    });

    /**
     * POST /repair-function-results
     * Repairs the function results file if it's corrupted.
     *
     * @route POST /repair-function-results
     * @returns {Object} { success, message }
     */
    app.post('/repair-function-results', async (req, res) => {
      logger.info('Manual function results file repair requested');

      try {
        const functionResultsModule = require('./functionResults');
        const repairResult = await functionResultsModule.repairResultsFile();

        if (repairResult) {
          logger.info('Manual function results file repair completed successfully');
          res.json({
            success: true,
            message: 'Function results file repaired successfully',
          });
        } else {
          logger.warn('Manual function results file repair failed');
          res.status(500).json({
            success: false,
            message: 'Failed to repair function results file',
          });
        }
      } catch (error) {
        logger.error({ error }, 'Error during manual function results file repair');
        res.status(500).json({
          success: false,
          message: 'Error during function results file repair',
          error: error.message,
        });
      }
    });

    /**
     * GET /run-tests
     * Runs all configured test suites and returns results.
     *
     * @route GET /run-tests
     * @returns {Object} Test results for conversation logs, OpenAI, Quake, etc.
     */
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
          rateLimiter: rateLimiterResults,
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
      port = config.PROD_PORT || 3000; // Fallback to 3000 if PROD_PORT is not set
      logger.info(`Production environment detected. Using port: ${port} (PROD_PORT: ${config.PROD_PORT})`);
    } else {
      port = config.DEV_PORT || 3001; // Fallback to 3001 if DEV_PORT is not set
      logger.info(`Development environment detected. Using port: ${port} (DEV_PORT: ${config.DEV_PORT})`);
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
        server.on('error', error => {
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
          serverInstance.server.close(err => {
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
  process.on('uncaughtException', error => {
    shutdownGracefully(serverInstance, 'uncaughtException', error);
  });

  process.on('unhandledRejection', reason => {
    shutdownGracefully(
      serverInstance,
      'unhandledRejection',
      new Error(`Unhandled promise rejection: ${reason}`)
    );
  });

  // Start the server
  initStatusServer()
    .then(instance => {
      serverInstance = instance;
    })
    .catch(error => {
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
  shutdownGracefully,
};
