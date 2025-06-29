const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('../core/logger');

const logger = createLogger('performanceHistory');

class PerformanceHistory {
  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    this.historyFile = path.join(dataDir, 'performance-history.json');
    this.currentData = {
      metrics: [],
      hourlyAggregates: {},
      dailyAggregates: {},
      lastUpdated: null,
    };
    this.maxDataPoints = 10000; // Keep last 10k raw data points
    this.maxHourlyData = 168; // Keep 7 days of hourly data
    this.maxDailyData = 90; // Keep 90 days of daily data
    this.saveInterval = null;
  }

  async initialize() {
    try {
      // Ensure data directory exists
      await fs.mkdir(this.dataDir, { recursive: true });

      // Load existing data
      await this.loadHistory();

      // Start periodic save
      this.saveInterval = setInterval(() => this.saveHistory(), 60000); // Save every minute

      logger.info('Performance history initialized');
    } catch (error) {
      logger.error('Error initializing performance history:', error);
    }
  }

  async loadHistory() {
    try {
      const data = await fs.readFile(this.historyFile, 'utf8');
      this.currentData = JSON.parse(data);
      logger.info(`Loaded ${this.currentData.metrics.length} historical data points`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('No existing performance history found, starting fresh');
      } else {
        logger.error('Error loading performance history:', error);
      }
    }
  }

  async saveHistory() {
    try {
      await fs.writeFile(this.historyFile, JSON.stringify(this.currentData, null, 2), 'utf8');
    } catch (error) {
      logger.error('Error saving performance history:', error);
    }
  }

  addMetric(performanceData) {
    const timestamp = Date.now();
    const metric = {
      timestamp,
      responseTime: performanceData.summary?.message_processing?.avg || 0,
      responseTimeP95: performanceData.summary?.message_processing?.p95 || 0,
      responseTimeMax: performanceData.summary?.message_processing?.max || 0,
      messageCount: performanceData.summary?.message_processing?.count || 0,
      apiCalls: {
        openai: performanceData.summary?.openai_api?.count || 0,
        openaiAvg: performanceData.summary?.openai_api?.avg || 0,
        functionCalls: performanceData.summary?.function_call?.count || 0,
        functionAvg: performanceData.summary?.function_call?.avg || 0,
      },
      memory: {
        heapUsed: parseFloat(performanceData.serverHealth?.memory?.heapUsed || '0'),
        heapTotal: parseFloat(performanceData.serverHealth?.memory?.heapTotal || '0'),
        rss: parseFloat(performanceData.serverHealth?.memory?.rss || '0'),
      },
    };

    // Add to metrics array
    this.currentData.metrics.push(metric);

    // Prune old data if necessary
    if (this.currentData.metrics.length > this.maxDataPoints) {
      this.currentData.metrics = this.currentData.metrics.slice(-this.maxDataPoints);
    }

    // Update aggregates
    this.updateHourlyAggregate(metric);
    this.updateDailyAggregate(metric);

    this.currentData.lastUpdated = timestamp;
  }

  updateHourlyAggregate(metric) {
    const hourKey = new Date(metric.timestamp).toISOString().slice(0, 13); // YYYY-MM-DDTHH

    if (!this.currentData.hourlyAggregates[hourKey]) {
      this.currentData.hourlyAggregates[hourKey] = {
        timestamp: new Date(hourKey + ':00:00.000Z').getTime(),
        responseTimeSum: 0,
        responseTimeCount: 0,
        responseTimeMax: 0,
        messageCount: 0,
        apiCallsTotal: 0,
        functionCallsTotal: 0,
        memoryAvg: { heapUsed: 0, count: 0 },
      };
    }

    const hourData = this.currentData.hourlyAggregates[hourKey];
    hourData.responseTimeSum += metric.responseTime;
    hourData.responseTimeCount += 1;
    hourData.responseTimeMax = Math.max(hourData.responseTimeMax, metric.responseTimeMax);
    hourData.messageCount += metric.messageCount;
    hourData.apiCallsTotal += metric.apiCalls.openai;
    hourData.functionCallsTotal += metric.apiCalls.functionCalls;
    hourData.memoryAvg.heapUsed += metric.memory.heapUsed;
    hourData.memoryAvg.count += 1;

    // Prune old hourly data
    const hourKeys = Object.keys(this.currentData.hourlyAggregates).sort();
    if (hourKeys.length > this.maxHourlyData) {
      const keysToRemove = hourKeys.slice(0, hourKeys.length - this.maxHourlyData);
      keysToRemove.forEach(key => delete this.currentData.hourlyAggregates[key]);
    }
  }

  updateDailyAggregate(metric) {
    const dayKey = new Date(metric.timestamp).toISOString().slice(0, 10); // YYYY-MM-DD

    if (!this.currentData.dailyAggregates[dayKey]) {
      this.currentData.dailyAggregates[dayKey] = {
        timestamp: new Date(dayKey + 'T00:00:00.000Z').getTime(),
        responseTimeSum: 0,
        responseTimeCount: 0,
        responseTimeMax: 0,
        messageCount: 0,
        apiCallsTotal: 0,
        functionCallsTotal: 0,
        memoryAvg: { heapUsed: 0, count: 0 },
      };
    }

    const dayData = this.currentData.dailyAggregates[dayKey];
    dayData.responseTimeSum += metric.responseTime;
    dayData.responseTimeCount += 1;
    dayData.responseTimeMax = Math.max(dayData.responseTimeMax, metric.responseTimeMax);
    dayData.messageCount += metric.messageCount;
    dayData.apiCallsTotal += metric.apiCalls.openai;
    dayData.functionCallsTotal += metric.apiCalls.functionCalls;
    dayData.memoryAvg.heapUsed += metric.memory.heapUsed;
    dayData.memoryAvg.count += 1;

    // Prune old daily data
    const dayKeys = Object.keys(this.currentData.dailyAggregates).sort();
    if (dayKeys.length > this.maxDailyData) {
      const keysToRemove = dayKeys.slice(0, dayKeys.length - this.maxDailyData);
      keysToRemove.forEach(key => delete this.currentData.dailyAggregates[key]);
    }
  }

  getRecentMetrics(minutes = 60) {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.currentData.metrics.filter(m => m.timestamp > cutoff);
  }

  getHourlyData(hours = 24) {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return Object.values(this.currentData.hourlyAggregates)
      .filter(h => h.timestamp > cutoff)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(h => ({
        timestamp: h.timestamp,
        responseTimeAvg: h.responseTimeCount > 0 ? h.responseTimeSum / h.responseTimeCount : 0,
        responseTimeMax: h.responseTimeMax,
        messageCount: h.messageCount,
        apiCalls: h.apiCallsTotal,
        functionCalls: h.functionCallsTotal,
        memoryAvg: h.memoryAvg.count > 0 ? h.memoryAvg.heapUsed / h.memoryAvg.count : 0,
      }));
  }

  getDailyData(days = 30) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return Object.values(this.currentData.dailyAggregates)
      .filter(d => d.timestamp > cutoff)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(d => ({
        timestamp: d.timestamp,
        responseTimeAvg: d.responseTimeCount > 0 ? d.responseTimeSum / d.responseTimeCount : 0,
        responseTimeMax: d.responseTimeMax,
        messageCount: d.messageCount,
        apiCalls: d.apiCallsTotal,
        functionCalls: d.functionCallsTotal,
        memoryAvg: d.memoryAvg.count > 0 ? d.memoryAvg.heapUsed / d.memoryAvg.count : 0,
      }));
  }

  async shutdown() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    await this.saveHistory();
    logger.info('Performance history shut down');
  }
}

module.exports = new PerformanceHistory();
