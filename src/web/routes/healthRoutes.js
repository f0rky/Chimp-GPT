/**
 * Health Routes
 * GET /health, /health/detailed, /version, /conversations/status, /api
 */

const { Router } = require('express');
const os = require('os');
const { createLogger } = require('../../core/logger');
const { getDetailedVersionInfo, formatUptime } = require('../../core/getBotVersion');
const { getConversationStorageStatus } = require('../../conversation/conversationManagerSelector');
const config = require('../../core/configValidator');

const logger = createLogger('healthRoutes');

/**
 * @param {{ stats: Object, statsStorage: Object }} deps
 */
function createRouter(deps) {
  const { stats, statsStorage } = deps;
  const router = Router();

  // GET /api — index of available endpoints
  router.get('/api', (req, res) => {
    res.json({
      endpoints: [
        '/health',
        '/health/detailed',
        '/version',
        '/conversations/status',
        '/function-results',
        '/function-results/summary',
        '/performance',
        '/performance/history/hourly',
        '/performance/history/daily',
        '/performance/history/recent',
        '/reset-stats',
        '/repair-stats',
        '/repair-function-results',
        '/blocked-users',
        '/unblock-user',
        '/api/discover-bots',
        '/api/discover-services',
        '/settings',
        '/run-tests',
      ],
    });
  });

  // GET /conversations/status
  router.get('/conversations/status', (req, res) => {
    try {
      const status = getConversationStorageStatus();
      res.json({ success: true, ...status, lastChecked: new Date().toISOString() });
    } catch (error) {
      logger.error({ error }, 'Error getting conversation storage status');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /health
  router.get('/health', async (req, res) => {
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

    const botName = persistentStats.name || config.BOT_NAME || process.env.BOT_NAME || 'ChimpGPT';
    const discordStats = persistentStats.discord || {};
    const discordStatus = typeof discordStats.status === 'string' ? discordStats.status : 'offline';
    const discordPing = typeof discordStats.ping === 'number' ? discordStats.ping : 0;
    const discordGuilds = typeof discordStats.guilds === 'number' ? discordStats.guilds : 0;
    const discordChannels = typeof discordStats.channels === 'number' ? discordStats.channels : 0;
    const versionInfo = getDetailedVersionInfo();

    res.json({
      status: discordStatus === 'ok' ? 'ok' : 'offline',
      name: botName,
      uptime,
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
      conversations: { ...getConversationStorageStatus(), lastChecked: new Date().toISOString() },
      conversationMode: {
        replyContext: config.ENABLE_REPLY_CONTEXT,
        mode: 'PocketFlow (Graph-based Architecture)',
        maxMessagesPerUser: parseInt(config.MAX_MESSAGES_PER_USER_BLENDED, 10) || 5,
      },
    });
  });

  // GET /health/detailed
  router.get('/health/detailed', async (req, res) => {
    try {
      const {
        detectLLMProviders,
        getServiceHealth,
        getEnvironmentConfig,
      } = require('../../commands/statusReport');
      const uptime = Math.floor((new Date() - stats.startTime) / 1000);
      const memoryUsage = process.memoryUsage();
      const persistentStats = await statsStorage.loadStats();
      const llmProviders = detectLLMProviders();
      const serviceHealth = await getServiceHealth(null);
      const envConfig = getEnvironmentConfig();

      const memUsed = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      const memTotal = Math.round(memoryUsage.heapTotal / 1024 / 1024);
      const memPercentage = Math.round((memUsed / memTotal) * 100);
      const memoryColor =
        memPercentage > 80
          ? 'red'
          : memPercentage > 60
            ? 'yellow'
            : memPercentage > 40
              ? 'blue'
              : 'green';

      const apiCallBreakdown = {
        total: Object.values(persistentStats.apiCalls || {}).reduce((a, b) => a + b, 0),
        openai: persistentStats.apiCalls?.openai || 0,
        dalle: persistentStats.apiCalls?.dalle || 0,
        weather: persistentStats.apiCalls?.weather || 0,
        search:
          (persistentStats.apiCalls?.serpapi || 0) +
          (persistentStats.apiCalls?.brave || 0) +
          (persistentStats.apiCalls?.duckduckgo || 0),
      };

      const totalErrors = Object.values(persistentStats.errors || {}).reduce((a, b) => a + b, 0);
      const errorRate =
        persistentStats.messageCount > 0
          ? ((totalErrors / persistentStats.messageCount) * 100).toFixed(2)
          : 0;

      res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        uptime: { seconds: uptime, formatted: formatUptime(uptime) },
        llmProviders: {
          primary: {
            ...llmProviders.primary,
            status: llmProviders.primary.configured ? 'online' : 'offline',
            health: llmProviders.primary.configured ? 100 : 0,
            color: llmProviders.primary.configured ? 'green' : 'red',
          },
          imageGeneration: {
            ...llmProviders.imageGeneration,
            status: llmProviders.imageGeneration.configured ? 'online' : 'offline',
            health: llmProviders.imageGeneration.configured ? 100 : 0,
            color: llmProviders.imageGeneration.configured ? 'green' : 'red',
          },
          searchEngines: llmProviders.searchEngines,
        },
        services: serviceHealth,
        environment: envConfig,
        performance: {
          memory: {
            used: memUsed,
            total: memTotal,
            percentage: memPercentage,
            color: memoryColor,
            formatted: `${memUsed}MB/${memTotal}MB`,
          },
          cpu: { usage: process.cpuUsage(), loadAvg: os.loadavg()[0].toFixed(2) },
          responseTime: { discord: serviceHealth.discord?.details?.ping || 0, trend: 'stable' },
        },
        statistics: {
          messages: persistentStats.messageCount || 0,
          apiCalls: apiCallBreakdown,
          errors: {
            total: totalErrors,
            rate: parseFloat(errorRate),
            breakdown: persistentStats.errors || {},
          },
          rateLimits: {
            count: persistentStats.rateLimits?.hit || 0,
            users: persistentStats.rateLimits?.userCounts || {},
          },
        },
        version: {
          bot: getDetailedVersionInfo().version,
          node: process.version,
          platform: process.platform,
        },
      });
    } catch (error) {
      logger.error('Error generating detailed health report:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to generate detailed health report',
        error: error.message,
      });
    }
  });

  // GET /version
  router.get('/version', (req, res) => {
    try {
      const versionInfo = getDetailedVersionInfo();
      const uptime = process.uptime();
      res.json({
        success: true,
        version: versionInfo.version,
        name: versionInfo.name,
        description: versionInfo.description,
        author: versionInfo.author,
        uptime,
        formattedUptime: formatUptime(uptime),
        nodeVersion: versionInfo.nodeVersion,
        platform: versionInfo.platform,
        environment: versionInfo.environment,
        memory: { rss: Math.round(versionInfo.memory / 1024 / 1024), unit: 'MB' },
        startTime: new Date(Date.now() - uptime * 1000).toISOString(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Error getting version information');
      res.status(500).json({ success: false, message: 'Error getting version information' });
    }
  });

  return router;
}

module.exports = { createRouter };
