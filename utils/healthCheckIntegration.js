/**
 * Integration between performance monitoring and health check systems
 *
 * This module integrates the performance monitoring data with the health check system
 * to make performance metrics available through the status page.
 */

const performanceMonitor = require('./performanceMonitor');
const { addCustomStatsSource } = require('../healthCheck');

/**
 * Register the performance monitoring as a custom stats source
 * for the health check system
 */
function initPerformanceMonitoring() {
  // Add the performance monitoring stats to the health check system
  addCustomStatsSource('performance', () => {
    // Get all timing statistics
    const allStats = performanceMonitor.getAllTimingStats();

    // Organize stats by category for better visualization
    const organizedStats = {
      api: {
        openai: allStats.openai_api || allStats.openai_api_detail,
        weather: allStats.weather_api,
        time: allStats.time_api,
        wolfram: allStats.wolfram_api,
        quake: allStats.quake_api,
      },
      processing: {
        messageProcessing: allStats.message_processing,
        functionCall: allStats.function_call,
        imageGeneration: allStats.image_generation,
        pluginExecution: allStats.plugin_execution,
        conversationManagement: allStats.conversation_management,
      },
      discord: {
        discordReply: allStats.discord_reply,
      },
      // Add any custom operation types here
    };

    // Add a summary with key metrics for quick overview
    const summary = {};

    // Calculate summary metrics for each major operation type
    for (const category in organizedStats) {
      for (const op in organizedStats[category]) {
        const stats = organizedStats[category][op];
        if (stats && stats.count > 0) {
          summary[op] = {
            avg: Math.round(stats.avg),
            p95: Math.round(stats.p95),
            count: stats.count,
          };
        }
      }
    }

    // Return both the detailed stats and the summary
    return {
      summary,
      detailed: organizedStats,
      raw: allStats,
    };
  });
}

module.exports = {
  initPerformanceMonitoring,
};
