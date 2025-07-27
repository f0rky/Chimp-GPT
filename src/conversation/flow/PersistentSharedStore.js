/**
 * PersistentSharedStore - SharedStore with disk persistence for knowledge retention
 *
 * Extends the basic SharedStore to maintain knowledge across bot restarts.
 * Uses file-based storage with atomic operations for data safety.
 */

const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('../../core/logger');
const { SharedStore } = require('./PocketFlow');

const logger = createLogger('PersistentSharedStore');

class PersistentSharedStore extends SharedStore {
  constructor(persistencePath = './data/knowledge-store.json') {
    super();
    this.persistencePath = path.resolve(persistencePath);
    this.saveTimer = null;
    this.isDirty = false;
    this.isLoading = false;

    // Ensure data directory exists
    this.ensureDataDirectory();

    // Load existing knowledge on initialization
    this.loadFromDisk();
  }

  async ensureDataDirectory() {
    try {
      const dir = path.dirname(this.persistencePath);
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      logger.warn('Could not create data directory:', error.message);
    }
  }

  /**
   * Load knowledge from disk if it exists
   */
  async loadFromDisk() {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const data = await fs.readFile(this.persistencePath, 'utf8');
      const savedData = JSON.parse(data);

      // Restore saved data with proper Map conversion
      if (savedData.knowledgeCache) {
        this.data.set('knowledgeCache', new Map(Object.entries(savedData.knowledgeCache)));
      }
      if (savedData.searchHistory) {
        this.data.set('searchHistory', savedData.searchHistory);
      }
      if (savedData.confidenceScores) {
        this.data.set('confidenceScores', new Map(Object.entries(savedData.confidenceScores)));
      }

      logger.info(`Loaded persistent knowledge: ${Object.keys(savedData).length} categories`, {
        knowledgeEntries: savedData.knowledgeCache
          ? Object.keys(savedData.knowledgeCache).length
          : 0,
        searchHistory: savedData.searchHistory ? savedData.searchHistory.length : 0,
        confidenceScores: savedData.confidenceScores
          ? Object.keys(savedData.confidenceScores).length
          : 0,
      });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn('Error loading knowledge from disk:', error.message);
      } else {
        logger.info('No existing knowledge file found, starting fresh');
      }
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Save knowledge to disk (debounced)
   */
  async saveToDisk() {
    if (this.isLoading) return;

    try {
      // Convert Maps to objects for JSON serialization
      const dataToSave = {};

      const knowledgeCache = this.data.get('knowledgeCache');
      if (knowledgeCache instanceof Map) {
        dataToSave.knowledgeCache = Object.fromEntries(knowledgeCache);
      }

      const searchHistory = this.data.get('searchHistory');
      if (Array.isArray(searchHistory)) {
        dataToSave.searchHistory = searchHistory;
      }

      const confidenceScores = this.data.get('confidenceScores');
      if (confidenceScores instanceof Map) {
        dataToSave.confidenceScores = Object.fromEntries(confidenceScores);
      }

      // Add metadata
      dataToSave.lastSaved = new Date().toISOString();
      dataToSave.version = '1.0';

      // Atomic write with temp file
      const tempPath = this.persistencePath + '.tmp';
      await fs.writeFile(tempPath, JSON.stringify(dataToSave, null, 2), 'utf8');
      await fs.rename(tempPath, this.persistencePath);

      this.isDirty = false;

      logger.debug('Knowledge saved to disk', {
        knowledgeEntries: Object.keys(dataToSave.knowledgeCache || {}).length,
        searchHistory: (dataToSave.searchHistory || []).length,
        confidenceScores: Object.keys(dataToSave.confidenceScores || {}).length,
      });
    } catch (error) {
      logger.error('Error saving knowledge to disk:', error.message);
    }
  }

  /**
   * Override set to trigger persistence
   */
  set(key, value) {
    super.set(key, value);
    this.markDirty();
    return this;
  }

  /**
   * Mark data as dirty and schedule save
   */
  markDirty() {
    this.isDirty = true;

    // Debounce saves to avoid excessive disk I/O
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      if (this.isDirty) {
        this.saveToDisk();
      }
    }, 2000); // Save after 2 seconds of inactivity
  }

  /**
   * Force immediate save
   */
  async forceSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveToDisk();
  }

  /**
   * Add search result to knowledge cache with metadata
   */
  cacheSearchResult(query, searchResult, confidence = 0) {
    const knowledgeCache = this.get('knowledgeCache') || new Map();
    const searchHistory = this.get('searchHistory') || [];
    const confidenceScores = this.get('confidenceScores') || new Map();

    // Cache the search result with metadata
    knowledgeCache.set(query.toLowerCase(), {
      result: searchResult,
      timestamp: Date.now(),
      confidence,
      accessCount: (knowledgeCache.get(query.toLowerCase())?.accessCount || 0) + 1,
    });

    // Add to search history (keep last 100)
    searchHistory.unshift({
      query,
      timestamp: Date.now(),
      confidence,
    });
    if (searchHistory.length > 100) {
      searchHistory.pop();
    }

    // Store confidence score
    confidenceScores.set(query.toLowerCase(), confidence);

    // Update the store
    this.set('knowledgeCache', knowledgeCache);
    this.set('searchHistory', searchHistory);
    this.set('confidenceScores', confidenceScores);

    logger.info(`Cached search result for: "${query}" (confidence: ${confidence}%)`);
  }

  /**
   * Retrieve cached search result
   */
  getCachedResult(query) {
    const knowledgeCache = this.get('knowledgeCache') || new Map();
    const cached = knowledgeCache.get(query.toLowerCase());

    if (cached) {
      // Update access count
      cached.accessCount++;
      this.markDirty();

      logger.info(`Retrieved cached result for: "${query}" (accessed ${cached.accessCount} times)`);
      return cached;
    }

    return null;
  }

  /**
   * Check if we have knowledge about a query
   */
  hasKnowledge(query) {
    const knowledgeCache = this.get('knowledgeCache') || new Map();
    return knowledgeCache.has(query.toLowerCase());
  }

  /**
   * Get knowledge statistics
   */
  getKnowledgeStats() {
    const knowledgeCache = this.get('knowledgeCache') || new Map();
    const searchHistory = this.get('searchHistory') || [];
    const confidenceScores = this.get('confidenceScores') || new Map();

    return {
      cachedQueries: knowledgeCache.size,
      totalSearches: searchHistory.length,
      avgConfidence:
        confidenceScores.size > 0
          ? Array.from(confidenceScores.values()).reduce((a, b) => a + b, 0) / confidenceScores.size
          : 0,
      recentSearches: searchHistory.slice(0, 10),
    };
  }

  /**
   * Clean up old knowledge (older than 30 days)
   */
  cleanupOldKnowledge() {
    const knowledgeCache = this.get('knowledgeCache') || new Map();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let removedCount = 0;

    for (const [query, data] of knowledgeCache.entries()) {
      if (data.timestamp < thirtyDaysAgo && data.accessCount < 2) {
        knowledgeCache.delete(query);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.set('knowledgeCache', knowledgeCache);
      logger.info(`Cleaned up ${removedCount} old knowledge entries`);
    }

    return removedCount;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    if (this.isDirty) {
      await this.saveToDisk();
    }
    logger.info('PersistentSharedStore shutdown complete');
  }
}

module.exports = PersistentSharedStore;
