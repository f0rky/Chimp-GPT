/**
 * Performance monitoring utility for ChimpGPT
 *
 * This module provides tools to measure execution time of various operations
 * and identify performance bottlenecks.
 */

const { performance } = require('perf_hooks');
const { logger } = require('../core/logger');

// Store timing data with optional metadata
const timings = {};
const pendingTimers = {};
const thresholds = {
  openai_api: 2000, // OpenAI API calls (2 seconds)
  weather_api: 1000, // Weather API calls (1 second)
  wolfram_api: 1500, // Wolfram API calls (1.5 seconds)
  quake_api: 1000, // Quake server stats (1 second)
  image_generation: 65000, // Image generation (65 seconds) - accounts for 20-60s API load
  message_processing: 65000, // Overall message processing (65 seconds) - to handle image gen
  function_call: 2000, // Function call handling (2 seconds)
  plugin_execution: 500, // Plugin execution (0.5 seconds)
  conversation_management: 300, // Conversation management (0.3 seconds)
  discord_reply: 500, // Discord message operations (0.5 seconds)
};

/**
 * Start timing an operation
 *
 * @param {string} operationId - Unique identifier for the operation
 * @param {Object} metadata - Optional metadata about the operation
 * @returns {string} - The operation ID for stopping the timer later
 */
function startTimer(operationId, metadata = {}) {
  const timerId = `${operationId}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  pendingTimers[timerId] = {
    start: performance.now(),
    operationId,
    metadata,
  };
  return timerId;
}

/**
 * Stop timing an operation and record the result
 *
 * @param {string} timerId - The timer ID returned from startTimer
 * @param {Object} additionalMetadata - Optional additional metadata to add
 * @returns {Object} - Timing information including duration
 */
function stopTimer(timerId, additionalMetadata = {}) {
  if (!pendingTimers[timerId]) {
    logger.warn({ timerId }, "Attempted to stop a timer that doesn't exist");
    return null;
  }

  const end = performance.now();
  const { start, operationId, metadata } = pendingTimers[timerId];
  const duration = end - start;

  // Combine metadata
  const combinedMetadata = { ...metadata, ...additionalMetadata };

  // Store timing data
  if (!timings[operationId]) {
    timings[operationId] = [];
  }

  const timingData = {
    duration,
    timestamp: Date.now(),
    metadata: combinedMetadata,
  };

  timings[operationId].push(timingData);

  // Check if this operation exceeded its threshold
  const threshold = thresholds[operationId] || 1000; // Default threshold: 1 second
  if (duration > threshold) {
    logger.warn(
      {
        operationId,
        duration,
        threshold,
        metadata: combinedMetadata,
      },
      `Performance warning: ${operationId} took ${duration.toFixed(2)}ms, exceeding threshold of ${threshold}ms`
    );
  }

  // Clean up
  delete pendingTimers[timerId];

  return timingData;
}

/**
 * Get timing statistics for a specific operation
 *
 * @param {string} operationId - The operation to get stats for
 * @returns {Object} - Timing statistics
 */
function getTimingStats(operationId) {
  const operationTimings = timings[operationId] || [];

  if (operationTimings.length === 0) {
    return {
      operationId,
      count: 0,
      min: 0,
      max: 0,
      avg: 0,
      median: 0,
      p95: 0,
      p99: 0,
    };
  }

  // Extract durations and sort them
  const durations = operationTimings.map(t => t.duration).sort((a, b) => a - b);

  // Calculate statistics
  const count = durations.length;
  const min = durations[0];
  const max = durations[count - 1];
  const avg = durations.reduce((sum, d) => sum + d, 0) / count;
  const median = durations[Math.floor(count / 2)];
  const p95 = durations[Math.floor(count * 0.95)];
  const p99 = durations[Math.floor(count * 0.99)];

  return {
    operationId,
    count,
    min,
    max,
    avg,
    median,
    p95,
    p99,
    recentTimings: operationTimings.slice(-10), // Include 10 most recent timings
  };
}

/**
 * Get all timing statistics
 *
 * @returns {Object} - All timing statistics by operation
 */
function getAllTimingStats() {
  const stats = {};

  for (const operationId in timings) {
    stats[operationId] = getTimingStats(operationId);
  }

  return stats;
}

/**
 * Clear timing data for a specific operation or all operations
 *
 * @param {string} operationId - Optional operation ID to clear, if not provided clears all
 */
function clearTimings(operationId = null) {
  if (operationId) {
    delete timings[operationId];
  } else {
    for (const id in timings) {
      delete timings[id];
    }
  }
}

/**
 * Set a custom threshold for an operation
 *
 * @param {string} operationId - The operation ID
 * @param {number} threshold - Threshold in milliseconds
 */
function setThreshold(operationId, threshold) {
  thresholds[operationId] = threshold;
}

/**
 * Utility function to wrap an async function with performance monitoring
 *
 * @param {Function} fn - The function to wrap
 * @param {string} operationId - ID for the operation
 * @param {Object} metadata - Optional metadata
 * @returns {Function} - Wrapped function
 */
function monitorAsync(fn, operationId, metadata = {}) {
  return async (...args) => {
    const timerId = startTimer(operationId, metadata);
    try {
      const result = await fn(...args);
      stopTimer(timerId, { success: true });
      return result;
    } catch (error) {
      stopTimer(timerId, { success: false, error: error.message });
      throw error;
    }
  };
}

module.exports = {
  startTimer,
  stopTimer,
  getTimingStats,
  getAllTimingStats,
  clearTimings,
  setThreshold,
  monitorAsync,
};
