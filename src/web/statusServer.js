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
const { createLogger } = require('../core/logger');
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
const maliciousUserManager = require('../../utils/maliciousUserManager');

// Track if malicious user manager is initialized
let maliciousUserManagerInitialized = false;

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

/**
 * Bot Discovery Functions
 */

/**
 * Discover ChimpGPT instances running via PM2
 * @returns {Promise<Array>} Array of discovered PM2 bot instances
 */
async function discoverPM2Bots() {
  const { spawn } = require('child_process');

  return new Promise((resolve, reject) => {
    const pm2Process = spawn('pm2', ['jlist'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let error = '';

    pm2Process.stdout.on('data', data => {
      output += data.toString();
    });

    pm2Process.stderr.on('data', data => {
      error += data.toString();
    });

    pm2Process.on('close', code => {
      if (code !== 0) {
        reject(new Error(`PM2 command failed: ${error}`));
        return;
      }

      try {
        const processes = JSON.parse(output);

        const chimpBots = processes
          .filter(
            proc =>
              proc.name &&
              (proc.name.toLowerCase().includes('chimpgpt') ||
                proc.name.toLowerCase().includes('chimp-gpt'))
          )
          .map(proc => {
            const env = proc.pm2_env || {};
            const port = env.PORT || extractPortFromEnv(env.env || {}) || 3001;

            return {
              name: proc.name,
              type: 'pm2',
              status: env.status || 'unknown',
              port: parseInt(port, 10),
              botName: env.BOT_NAME || proc.name,
              uptime: env.pm_uptime ? new Date(env.pm_uptime) : null,
              memory: proc.monit ? Math.round(proc.monit.memory / 1024 / 1024) : null,
              cpu: proc.monit ? proc.monit.cpu : null,
              pid: proc.pid,
              restarts: env.restart_time || 0,
            };
          });

        resolve(chimpBots);
      } catch (parseError) {
        reject(new Error(`Failed to parse PM2 output: ${parseError.message}`));
      }
    });

    pm2Process.on('error', err => {
      reject(new Error(`Failed to execute PM2 command: ${err.message}`));
    });
  });
}

/**
 * Extract port from environment variables
 * @param {Object} env - Environment variables object
 * @returns {number|null} Extracted port number or null
 */
function extractPortFromEnv(env) {
  if (env.PORT) return parseInt(env.PORT, 10);
  if (env.STATUS_PORT) return parseInt(env.STATUS_PORT, 10);
  return null;
}

/**
 * Discover ChimpGPT instances running via Docker
 * @returns {Promise<Array>} Array of discovered Docker bot instances
 */
async function discoverDockerBots() {
  const { spawn } = require('child_process');

  return new Promise(resolve => {
    const dockerProcess = spawn('docker', ['ps', '--format', 'json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let error = '';

    dockerProcess.stdout.on('data', data => {
      output += data.toString();
    });

    dockerProcess.stderr.on('data', data => {
      error += data.toString();
    });

    dockerProcess.on('close', code => {
      if (code !== 0) {
        logger.warn({ error }, 'Docker command failed, skipping Docker discovery');
        resolve([]); // Don't fail if Docker isn't available
        return;
      }

      try {
        const lines = output.trim().split('\n');
        const containers = lines
          .filter(line => line.trim())
          .map(line => JSON.parse(line))
          .filter(
            container =>
              container.Names &&
              (container.Names.toLowerCase().includes('chimpgpt') ||
                (container.Image && container.Image.toLowerCase().includes('chimpgpt')))
          )
          .map(container => {
            const ports = container.Ports || '';
            const portMatch = ports.match(/0\.0\.0\.0:(\d+)->/);
            const port = portMatch ? parseInt(portMatch[1], 10) : null;

            return {
              name: container.Names,
              type: 'docker',
              status: container.State,
              port: port,
              botName: container.Names.replace(/^\//, ''), // Remove leading slash
              image: container.Image,
              created: container.CreatedAt,
              ports: ports,
            };
          });

        resolve(containers);
      } catch (parseError) {
        logger.warn({ error: parseError }, 'Failed to parse Docker output');
        resolve([]); // Return empty array instead of failing
      }
    });

    dockerProcess.on('error', err => {
      logger.warn({ error: err }, 'Docker command execution failed');
      resolve([]); // Don't fail if Docker isn't available
    });
  });
}

/**
 * Check health of a discovered bot instance
 * @param {number} port - Port to check
 * @param {string} botName - Name of the bot
 * @param {string} instanceName - Instance name
 * @returns {Promise<Object>} Health check result
 */
async function checkBotHealth(port, botName, instanceName) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const healthData = await response.json();
      return {
        port,
        botName: healthData.name || botName,
        instanceName,
        status: healthData.status || 'unknown',
        uptime: healthData.uptime || 0,
        formattedUptime: healthData.formattedUptime || '0s',
        version: healthData.version || 'unknown',
        accessible: true,
        url: `http://localhost:${port}`,
        dashboardUrl: `http://localhost:${port}/#performance`,
        lastChecked: new Date().toISOString(),
        responseTime: Date.now() - (response.headers.get('x-response-time') || Date.now()),
      };
    }

    return {
      port,
      botName,
      instanceName,
      accessible: false,
      error: `HTTP ${response.status}: ${response.statusText}`,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    clearTimeout(timeoutId);

    let errorMessage = error.message;
    if (error.name === 'AbortError') {
      errorMessage = 'Connection timeout';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused';
    }

    return {
      port,
      botName,
      instanceName,
      accessible: false,
      error: errorMessage,
      lastChecked: new Date().toISOString(),
    };
  }
}

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

    // Add body parsing middleware
    app.use(express.json());

    // If demo mode is enabled, import the demo data generator
    if (demoMode) {
      logger.info('Starting status server in DEMO MODE');
      const { initDemoMode } = require('../../utils/demoDataGenerator');
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

      // Get conversation mode information
      const blendedConversations = config.USE_BLENDED_CONVERSATIONS;
      const replyContext = config.ENABLE_REPLY_CONTEXT;
      const pocketFlow = config.ENABLE_POCKETFLOW;
      const parallelTesting = config.POCKETFLOW_PARALLEL_TESTING;
      const maxMessagesPerUser = parseInt(config.MAX_MESSAGES_PER_USER_BLENDED, 10) || 5;

      // Determine mode description with PocketFlow support
      let mode;
      if (pocketFlow) {
        mode = 'PocketFlow (Graph-based Architecture)';
      } else if (parallelTesting) {
        mode = 'Parallel Testing (PocketFlow + Legacy)';
      } else if (blendedConversations === true && replyContext === true) {
        mode = 'Legacy: Blended with Reply Context';
      } else if (blendedConversations === true && replyContext === false) {
        mode = 'Legacy: Blended Only';
      } else if (blendedConversations === false && replyContext === true) {
        mode = 'Legacy: Individual with Reply Context';
      } else if (blendedConversations === false && replyContext === false) {
        mode = 'Legacy: Individual Only';
      } else {
        mode = `Unknown (blended: ${blendedConversations}, reply: ${replyContext})`;
      }

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
        conversationMode: {
          blendedConversations: blendedConversations,
          replyContext: replyContext,
          mode: mode,
          maxMessagesPerUser: maxMessagesPerUser,
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
        // Add pagination support to prevent massive data transfers
        const limit = parseInt(req.query.limit, 10) || 50; // Default to last 50 results
        const skip = parseInt(req.query.skip, 10) || 0;

        const allResults = await functionResults.getAllResults();

        // If it's an object with categories, limit each category
        if (typeof allResults === 'object' && !Array.isArray(allResults)) {
          const limitedResults = {};
          for (const [category, items] of Object.entries(allResults)) {
            if (Array.isArray(items)) {
              limitedResults[category] = items.slice(skip, skip + limit);
            } else {
              limitedResults[category] = items;
            }
          }
          res.json(limitedResults);
        } else if (Array.isArray(allResults)) {
          // If it's an array, just slice it
          res.json(allResults.slice(skip, skip + limit));
        } else {
          res.json(allResults);
        }
      } catch (error) {
        logger.error({ error }, 'Error getting function results');
        res.status(500).json({ success: false, message: 'Error getting function results' });
      }
    });

    /**
     * GET /function-results/summary
     * Returns summarized function results (counts only, no full data)
     *
     * @route GET /function-results/summary
     * @returns {Object} Summary of function results without the large data
     */
    app.get('/function-results/summary', async (req, res) => {
      try {
        const allResults = await functionResults.getAllResults();

        // Create summary with just counts and latest timestamps
        const summary = {};
        for (const [category, items] of Object.entries(allResults)) {
          if (Array.isArray(items)) {
            summary[category] = {
              count: items.length,
              latest: items.length > 0 ? items[items.length - 1]?.timestamp : null,
            };
          } else if (category === 'lastUpdated') {
            summary[category] = items;
          } else if (category === 'plugins' && typeof items === 'object') {
            // Summarize plugins data instead of returning full arrays
            summary[category] = {};
            for (const [pluginName, pluginData] of Object.entries(items)) {
              if (Array.isArray(pluginData)) {
                summary[category][pluginName] = {
                  count: pluginData.length,
                  latest:
                    pluginData.length > 0 ? pluginData[pluginData.length - 1]?.timestamp : null,
                };
              } else {
                summary[category][pluginName] = pluginData;
              }
            }
          } else {
            summary[category] = items;
          }
        }

        res.json(summary);
      } catch (error) {
        logger.error({ error }, 'Error getting function results summary');
        res.status(500).json({ success: false, message: 'Error getting function results summary' });
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

        const responseData = {
          success: true,
          summary,
          detailed: metrics,
          serverHealth: {
            status: serverHealthy ? 'healthy' : 'degraded',
            lastError: lastError ? lastError.message : null,
            memory: memoryInfo,
          },
          timestamp: new Date().toISOString(),
        };

        // Store performance data in history
        try {
          performanceHistory.addMetric(responseData);
        } catch (historyError) {
          logger.error({ error: historyError }, 'Error storing performance history');
        }

        res.json(responseData);
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
     * GET /performance/history/hourly
     * Returns hourly aggregated performance data
     *
     * @route GET /performance/history/hourly
     * @query {number} hours - Number of hours to retrieve (default: 24, max: 168)
     * @returns {Object} Hourly performance data
     */
    app.get('/performance/history/hourly', (req, res) => {
      const hours = Math.min(parseInt(req.query.hours, 10) || 24, 168);
      logger.info(`Getting hourly performance history for ${hours} hours`);

      try {
        const hourlyData = performanceHistory.getHourlyData(hours);
        res.json({
          success: true,
          hours,
          data: hourlyData,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Error getting hourly performance history');
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    /**
     * GET /performance/history/daily
     * Returns daily aggregated performance data
     *
     * @route GET /performance/history/daily
     * @query {number} days - Number of days to retrieve (default: 30, max: 90)
     * @returns {Object} Daily performance data
     */
    app.get('/performance/history/daily', (req, res) => {
      const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
      logger.info(`Getting daily performance history for ${days} days`);

      try {
        const dailyData = performanceHistory.getDailyData(days);
        res.json({
          success: true,
          days,
          data: dailyData,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Error getting daily performance history');
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    /**
     * GET /performance/history/recent
     * Returns recent raw performance metrics
     *
     * @route GET /performance/history/recent
     * @query {number} minutes - Number of minutes to retrieve (default: 60, max: 1440)
     * @returns {Object} Recent performance metrics
     */
    app.get('/performance/history/recent', (req, res) => {
      const minutes = Math.min(parseInt(req.query.minutes, 10) || 60, 1440);
      logger.info(`Getting recent performance history for ${minutes} minutes`);

      try {
        const recentData = performanceHistory.getRecentMetrics(minutes);
        res.json({
          success: true,
          minutes,
          count: recentData.length,
          data: recentData,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Error getting recent performance history');
        res.status(500).json({
          success: false,
          error: error.message,
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
        const functionResultsModule = require('../core/functionResults');
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
     * GET /blocked-users
     * Returns list of blocked users and their statistics
     *
     * @route GET /blocked-users
     * @returns {Object} Blocked users data
     */
    app.get('/blocked-users', async (req, res) => {
      logger.info('Getting blocked users list');

      try {
        // Initialize malicious user manager if not already done
        if (!maliciousUserManagerInitialized) {
          await maliciousUserManager.init();
          maliciousUserManagerInitialized = true;
        }

        const blockedUserIds = maliciousUserManager.getBlockedUsers();
        const blockedUsersData = [];

        // Get stats for each blocked user
        for (const userId of blockedUserIds) {
          const userStats = maliciousUserManager.getUserStats(userId);
          blockedUsersData.push({
            userId,
            ...userStats,
            blockedAt: new Date().toISOString(), // This is approximate, actual block time not stored
          });
        }

        res.json({
          success: true,
          count: blockedUsersData.length,
          users: blockedUsersData,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Error getting blocked users');
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    /**
     * POST /unblock-user
     * Unblocks a user (requires owner token)
     *
     * @route POST /unblock-user
     * @body {string} userId - The user ID to unblock
     * @returns {Object} Success status
     */
    app.post('/unblock-user', requireOwnerToken, async (req, res) => {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required',
        });
      }

      logger.info({ userId }, 'Unblocking user via dashboard');

      try {
        const wasUnblocked = await maliciousUserManager.unblockUser(userId);

        if (wasUnblocked) {
          return res.json({
            success: true,
            message: `User ${userId} has been unblocked`,
          });
        }

        return res.status(404).json({
          success: false,
          error: 'User was not blocked',
        });
      } catch (error) {
        logger.error({ error, userId }, 'Error unblocking user');
        return res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    /**
     * GET /api/discover-bots
     * Discovers other ChimpGPT bot instances running via PM2 or Docker
     *
     * @route GET /api/discover-bots
     * @returns {Object} List of discovered bot instances with health status
     */
    app.get('/api/discover-bots', async (req, res) => {
      logger.info('Discovering ChimpGPT bot instances');

      try {
        const discoveredBots = [];

        // Discover PM2 processes
        try {
          const pm2Bots = await discoverPM2Bots();
          discoveredBots.push(...pm2Bots);
        } catch (pm2Error) {
          logger.warn({ error: pm2Error }, 'PM2 discovery failed');
        }

        // Discover Docker containers
        try {
          const dockerBots = await discoverDockerBots();
          discoveredBots.push(...dockerBots);
        } catch (dockerError) {
          logger.warn({ error: dockerError }, 'Docker discovery failed');
        }

        // Health check all discovered bots
        const botsWithHealth = await Promise.allSettled(
          discoveredBots.map(bot => checkBotHealth(bot.port, bot.botName, bot.name))
        );

        const healthyBots = botsWithHealth
          .filter(result => result.status === 'fulfilled' && result.value.accessible)
          .map(result => result.value);

        res.json({
          success: true,
          count: healthyBots.length,
          totalDiscovered: discoveredBots.length,
          bots: healthyBots,
          currentBot: {
            name: config.BOT_NAME || process.env.BOT_NAME || 'ChimpGPT',
            port: config.PORT || process.env.PORT || 3001,
            url: `${req.protocol}://${req.get('host')}`,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Error discovering bot instances');
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    /**
     * GET /api/discover-services
     * Comprehensive service discovery across ports 3000-3020
     *
     * @route GET /api/discover-services
     * @query {number} startPort - Starting port (default: 3000)
     * @query {number} endPort - Ending port (default: 3020)
     * @query {boolean} botsOnly - Return only bot services (default: false)
     * @returns {Object} Comprehensive service discovery results
     */
    app.get('/api/discover-services', async (req, res) => {
      logger.info('Starting comprehensive service discovery');

      try {
        // Import service discovery utility
        const { discoverServices, getCurrentBotInfo } = require('../utils/serviceDiscovery');

        // Parse query parameters
        const startPort = parseInt(req.query.startPort, 10) || 3000;
        const endPort = parseInt(req.query.endPort, 10) || 3020;
        const botsOnly = req.query.botsOnly === 'true';

        // Validate port range
        if (startPort < 1 || endPort > 65535 || startPort > endPort) {
          return res.status(400).json({
            success: false,
            error: 'Invalid port range. Ports must be between 1-65535 and startPort <= endPort',
          });
        }

        // Limit port range to prevent abuse
        if (endPort - startPort > 100) {
          return res.status(400).json({
            success: false,
            error: 'Port range too large. Maximum range is 100 ports.',
          });
        }

        // Perform service discovery
        const discoveryResults = await discoverServices({
          startPort,
          endPort,
          maxParallel: 5, // Limit concurrency to prevent overwhelming
        });

        // Get current bot information
        const currentPort = config.PORT || process.env.PORT || 3001;
        const currentBot = getCurrentBotInfo(currentPort);

        // Filter results if botsOnly is requested
        const services = botsOnly ? discoveryResults.botServices : discoveryResults.services;

        // Add legacy PM2/Docker discovery for comparison
        let legacyBots = [];
        try {
          const pm2Bots = await discoverPM2Bots();
          const dockerBots = await discoverDockerBots();

          const allLegacyBots = [...pm2Bots, ...dockerBots];
          const legacyHealthChecks = await Promise.allSettled(
            allLegacyBots.map(bot => checkBotHealth(bot.port, bot.botName, bot.name))
          );

          legacyBots = legacyHealthChecks
            .filter(result => result.status === 'fulfilled' && result.value.accessible)
            .map(result => result.value);
        } catch (legacyError) {
          logger.warn({ error: legacyError }, 'Legacy discovery failed');
        }

        // Combine and deduplicate results
        const allBots = [...services.filter(s => s.isBotService), ...legacyBots];
        const uniqueBots = allBots.reduce((unique, bot) => {
          const existing = unique.find(b => b.port === bot.port);
          if (!existing) {
            unique.push(bot);
          } else {
            // Merge information, preferring more detailed data
            Object.assign(existing, {
              ...existing,
              ...bot,
              // Combine confidence scores
              botConfidence: Math.max(existing.botConfidence || 0, bot.botConfidence || 0),
            });
          }
          return unique;
        }, []);

        return res.json({
          success: true,
          ...discoveryResults,
          services: services,
          botServices: uniqueBots,
          currentBot: {
            ...currentBot,
            url: `${req.protocol}://${req.get('host')}`,
          },
          discovery: {
            portRange: { start: startPort, end: endPort },
            botsOnly,
            legacyBotsFound: legacyBots.length,
            totalUniqueServices: services.length,
            totalUniqueBots: uniqueBots.length,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Error in comprehensive service discovery');
        return res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    /**
     * GET /settings
     * Returns application settings/configuration information
     *
     * @route GET /settings
     * @returns {Object} Settings data with validation status
     */
    app.get('/settings', async (req, res) => {
      logger.info('Getting application settings');

      try {
        // Import the config schema for reference
        const configPath = require.resolve('../core/configValidator');
        delete require.cache[configPath]; // Clear cache to get fresh schema
        const configModule = require('../core/configValidator.js');

        // Access the CONFIG_SCHEMA by re-requiring the file and looking at its internals
        // Since CONFIG_SCHEMA is not exported, we'll recreate the logic here
        const settings = [];

        // Define the schema locally (this could be extracted to a separate module if needed)
        const CONFIG_SCHEMA = {
          // Required variables
          DISCORD_TOKEN: { required: true, description: 'Discord Bot Token', sensitive: true },
          OPENAI_API_KEY: { required: true, description: 'OpenAI API Key', sensitive: true },
          CHANNEL_ID: {
            required: true,
            description: 'Channel IDs where the bot is allowed to respond',
          },

          // Optional variables
          CLIENT_ID: {
            required: false,
            description: 'Discord application client ID (required for slash commands)',
          },
          X_RAPIDAPI_KEY: {
            required: false,
            description: 'RapidAPI Key for weather and other external services',
            sensitive: true,
          },
          BOT_NAME: {
            required: false,
            description: 'Bot name for display purposes',
            default: 'ChimpGPT',
          },
          BOT_PERSONALITY: {
            required: false,
            description: 'Bot personality prompt',
            default: 'I am ChimpGPT, a helpful Discord bot.',
          },
          IGNORE_MESSAGE_PREFIX: {
            required: false,
            description: 'Messages starting with this prefix will be ignored',
            default: '.',
          },
          LOADING_EMOJI: {
            required: false,
            description: 'Discord emoji ID for loading animation',
            default: '⏳',
          },
          LOG_LEVEL: { required: false, description: 'Logging level', default: 'info' },
          NODE_ENV: { required: false, description: 'Node environment', default: 'development' },
          PORT: { required: false, description: 'Port for all services', default: '3001' },
          STATUS_HOSTNAME: {
            required: false,
            description: 'Hostname for remote access to status page',
            default: 'localhost',
          },
          OWNER_ID: {
            required: false,
            description: 'Discord user ID of the bot owner for status reports',
          },
          CORS_ALLOWED_ORIGINS: {
            required: false,
            description: 'Comma-separated list of allowed origins',
            default: 'http://localhost,http://127.0.0.1',
          },
          DEPLOY_COMMANDS: {
            required: false,
            description: 'Whether to deploy slash commands on bot startup',
            default: 'true',
          },
          ENABLE_IMAGE_GENERATION: {
            required: false,
            description: 'Enable or disable image generation feature',
            default: 'true',
          },
          STATUS_RATE_LIMIT_POINTS: {
            required: false,
            description: 'Maximum number of requests allowed per client',
            default: '60',
          },
          STATUS_RATE_LIMIT_DURATION: {
            required: false,
            description: 'Duration in seconds for rate limit window',
            default: '60',
          },
          ENABLE_REPLY_CONTEXT: {
            required: false,
            description: 'Whether to use message replies as context',
            default: 'true',
          },
          MAX_REFERENCE_DEPTH: {
            required: false,
            description: 'Maximum depth for message reference chains',
            default: '5',
          },
          MAX_REFERENCE_CONTEXT: {
            required: false,
            description: 'Maximum number of referenced messages to include',
            default: '5',
          },
          USE_BLENDED_CONVERSATIONS: {
            required: false,
            description: 'Whether to use blended conversations',
            default: 'true',
          },
          MAX_MESSAGES_PER_USER_BLENDED: {
            required: false,
            description: 'Maximum messages to keep per user in blended mode',
            default: '5',
          },
        };

        // Process each setting
        for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
          const envValue = process.env[key];
          const configValue = configModule[key];

          const setting = {
            key,
            description: schema.description,
            required: schema.required,
            hasDefault: schema.default !== undefined,
            defaultValue: schema.default,
            isSet: envValue !== undefined && envValue !== '',
            isValid: configValue !== undefined,
            isUsed: configValue !== undefined, // If it made it through validation, it's being used
            isSensitive: schema.sensitive || false,
          };

          // Show actual value for non-sensitive settings, mask sensitive ones
          if (setting.isSensitive) {
            setting.displayValue = setting.isSet ? '●●●●●●●●' : 'Not set';
            setting.actualValue = null; // Never expose sensitive values
          } else {
            setting.displayValue =
              configValue !== undefined
                ? String(configValue)
                : setting.hasDefault
                  ? setting.defaultValue
                  : 'Not set';
            setting.actualValue = configValue;
          }

          settings.push(setting);
        }

        // Sort settings: required first, then by alphabetical order
        settings.sort((a, b) => {
          if (a.required !== b.required) {
            return a.required ? -1 : 1;
          }
          return a.key.localeCompare(b.key);
        });

        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          environment: process.env.NODE_ENV || 'development',
          settings,
          summary: {
            total: settings.length,
            required: settings.filter(s => s.required).length,
            optional: settings.filter(s => !s.required).length,
            set: settings.filter(s => s.isSet).length,
            valid: settings.filter(s => s.isValid).length,
            sensitive: settings.filter(s => s.isSensitive).length,
          },
        });
      } catch (error) {
        logger.error({ error }, 'Error getting application settings');
        res.status(500).json({
          success: false,
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
