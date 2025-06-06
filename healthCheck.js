/**
 * @typedef {Object} ApiCalls
 * @property {number} openai
 * @property {number} weather
 * @property {number} time
 * @property {number} wolfram
 * @property {number} quake
 * @property {number} gptimage
 * @property {Object.<string, number>} plugins
 *
 * @typedef {Object} PluginErrorInfo
 * @property {number} count - Total error count for this plugin
 * @property {Object.<string, number>} hooks - Error counts by hook name
 *
 * @typedef {Object} Errors
 * @property {number} openai
 * @property {number} discord
 * @property {number} weather
 * @property {number} time
 * @property {number} wolfram
 * @property {number} quake
 * @property {number} gptimage
 * @property {Object.<string, PluginErrorInfo>} plugins - Error counts by plugin ID with detailed hook information
 * @property {number} other
 *
 * @typedef {Object} RateLimits
 * @property {number} hit
 * @property {Set<string>} users
 *
 * @typedef {Object} PluginStats
 * @property {number} loaded
 * @property {number} commands
 * @property {number} functions
 * @property {number} hooks
 *
 * @typedef {Object} HealthStats
 * @property {Date} startTime
 * @property {number} messageCount
 * @property {ApiCalls} apiCalls
 * @property {Errors} errors
 * @property {Date} lastRestart
 * @property {RateLimits} rateLimits
 * @property {PluginStats} plugins
 *
 * @typedef {Object} HealthReport
 * @property {string} status
 * @property {number} uptime
 * @property {string} version
 * @property {Object} memory
 * @property {Object} system
 * @property {Object} stats
 * @property {Object} discord
 */
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
const cors = require('cors');
const { createLogger } = require('./logger');
const logger = createLogger('health');
const os = require('os');
const { version } = require('./package.json');
const { getLastDeploymentTimestamp } = require('./utils/deploymentManager');

// Track response times for latency calculation
const responseTimes = [];
const MAX_RESPONSE_TIMES = 100; // Track last 100 response times

// Track system metrics over time
const systemMetrics = {
  memory: [],
  cpu: [],
  load: [],
  timestamps: [],
};
const MAX_METRICS = 60; // Store last minute of data (assuming 1s interval)

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
 * @property {Object} customStats - Custom statistics
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
    plugins: {},
  },
  customStats: {},

  errors: {
    openai: 0,
    discord: 0,
    discordHooks: {}, // Track command-specific Discord errors
    weather: 0,
    time: 0,
    wolfram: 0,
    quake: 0,
    gptimage: 0,
    plugins: {},
    other: 0,
  },
  lastRestart: new Date(),
  rateLimits: {
    hit: 0,
    users: new Set(),
  },
  plugins: {
    loaded: 0,
    commands: 0,
    functions: 0,
    hooks: 0,
  },
};

/**
 * Initialize the health check system.
 *
 * Sets up an Express server for health monitoring endpoints and schedules periodic health reports to be sent to the bot owner.
 *
 * @param {import('discord.js').Client} client - Discord.js client instance
 * @returns {{ app: import('express').Application, stats: HealthStats }} Object containing the Express app and stats tracking object
 */
function initHealthCheck(client) {
  const app = express();
  const path = require('path');

  // Determine port for CORS configuration (must be done before app.use(cors(...)))
  const nodeEnvForPort = process.env.NODE_ENV || 'development';
  let currentPort;
  if (nodeEnvForPort === 'production') {
    currentPort = config.PORT || 3001;
  } else {
    currentPort = config.PORT || 3001;
  }

  const allowedOrigins = [`http://localhost:${currentPort}`, `http://127.0.0.1:${currentPort}`];

  if (config.STATUS_HOSTNAME) {
    allowedOrigins.push(`http://${config.STATUS_HOSTNAME}:${currentPort}`);
  }

  const corsOptions = {
    origin: function (origin, callback) {
      // In development, allow all origins for easier development
      if (nodeEnvForPort !== 'production') {
        return callback(null, true);
      }

      // In production, only allow specific origins
      if (!origin) return callback(null, true); // Allow requests with no origin (like mobile apps or curl requests)
      if (allowedOrigins.indexOf(origin) !== -1) {
        return callback(null, true);
      }
      logger.warn({ origin, allowedOrigins }, 'CORS: Blocked an origin');
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true, // If you need to handle cookies or authorization headers
  };

  app.use(cors(corsOptions));
  app.use(express.json()); // Middleware to parse JSON bodies

  // Serve static files from the public directory
  app.use(express.static(path.join(__dirname, 'public')));

  // Basic info endpoint
  app.get('/api', (req, res) => {
    res.json({
      name: 'ChimpGPT',
      status: 'online',
      version,
    });
  });

  // Circuit Breaker API Endpoints (Placeholders)
  app.get('/api/breaker/status', (req, res) => {
    // In a real implementation, you'd fetch the actual breaker status
    res.json({
      breakerOpen: false, // Example status
      pendingRequests: [], // Example pending requests
    });
  });

  app.post('/api/breaker/reset', (req, res) => {
    // In a real implementation, you'd handle the owner token and reset logic
    logger.info({ body: req.body }, 'Received POST to /api/breaker/reset');
    res.json({ success: true, message: 'Breaker reset request received (placeholder).' });
  });

  app.post('/api/breaker/approve', (req, res) => {
    // In a real implementation, you'd handle the owner token and approval/denial logic
    logger.info({ body: req.body }, 'Received POST to /api/breaker/approve');
    res.json({ success: true, message: 'Breaker approval/denial request received (placeholder).' });
  });

  // Detailed health check endpoint
  app.get('/function-results', (req, res) => {
    const functionResults =
      stats.customStats && stats.customStats.functionResults
        ? stats.customStats.functionResults
        : {};
    res.json(functionResults);
  });

  app.get('/health', (req, res) => {
    // Track request start time for latency calculation
    req._startTime = Date.now();
    try {
      const uptime = Math.floor((new Date() - stats.startTime) / 1000);
      const memoryUsage = process.memoryUsage();

      // Calculate average response time
      const avgResponseTime =
        responseTimes.length > 0
          ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
          : 0;

      // Get current timestamp for metrics
      const now = new Date();

      // Add current metrics to history
      systemMetrics.memory.push(process.memoryUsage().heapUsed);
      systemMetrics.cpu.push(process.cpuUsage().user);
      systemMetrics.load.push(os.loadavg()[0]);
      systemMetrics.timestamps.push(now);

      // Keep only the most recent metrics
      if (systemMetrics.memory.length > MAX_METRICS) {
        systemMetrics.memory.shift();
        systemMetrics.cpu.shift();
        systemMetrics.load.shift();
        systemMetrics.timestamps.shift();
      }

      const health = {
        status: 'ok',
        name: client.user?.username || 'ChimpGPT',
        uptime: uptime,
        version: version,
        metrics: {
          responseTime: {
            current: Date.now() - req._startTime,
            average: avgResponseTime,
            min: responseTimes.length > 0 ? Math.min(...responseTimes) : 0,
            max: responseTimes.length > 0 ? Math.max(...responseTimes) : 0,
          },
          system: {
            memory: systemMetrics.memory,
            cpu: systemMetrics.cpu,
            load: systemMetrics.load,
            timestamps: systemMetrics.timestamps.map(t => t.toISOString()),
          },
        },
        debug: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
          uptime: process.uptime(),
          env: process.env.NODE_ENV || 'development',
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
          messageCount: stats.messageCount,
          apiCalls: stats.apiCalls,
          errors: stats.errors,
          rateLimits: {
            count:
              stats.rateLimits && typeof stats.rateLimits.hit === 'number'
                ? stats.rateLimits.hit
                : 0,
            uniqueUsers:
              stats.rateLimits &&
              stats.rateLimits.users &&
              typeof stats.rateLimits.users.size === 'number'
                ? stats.rateLimits.users.size
                : 0,
            userDetails:
              stats.rateLimits && stats.rateLimits.users ? Array.from(stats.rateLimits.users) : [],
          },
        },
        discord: {
          ping: client.ws.ping,
          status: client.ws.status === 0 ? 'online' : 'issues',
          guilds: client.guilds.cache.size,
          channels: client.channels.cache.size,
        },
      };

      // Add slash command deployment info
      try {
        // Remove async/await since we're not using it here
        const lastDeploymentMs = getLastDeploymentTimestamp();
        let nextCheckEstimate = 'N/A';
        const autoDeployEnabled =
          config.DEPLOY_COMMANDS === true || config.DEPLOY_COMMANDS === 'true';

        if (lastDeploymentMs) {
          try {
            const nextCheckDate = new Date(lastDeploymentMs + 12 * 60 * 60 * 1000);
            nextCheckEstimate =
              autoDeployEnabled && !isNaN(nextCheckDate.getTime())
                ? nextCheckDate.toISOString()
                : 'Disabled or invalid date';
          } catch (e) {
            console.error('Error calculating next check date:', e);
            nextCheckEstimate = 'Error calculating';
          }
        }

        health.slashCommands = {
          lastDeployed:
            lastDeploymentMs && !isNaN(new Date(lastDeploymentMs).getTime())
              ? new Date(lastDeploymentMs).toISOString()
              : 'Never or Unknown',
          nextScheduledCheck: nextCheckEstimate,
          autoDeployEnabled: autoDeployEnabled,
        };
      } catch (err) {
        logger.error({ err }, 'Error fetching slash command deployment info for /health endpoint');
        health.slashCommands = {
          lastDeployed: 'Error fetching',
          nextScheduledCheck: 'Error fetching',
          autoDeployEnabled: config.DEPLOY_COMMANDS === true || config.DEPLOY_COMMANDS === 'true',
          error: 'Failed to retrieve deployment timestamps',
        };
      }

      // Check if any error counts are high
      const errorSum = calculateTotalErrors(stats.errors);
      if (errorSum > 20 || (stats.errors.openai || 0) > 10) {
        health.status = 'warning';
      }

      // Calculate response time and add to history
      const responseTime = Date.now() - req._startTime;
      responseTimes.push(responseTime);
      if (responseTimes.length > MAX_RESPONSE_TIMES) {
        responseTimes.shift();
      }

      // Add current response time to the health object
      health.metrics.responseTime.current = responseTime;

      res.json(health);
    } catch (err) {
      logger.error({ err }, 'Critical error in /health endpoint');
      res.status(500).json({
        status: 'error',
        message: 'Server error while fetching health data.',
        error: err.message,
      });
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
        quakeServerStats: quakeResults,
      });
    } catch (error) {
      logger.error({ error }, 'Error running tests');
      res.status(500).json({ error: 'Failed to run tests' });
    }
  });

  // Start the server
  // Determine which port to use based on environment
  const nodeEnv = process.env.NODE_ENV || 'development';
  let PORT;

  if (nodeEnv === 'production') {
    PORT = config.PORT || 3001;
  } else {
    PORT = config.PORT || 3001;
  }

  const LISTEN_ADDRESS = '0.0.0.0';
  const DISPLAY_HOSTNAME = config.STATUS_HOSTNAME || 'localhost';

  app.listen(PORT, LISTEN_ADDRESS, () => {
    logger.info(
      `Health check server running at http://${DISPLAY_HOSTNAME}:${PORT}/ (listening on ${LISTEN_ADDRESS}:${PORT} in ${nodeEnv} mode)`
    );
  });

  // Schedule periodic health reports to owner
  if (config.OWNER_ID) {
    scheduleHealthReports(client);
  }

  return { app, stats };
}

/**
 * Schedule periodic health reports to be sent to the bot owner.
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

  // Use the startup message coordinator for startup notifications
  const startupCoordinator = require('./utils/startupMessageCoordinator');

  // Register health check as a component that will contribute to the startup message
  startupCoordinator.registerComponent('healthCheck');

  // Send the startup message after a short delay
  setTimeout(async () => {
    try {
      if (config.OWNER_ID) {
        const owner = await client.users.fetch(config.OWNER_ID);
        if (owner) {
          // Send the initial startup message if not already sent
          if (!startupCoordinator.hasMessage) {
            await startupCoordinator.sendStartupMessage(owner);
          }

          // Wait a bit to gather more startup information
          setTimeout(async () => {
            try {
              // Import the greeting manager to get system information
              const greetingManager = require('./utils/greetingManager');
              const report = generateHealthReport(true);
              const botVersionInfo = require('./getBotVersion').getBotVersion();

              // Generate the system information embed
              try {
                const systemEmbed = greetingManager.generateStartupReport();
                // Update the color to match our success theme
                systemEmbed.setColor(0x00ff00);
                startupCoordinator.addEmbed('greetingManager', systemEmbed);
              } catch (err) {
                logger.error({ error: err }, 'Failed to generate system information embed');
              }

              // Add health data as a second embed
              startupCoordinator.addEmbed('healthCheck', {
                title: '📊 Detailed Health Information',
                description: report,
                color: 0x00ff00, // Green color for success
                timestamp: new Date(),
                footer: {
                  text: `ChimpGPT v${version}`,
                },
              });

              // Update the startup message with all embeds
              await startupCoordinator.updateStartupMessage();
              logger.info('Updated startup message with comprehensive report');

              // Reset the coordinator after some time to free memory
              setTimeout(() => {
                startupCoordinator.reset();
              }, 10000);
            } catch (updateError) {
              logger.error({ error: updateError }, 'Failed to update startup message with details');
            }
          }, 5000); // Wait 5 seconds before updating with details
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to send startup health report to owner');
    }
  }, 10000); // Wait 10 seconds after startup
}

/**
 * Generate a health report message.
 *
 * Creates a formatted report containing:
 * - Bot uptime and version
 * - Memory usage statistics
 * - API call counts by service
 * - Error counts by service
 * - Rate limiting statistics
 *
 * @param {boolean} isStartup - Whether this is a startup report
 * @returns {string} Formatted health report as a Markdown string
 */
function generateHealthReport(isStartup = false) {
  const uptime = Math.floor((new Date() - stats.startTime) / 1000);
  const memoryUsage = process.memoryUsage();
  const { getBotVersion: getVersion } = require('./getBotVersion');
  const botVersion = getVersion();
  const osModule = require('os');
  const hostname = osModule.hostname();
  const fs = require('fs');
  const path = require('path');

  // Get recent logs if available
  const getRecentLogs = (maxLines = 10) => {
    try {
      const logFilePath = path.join(__dirname, './logs/chimp-gpt.log');
      if (fs.existsSync(logFilePath)) {
        const data = fs.readFileSync(logFilePath, 'utf8');
        const lines = data.trim().split('\n');
        return lines.slice(-maxLines).join('\n');
      }
      return 'No recent logs available.';
    } catch (err) {
      return `Error reading logs: ${err.message}`;
    }
  };

  // Get loaded plugins information
  const getLoadedPlugins = () => {
    try {
      const pluginManager = require('./pluginManager');
      if (pluginManager && pluginManager.getPluginMetadata) {
        const plugins = Object.values(pluginManager.getPluginMetadata());
        if (plugins.length === 0) return 'No plugins loaded.';

        // Format each plugin on its own line with a bullet point
        return '\n' + plugins.map(p => `  • ${p.name}@${p.version}`).join('\n') || 'None';
      }
      return 'None';
    } catch (err) {
      return 'Plugin information unavailable';
    }
  };

  let title = '📊 ChimpGPT Health Report';
  if (isStartup) {
    title = '🚀 ChimpGPT Started Successfully';
  }

  const errorSum = calculateTotalErrors(stats.errors);
  let statusEmoji = '✅';
  if (errorSum > 20 || stats.errors.openai > 10) {
    statusEmoji = '⚠️';
  }

  // Format plugin API calls if any exist
  let pluginApiCallsText = '';
  if (Object.keys(stats.apiCalls.plugins).length > 0) {
    pluginApiCallsText = '\n**Plugin API Calls:**\n';
    for (const [pluginId, count] of Object.entries(stats.apiCalls.plugins)) {
      pluginApiCallsText += `• ${pluginId}: ${count}\n`;
    }
  }

  // Format plugin errors if any exist
  let pluginErrorsText = '';
  if (Object.keys(stats.errors.plugins).length > 0) {
    pluginErrorsText = '\n**Plugin Errors:**\n';
    for (const [pluginId, errorInfo] of Object.entries(stats.errors.plugins)) {
      // Add the total count for the plugin
      pluginErrorsText += `• **${pluginId}**: ${errorInfo.count} error(s)\n`;

      // Add detailed command/hook errors if available
      if (errorInfo.hooks && Object.keys(errorInfo.hooks).length > 0) {
        for (const [hookName, count] of Object.entries(errorInfo.hooks)) {
          // Format command/hook names to be more readable
          let displayName = hookName;
          if (hookName.startsWith('command:')) {
            displayName = `Command: ${hookName.replace('command:', '')}`;
          } else if (hookName.startsWith('slash:')) {
            displayName = `Slash Command: ${hookName.replace('slash:', '')}`;
          } else if (hookName.startsWith('hook:')) {
            displayName = `Hook: ${hookName.replace('hook:', '')}`;
          }
          pluginErrorsText += `  ↳ ${displayName}: ${count} error(s)\n`;
        }
      }
    }
  }

  // Format the report with proper Markdown
  let report = `# 🚀 ${config.BOT_NAME} Health Report\n`;
  report += `**Status:** ${isStartup ? 'Starting Up' : 'Running'}\n`;
  report += `**Version:** ${botVersion}\n`;
  report += `**Uptime:** ${formatDuration(uptime)}\n`;
  report += `**Memory:** ${Math.round(memoryUsage.rss / 1024 / 1024)} MB\n`;
  if (isStartup) {
    report += `**Version:** ${botVersion}\n`;
    report += `**Hostname:** ${hostname}\n`;
  }

  report += `\n**Statistics:**\n`;
  report += `• Messages Processed: ${stats.messageCount}\n`;
  report += `• OpenAI API Calls: ${stats.apiCalls.openai}\n`;
  report += `• Weather API Calls: ${stats.apiCalls.weather}\n`;
  report += `• Time Lookups: ${stats.apiCalls.time}\n`;
  report += `• Wolfram Alpha Queries: ${stats.apiCalls.wolfram}\n`;
  report += `• Quake Server Lookups: ${stats.apiCalls.quake}\n`;
  report += `• GPT Image-1 Generations: ${stats.apiCalls.gptimage}\n\n`;
  report += `**Plugin System:**\n`;
  report += `• Loaded Plugins: ${stats.plugins.loaded}\n`;
  report += `• Plugin Commands: ${stats.plugins.commands}\n`;
  report += `• Plugin Functions: ${stats.plugins.functions}\n`;
  report += `• Plugin Hooks: ${stats.plugins.hooks}`;
  report += pluginApiCallsText;

  if (isStartup) {
    report += `\n• Plugin Details: ${getLoadedPlugins()}`;
  }

  // Add errors section
  report += `\n**Errors:**\n`;
  report += `• Total Errors: ${calculateTotalErrors(stats.errors)}\n`;
  report += `• OpenAI Errors: ${stats.errors.openai}\n`;

  // Add detailed Discord command errors if any
  let discordCommandErrors = '';
  if (stats.errors.discordHooks) {
    const commandErrors = [];
    const slashCommandErrors = [];

    // Categorize the hooks
    for (const [hookName, count] of Object.entries(stats.errors.discordHooks)) {
      if (hookName.startsWith('command:')) {
        commandErrors.push(`${hookName.replace('command:', '')}: ${count}`);
      } else if (hookName.startsWith('slash:')) {
        slashCommandErrors.push(`/${hookName.replace('slash:', '')}: ${count}`);
      }
    }

    // Format the command errors if any exist
    if (commandErrors.length > 0) {
      discordCommandErrors += `  ↳ Commands: ${commandErrors.join(', ')}\n`;
    }
    if (slashCommandErrors.length > 0) {
      discordCommandErrors += `  ↳ Slash Commands: ${slashCommandErrors.join(', ')}\n`;
    }
  }

  report += `• Discord Errors: ${stats.errors.discord}${discordCommandErrors ? '\n' + discordCommandErrors : ''}\n`;
  report += `• Other API Errors: ${stats.errors.weather + stats.errors.time + stats.errors.wolfram + stats.errors.quake + stats.errors.gptimage}${pluginErrorsText}\n\n`;

  // Add rate limiting section
  report += `**Rate Limiting:**\n`;
  report += `• Rate Limits Hit: ${stats.rateLimits.hit}\n`;
  report += `• Unique Users Limited: ${stats.rateLimits.users.size}\n\n`;

  // Add footer with commands
  report += `For more details, use one of these commands: 'stats', '!stats', '.stats', or '/stats'`;

  // Add status page and logs if it's a startup report
  if (isStartup) {
    const determinedStatusPort = config.PORT || 3001;
    const actualHostname = process.env.STATUS_HOSTNAME || 'localhost'; // Fallback just in case, though configValidator should ensure it's set
    report += `\n\n**Status Page:** http://${actualHostname}:${determinedStatusPort}`;
    report += `\n\n**Recent Logs:**\n\`\`\`\n${getRecentLogs(15)}\n\`\`\``;
  }

  return report;
}

/**
 * Check if a message is a stats command.
 *
 * Determines if a message content matches any of the supported formats for the stats command (e.g., /stats, !stats, etc.)
 *
 * @param {import('discord.js').Message} message - Discord message
 * @returns {boolean} Whether the message is a stats command
 */
function isStatsCommand(message) {
  if (!message || !message.content) return false;
  const content = message.content.toLowerCase();
  // Check for various ways to call the stats command, including slash commands
  // and common prefixes like !, ., /.
  return (
    content.startsWith('/stats') ||
    content.startsWith('!stats') ||
    content.startsWith('.stats') ||
    content === 'stats'
  );
}

/**
 * Handle a stats command.
 *
 * Processes a stats command request, generates a health report, and sends it as a reply to the message.
 * Also updates the startup message if it exists and the user is the bot owner.
 *
 * @param {import('discord.js').Message} message - Discord message
 * @returns {Promise<void>} Resolves when the reply is sent
 */
async function handleStatsCommand(message) {
  logger.info(
    {
      userId: message.author.id,
      command: message.content,
      isOwner: message.author.id === config.OWNER_ID,
    },
    'Stats command used'
  );

  const report = generateHealthReport();
  await message.reply(report);

  // If the user is the owner, also update the startup message with the latest health report
  if (message.author.id === config.OWNER_ID) {
    try {
      // Get the startup message coordinator
      const startupCoordinator = require('./utils/startupMessageCoordinator');

      // If the coordinator has a message reference, update it
      if (startupCoordinator.hasMessage && startupCoordinator.messageRef) {
        const botVersion = require('./getBotVersion').getBotVersion();

        // Update the health check embed with the latest report
        startupCoordinator.addEmbed('healthCheck', {
          title: '📊 Updated Health Information',
          description: report,
          color: 0x00ff00, // Green color for success
          timestamp: new Date(),
          footer: {
            text: `ChimpGPT v${botVersion} | Updated at ${new Date().toLocaleTimeString()}`,
          },
        });

        // Update the startup message with the latest embeds
        await startupCoordinator.updateStartupMessage();
        logger.info('Updated startup message with latest health report');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to update startup message with latest health report');
    }
  }
}

/**
 * Format a duration in seconds to a human-readable string.
 *
 * Converts a duration in seconds to a formatted string showing days, hours, minutes, and seconds as appropriate.
 *
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration string (e.g., "2d 5h 30m 15s")
 */
function formatDuration(seconds) {
  let remainingSeconds = seconds;
  const days = Math.floor(remainingSeconds / 86400);
  remainingSeconds %= 86400;
  const hours = Math.floor(remainingSeconds / 3600);
  remainingSeconds %= 3600;
  const minutes = Math.floor(remainingSeconds / 60);
  remainingSeconds %= 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`);

  return parts.join(' ');
}

/**
 * Track an API call.
 *
 * Increments the counter for a specific API call type. Used for monitoring API usage across different services.
 *
 * @param {string} type - Type of API call (openai, weather, time, wolfram, quake, gptimage)
 * @param {string} [pluginId] - Optional plugin ID if the call is from a plugin
 * @returns {void}
 */
function trackApiCall(type, pluginId) {
  if (pluginId) {
    // Track plugin API call
    if (!stats.apiCalls.plugins[pluginId]) {
      stats.apiCalls.plugins[pluginId] = 0;
    }
    stats.apiCalls.plugins[pluginId]++;
    // Also store in persistent storage
    statsStorage.incrementStat(`apiCalls.plugins.${pluginId}`);
  } else if (stats.apiCalls[type] !== undefined) {
    // Track regular API call
    stats.apiCalls[type]++;
    // Also store in persistent storage
    statsStorage.incrementStat(`apiCalls.${type}`);
  }
}

/**
 * Track an error.
 *
 * Increments the counter for a specific error type. Used for monitoring error rates across different services.
 *
 * @param {string} type - Type of error (openai, discord, weather, time, wolfram, quake, gptimage, other)
 * @param {string} [pluginId] - Optional plugin ID if the error is from a plugin
 * @returns {void}
 */
/**
 * Track an error occurrence.
 *
 * @param {string} type - The type of error (e.g., 'openai', 'plugins', 'weather')
 * @param {string} [pluginId] - Optional plugin ID if this is a plugin error
 * @param {string} [hookName] - Optional hook name for more granular plugin error tracking
 * @returns {void}
 */
function trackError(type, pluginId, hookName) {
  try {
    if (pluginId) {
      // Track plugin error
      if (!stats.errors.plugins[pluginId]) {
        stats.errors.plugins[pluginId] = {
          count: 0,
          hooks: {},
        };
      }

      // Increment the plugin error count
      stats.errors.plugins[pluginId].count++;

      // Track specific hook errors if provided
      if (hookName) {
        if (!stats.errors.plugins[pluginId].hooks[hookName]) {
          stats.errors.plugins[pluginId].hooks[hookName] = 0;
        }
        stats.errors.plugins[pluginId].hooks[hookName]++;

        // Store in persistent storage with hook information
        statsStorage.incrementStat(`errors.plugins.${pluginId}.hooks.${hookName}`);
      }

      // Also store the overall plugin error count in persistent storage
      statsStorage.incrementStat(`errors.plugins.${pluginId}.count`);
    } else if (type === 'discord' && hookName) {
      // Track Discord command/hook errors separately
      if (!stats.errors.discordHooks) {
        stats.errors.discordHooks = {};
      }

      // Initialize the hook counter if it doesn't exist
      if (!stats.errors.discordHooks[hookName]) {
        stats.errors.discordHooks[hookName] = 0;
      }

      // Increment the hook counter
      stats.errors.discordHooks[hookName]++;

      // Also increment the general Discord error counter
      stats.errors.discord++;

      // Store in persistent storage
      statsStorage.incrementStat(`errors.discordHooks.${hookName}`);
      statsStorage.incrementStat('errors.discord');
    } else if (stats.errors[type] !== undefined) {
      // Track regular error
      stats.errors[type]++;
      // Also store in persistent storage
      statsStorage.incrementStat(`errors.${type}`);
    } else {
      // Track other error
      stats.errors.other++;
      // Also store in persistent storage
      statsStorage.incrementStat('errors.other');
    }
  } catch (error) {
    logger.error({ error, type, pluginId, hookName }, 'Error in trackError');
  }
}

/**
 * Track a rate limit hit.
 *
 * Records when a user hits a rate limit. Tracks both the total count and the unique users who have been rate limited.
 *
 * @param {string} userId - Discord user ID
 * @returns {void}
 */
function trackRateLimit(userId) {
  stats.rateLimits.hit++;
  // Ensure users is always a Set
  if (!stats.rateLimits.users || typeof stats.rateLimits.users.add !== 'function') {
    stats.rateLimits.users = new Set(
      stats.rateLimits.users ? Array.from(stats.rateLimits.users) : []
    );
  }
  stats.rateLimits.users.add(userId);
  // Also store in persistent storage
  statsStorage.incrementStat('rateLimits.hit');
  statsStorage.addRateLimitedUser(userId);
}

/**
 * Track a message.
 *
 * Increments the message counter in the stats object. Used to monitor overall bot usage.
 *
 * @returns {void}
 */
function trackMessage() {
  stats.messageCount++;
  // Also store in persistent storage
  statsStorage.incrementStat('messageCount');
}

/**
 * Update plugin statistics.
 *
 * Updates the statistics for loaded plugins, commands, functions, and hooks. Called when plugins are loaded or updated.
 *
 * @param {PluginStats} pluginStats - Object containing plugin statistics
 * @returns {Promise<void>} Resolves when stats are updated
 */
async function updatePluginStats(pluginStats) {
  if (!pluginStats) return;

  stats.plugins.loaded = pluginStats.loaded || 0;
  stats.plugins.commands = pluginStats.commands || 0;
  stats.plugins.functions = pluginStats.functions || 0;
  stats.plugins.hooks = pluginStats.hooks || 0;

  // Also store in persistent storage (asynchronously)
  await statsStorage.updateStat('plugins.loaded', stats.plugins.loaded);
  await statsStorage.updateStat('plugins.commands', stats.plugins.commands);
  await statsStorage.updateStat('plugins.functions', stats.plugins.functions);
  await statsStorage.updateStat('plugins.hooks', stats.plugins.hooks);
}

/**
 * Track a plugin function call.
 *
 * Records a function call from a plugin in the function results system.
 *
 * @param {string} pluginId - ID of the plugin making the function call
 * @param {string} functionName - Name of the function being called
 * @param {Object} params - Parameters passed to the function
 * @param {Object} result - Result of the function call
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function trackPluginFunctionCall(pluginId, functionName, params, result) {
  try {
    // Track API call for this plugin
    trackApiCall('plugins', pluginId);

    // Store in function results
    const functionResults = require('./functionResults');
    try {
      return await functionResults.storeResult(
        `plugin.${pluginId}`,
        {
          function: functionName,
          ...params,
        },
        result
      );
    } catch (storeError) {
      // Check if this is a JSON parsing error
      if (storeError instanceof SyntaxError && storeError.message.includes('JSON')) {
        logger.warn(
          { error: storeError },
          'JSON parsing error in function results, attempting repair'
        );

        // Attempt to repair the function results file
        const repaired = await functionResults.repairResultsFile();

        if (repaired) {
          logger.info('Function results file repaired successfully, retrying store operation');
          // Retry the store operation
          return await functionResults.storeResult(
            `plugin.${pluginId}`,
            {
              function: functionName,
              ...params,
            },
            result
          );
        }
        logger.error('Failed to repair function results file');
        return false;
      }

      // Re-throw other errors
      throw storeError;
    }
  } catch (error) {
    logger.error({ error, pluginId, functionName }, 'Failed to track plugin function call');
    return false;
  }
}

/**
 * Get the current health status of the bot
 *
 * This function returns a simplified version of the health statistics
 * suitable for display in status reports and monitoring dashboards.
 *
 * @returns {Object} Object containing key health metrics
 */
function getHealthStatus() {
  return {
    uptime: Math.floor((new Date() - stats.startTime) / 1000), // uptime in seconds
    messagesProcessed: stats.messageCount,
    apiCalls: Object.values(stats.apiCalls).reduce((sum, val) => {
      if (typeof val === 'number') return sum + val;
      return sum;
    }, 0),
    errors: Object.values(stats.errors).reduce((sum, val) => {
      if (typeof val === 'number') return sum + val;
      return sum;
    }, 0),
    rateLimits: stats.rateLimits.hit,
    lastRestart: stats.lastRestart,
    startTime: stats.startTime,
  };
}

/**
 * Add a custom stats source to the health check system
 *
 * This allows external modules to contribute statistics that will be included
 * in health reports and exposed via the status API.
 *
 * @param {string} name - The name of the stats source
 * @param {Function} dataFn - Function that returns the stats data when called
 * @returns {void}
 */
function addCustomStatsSource(name, dataFn) {
  if (!name || typeof name !== 'string') {
    throw new Error('Custom stats source name must be a non-empty string');
  }

  if (typeof dataFn !== 'function') {
    throw new Error('Custom stats source must provide a data function');
  }

  // Store the data provider function
  stats.customStats[name] = dataFn;

  // Log the registration
  logger.info({ statSource: name }, 'Custom stats source registered');
}

/**
 * Calculate the total error count properly, avoiding "[object Object]" issues
 * by separating numeric error properties from complex objects
 *
 * @param {Object} errors - The stats.errors object
 * @returns {number} The total error count
 */
function calculateTotalErrors(errors) {
  // Initialize with 0 for safety if properties are undefined
  const basicErrors =
    (errors.openai || 0) +
    (errors.discord || 0) +
    (errors.weather || 0) +
    (errors.time || 0) +
    (errors.wolfram || 0) +
    (errors.quake || 0) +
    (errors.gptimage || 0) +
    (errors.other || 0);

  // Calculate plugin errors separately
  let pluginErrors = 0;
  if (errors.plugins && typeof errors.plugins === 'object') {
    // Handle the case where plugins is an object with plugin IDs as keys
    Object.values(errors.plugins).forEach(plugin => {
      if (plugin && typeof plugin === 'object' && typeof plugin.count === 'number') {
        pluginErrors += plugin.count;
      } else if (typeof plugin === 'number') {
        pluginErrors += plugin;
      }
    });
  }

  return basicErrors + pluginErrors;
}

module.exports = {
  initHealthCheck,
  trackApiCall,
  trackError,
  trackMessage,
  trackRateLimit,
  isStatsCommand,
  handleStatsCommand,
  updatePluginStats,
  trackPluginFunctionCall,
  generateHealthReport,
  stats,
  getHealthStatus,
  calculateTotalErrors,
  addCustomStatsSource,
};
