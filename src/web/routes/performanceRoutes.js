/**
 * Performance Routes
 * GET /performance, /performance/history/*, POST /reset-stats, /repair-stats, /repair-function-results
 */

const { Router } = require('express');
const { createLogger } = require('../../core/logger');

const logger = createLogger('performanceRoutes');

/**
 * @param {{ stats: Object, statsStorage: Object, functionResults: Object, performanceHistory: Object, serverState: Object }} deps
 */
function createRouter(deps) {
  const { stats, statsStorage, functionResults, performanceHistory, serverState } = deps;
  const router = Router();

  // GET /performance
  router.get('/performance', (req, res) => {
    try {
      const performanceMonitor = require('../../middleware/performanceMonitor');
      let metrics = {};
      try {
        metrics = performanceMonitor.getAllTimingStats() || {};
      } catch (statsError) {
        logger.error({ error: statsError }, 'Error retrieving performance stats');
        metrics = { error: 'Failed to retrieve performance metrics' };
        serverState.lastError = statsError;
        serverState.healthy = false;
      }

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

      const memUsage = process.memoryUsage();
      const responseData = {
        success: true,
        summary,
        detailed: metrics,
        serverHealth: {
          status: serverState.healthy ? 'healthy' : 'degraded',
          lastError: serverState.lastError ? serverState.lastError.message : null,
          memory: {
            rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
            heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
            heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
            external: `${Math.round(memUsage.external / 1024 / 1024)} MB`,
          },
        },
        timestamp: new Date().toISOString(),
      };

      try {
        performanceHistory.addMetric(responseData);
      } catch (historyError) {
        logger.error({ error: historyError }, 'Error storing performance history');
      }

      res.json(responseData);
    } catch (error) {
      logger.error({ error }, 'Critical error getting performance metrics');
      serverState.lastError = error;
      serverState.healthy = false;
      res
        .status(500)
        .json({ success: false, error: error.message, serverHealth: { status: 'critical' } });
    }
  });

  // GET /performance/history/hourly
  router.get('/performance/history/hourly', (req, res) => {
    const hours = Math.min(parseInt(req.query.hours, 10) || 24, 168);
    try {
      res.json({
        success: true,
        hours,
        data: performanceHistory.getHourlyData(hours),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Error getting hourly performance history');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /performance/history/daily
  router.get('/performance/history/daily', (req, res) => {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    try {
      res.json({
        success: true,
        days,
        data: performanceHistory.getDailyData(days),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Error getting daily performance history');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /performance/history/recent
  router.get('/performance/history/recent', (req, res) => {
    const minutes = Math.min(parseInt(req.query.minutes, 10) || 60, 1440);
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
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /reset-stats
  router.post('/reset-stats', async (req, res) => {
    try {
      const success = await statsStorage.resetStats();
      if (success) {
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

  // POST /repair-stats
  router.post('/repair-stats', async (req, res) => {
    try {
      const repairResult = await statsStorage.repairStatsFile();
      if (repairResult) {
        res.json({ success: true, message: 'Stats file repaired successfully' });
      } else {
        res.status(500).json({ success: false, message: 'Failed to repair stats file' });
      }
    } catch (error) {
      logger.error({ error }, 'Error repairing stats file');
      res
        .status(500)
        .json({ success: false, error: 'Error repairing stats file: ' + error.message });
    }
  });

  // POST /repair-function-results
  router.post('/repair-function-results', async (req, res) => {
    try {
      const functionResultsModule = require('../../core/functionResults');
      const repairResult = await functionResultsModule.repairResultsFile();
      if (repairResult) {
        res.json({ success: true, message: 'Function results file repaired successfully' });
      } else {
        res.status(500).json({ success: false, message: 'Failed to repair function results file' });
      }
    } catch (error) {
      logger.error({ error }, 'Error during function results file repair');
      res.status(500).json({
        success: false,
        message: 'Error during function results file repair',
        error: error.message,
      });
    }
  });

  // GET /function-results
  let lastLoggedTime = 0;
  const LOG_INTERVAL_MS = 60000;
  router.get('/function-results', async (req, res) => {
    const now = Date.now();
    if (now - lastLoggedTime > LOG_INTERVAL_MS) {
      logger.debug('Getting function results');
      lastLoggedTime = now;
    }
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const skip = parseInt(req.query.skip, 10) || 0;
      const allResults = await functionResults.getAllResults();

      if (typeof allResults === 'object' && !Array.isArray(allResults)) {
        const limitedResults = {};
        for (const [category, items] of Object.entries(allResults)) {
          limitedResults[category] = Array.isArray(items) ? items.slice(skip, skip + limit) : items;
        }
        res.json(limitedResults);
      } else if (Array.isArray(allResults)) {
        res.json(allResults.slice(skip, skip + limit));
      } else {
        res.json(allResults);
      }
    } catch (error) {
      logger.error({ error }, 'Error getting function results');
      res.status(500).json({ success: false, message: 'Error getting function results' });
    }
  });

  // GET /function-results/summary
  router.get('/function-results/summary', async (req, res) => {
    try {
      const allResults = await functionResults.getAllResults();
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
          summary[category] = {};
          for (const [pluginName, pluginData] of Object.entries(items)) {
            summary[category][pluginName] = Array.isArray(pluginData)
              ? {
                  count: pluginData.length,
                  latest:
                    pluginData.length > 0 ? pluginData[pluginData.length - 1]?.timestamp : null,
                }
              : pluginData;
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

  return router;
}

module.exports = { createRouter };
