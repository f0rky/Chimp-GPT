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

// Validate environment variables early if running as standalone server
if (require.main === module) {
  const { validateEnvironmentVariables } = require('../utils/securityUtils');
  try {
    validateEnvironmentVariables();
    console.info('✅ Environment variables validated successfully'); // logger not yet initialised here
  } catch (error) {
    console.error('❌ Environment validation failed:', error.message);
    process.exit(1);
  }
}

const express = require('express');
const path = require('path');
const { createLogger } = require('../core/logger');
const { getSafeErrorDetails } = require('../core/errors');
const logger = createLogger('status');
const os = require('os');
const { getDetailedVersionInfo, formatUptime } = require('../core/getBotVersion');
const { getConversationStorageStatus } = require('../conversation/conversationManagerSelector');
const config = require('../core/configValidator');
const performanceMonitor = require('../middleware/performanceMonitor');

// Import stats storage
const statsStorage = require('../core/statsStorage');

// Import function results storage
const functionResults = require('../core/functionResults');

// Import performance history
const performanceHistory = require('./performanceHistory');

// Import malicious user manager
const maliciousUserManager = require('../utils/maliciousUserManager');

// Track if malicious user manager is initialized
const maliciousUserManagerInitialized = false;

// Track server health status
let serverHealthy = true;
const lastError = null;

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
} = require('../../tests/unit/testRunner');

// Import rate limiter
const { createRateLimiter } = require('../middleware/rateLimiter');

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

    // Add body parsing middleware
    app.use(express.json());

    // If demo mode is enabled, import the demo data generator
    if (demoMode) {
      logger.info('Starting status server in DEMO MODE');
      const { initDemoMode } = require('../utils/demoDataGenerator');
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
    const portStartup = config.PORT || 3001;

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

    // Redirect old dashboard paths to unified dashboard
    app.get('/dashboard', (req, res) => {
      res.redirect('/#performance');
    });

    // Redirect deleted messages standalone page to unified dashboard
    app.get('/deleted-messages', (req, res) => {
      res.redirect('/#deleted-messages');
    });

    // Also handle the components path if accessed directly
    app.get('/components/deletedMessages.html', (req, res) => {
      res.redirect('/#deleted-messages');
    });

    app.get('/dashboard/', (req, res) => {
      res.redirect('/#performance');
    });

    app.get('/performance.html', (req, res) => {
      res.redirect('/#performance');
    });

    // Serve old index as backup
    app.get('/index-old.html', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index-old.html'));
    });

    // ─── Route Modules ───────────────────────────────────────────────────────────
    const routeDeps = {
      stats,
      statsStorage,
      functionResults,
      performanceHistory,
      maliciousUserManager,
      serverState: { healthy: serverHealthy, lastError },
      requireOwnerToken,
    };

    app.use('/', require('./routes/healthRoutes').createRouter(routeDeps));
    app.use('/', require('./routes/performanceRoutes').createRouter(routeDeps));
    app.use('/', require('./routes/adminRoutes').createRouter(routeDeps));
    app.use('/', require('./routes/discoveryRoutes').createRouter());
    app.use('/', require('./routes/deletedMessagesRoutes').createRouter(routeDeps));
    // ─────────────────────────────────────────────────────────────────────────────
    // Check if this is a secondary deployment
    const _isSecondaryDeployment = process.env.SECONDARY_DEPLOYMENT === 'true';

    // Use unified port configuration
    const port = config.PORT || 3001;
    logger.info(`Using port: ${port}`);

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

          // Initialize performance history
          try {
            await performanceHistory.initialize();
            logger.info('Performance history initialized');
          } catch (error) {
            logger.error({ error }, 'Error initializing performance history');
          }

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
            logger.warn(
              {
                attemptedPort: portNumber,
                nextPort,
                attemptsRemaining: maxAttempts - 1,
                botName: process.env.BOT_NAME || 'Unknown',
              },
              'Port conflict detected - trying next available port'
            );
            server.close(); // Ensure the failed server is closed
            setTimeout(() => startServer(nextPort, maxAttempts - 1), 100); // Small delay before retry
          } else {
            logger.error(
              {
                error: {
                  code: error.code,
                  message: error.message,
                  port: portNumber,
                  botName: process.env.BOT_NAME || 'Unknown',
                },
              },
              'Failed to start status server'
            );
            reject(error);
          }
        });
      } catch (error) {
        if (error.code === 'EADDRINUSE' && maxAttempts > 0) {
          const nextPort = parseInt(attemptPort, 10) + 1;
          logger.warn(
            {
              attemptedPort: attemptPort,
              nextPort,
              attemptsRemaining: maxAttempts - 1,
              botName: process.env.BOT_NAME || 'Unknown',
            },
            'Port conflict in startup - trying next available port'
          );
          setTimeout(() => startServer(nextPort, maxAttempts - 1), 100);
        } else {
          logger.error(
            {
              error: {
                code: error.code,
                message: error.message,
                port: attemptPort,
                botName: process.env.BOT_NAME || 'Unknown',
              },
            },
            'Failed to start status server in catch block'
          );
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

    // Shutdown performance history
    try {
      logger.info('Shutting down performance history');
      await performanceHistory.shutdown();
    } catch (historyError) {
      logger.error({ error: historyError }, 'Error shutting down performance history');
    }

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
  // Server will be initialized by the importing module (combined.js)
  logger.info('Status server module loaded, waiting for explicit initialization');
}

module.exports = {
  initStatusServer,
  shutdownGracefully,
};
