/**
 * Simple LRU Cache for Web Search Results
 *
 * Implements a Least Recently Used (LRU) cache to store search results
 * and reduce redundant API calls to search engines.
 *
 * @module SearchCache
 * @version 1.0.0
 */

class SearchCache {
  constructor(maxSize = 100, ttlMs = 10 * 60 * 1000) {
    this.maxSize = maxSize; // Maximum number of cached queries
    this.ttlMs = ttlMs; // Time to live in milliseconds (default: 10 minutes)
    this.cache = new Map(); // Map<normalizedQuery, {result, timestamp}>
  }

  /**
   * Normalize a search query for cache key consistency
   * @param {string} query - Raw search query
   * @returns {string} Normalized query
   */
  normalizeQuery(query) {
    return query.toLowerCase().trim().replace(/\s+/g, ' '); // Normalize whitespace
  }

  /**
   * Get a cached search result if it exists and is not expired
   * @param {string} query - Search query
   * @returns {Object|null} Cached result or null if not found/expired
   */
  get(query) {
    const key = this.normalizeQuery(query);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if cache entry has expired
    const now = Date.now();
    if (now - cached.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, cached);

    return cached.result;
  }

  /**
   * Store a search result in the cache
   * @param {string} query - Search query
   * @param {Object} result - Search result to cache
   */
  set(query, result) {
    const key = this.normalizeQuery(query);

    // If cache is at capacity, remove oldest entry (first in Map)
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if a query exists in cache and is not expired
   * @param {string} query - Search query
   * @returns {boolean} True if cached and not expired
   */
  has(query) {
    return this.get(query) !== null;
  }

  /**
   * Clear all cached entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Remove expired entries from cache
   * @returns {number} Number of entries removed
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;

    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.ttlMs) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      utilizationPercent: ((this.cache.size / this.maxSize) * 100).toFixed(2),
    };
  }
}

// Create singleton instance with 10-minute TTL and max 100 entries
const searchCache = new SearchCache(100, 10 * 60 * 1000);

// Run cleanup every 5 minutes to remove expired entries
setInterval(
  () => {
    const removed = searchCache.cleanup();
    if (removed > 0) {
      // Only log if entries were actually removed
      const { createLogger } = require('../core/logger');
      const logger = createLogger('searchCache');
      logger.debug({ removed, stats: searchCache.getStats() }, 'Search cache cleanup completed');
    }
  },
  5 * 60 * 1000
);

module.exports = searchCache;
