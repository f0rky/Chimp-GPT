/**
 * @typedef {Object} ConversationMessage
 * @property {string} role - The role of the message sender (e.g., 'system', 'user', 'assistant')
 * @property {string} content - The content of the message
 *
 * @typedef {Array<ConversationMessage>} ConversationLog
 *
 * @typedef {Object} ConversationData
 * @property {Object.<string, ConversationLog>} conversations - Map of user IDs to conversation logs
 * @property {string} lastUpdated - ISO timestamp of the last update
 */
/**
 * Conversation Storage Module
 * 
 * This module provides functions to save and load conversation history to/from a file.
 * It enables maintaining conversation context across bot restarts.
 * 
 * @module ConversationStorage
 * @author Brett
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const logger = createLogger('conversationStorage');

// Path to the conversations file
const CONVERSATIONS_FILE = path.join(__dirname, 'data', 'conversations.json');

// Ensure the data directory exists
function ensureDataDir() {
  const dataDir = path.dirname(CONVERSATIONS_FILE);
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.info({ dataDir }, 'Created data directory');
    } catch (error) {
      logger.error({ error, dataDir }, 'Error creating data directory');
      throw error;
    }
  }
}

/**
 * Default conversations object structure
 * @type {ConversationData}
 */
const DEFAULT_CONVERSATIONS = {
  conversations: {},
  timestamps: {},
  lastUpdated: new Date().toISOString()
};

/**
 * Save conversations to the conversations file.
 * 
 * @param {Map<string, ConversationLog>} conversationsMap - The conversations map to save
 * @returns {Promise<boolean>} True if successful, false otherwise
 * @throws {Error} If an error occurs while saving
 */
async function saveConversations(conversationsMap) {
  try {
    ensureDataDir();
    
    // Load existing data to preserve timestamps
    let existingData = DEFAULT_CONVERSATIONS;
    if (fs.existsSync(CONVERSATIONS_FILE)) {
      try {
        existingData = JSON.parse(
          await fs.promises.readFile(CONVERSATIONS_FILE, 'utf8')
        );
      } catch (error) {
        logger.warn({ error }, 'Error reading existing conversations file, using defaults');
      }
    }
    
    // Convert Map to a plain object for JSON serialization
    const conversations = {};
    const timestamps = existingData.timestamps || {};
    const now = new Date().toISOString();
    
    for (const [userId, conversation] of conversationsMap.entries()) {
      conversations[userId] = conversation;
      // Update timestamp for this user
      timestamps[userId] = now;
    }
    
    const data = {
      conversations,
      timestamps,
      lastUpdated: now
    };
    
    await fs.promises.writeFile(
      CONVERSATIONS_FILE,
      JSON.stringify(data, null, 2),
      'utf8'
    );
    
    logger.info({
      userCount: Object.keys(conversations).length,
      file: CONVERSATIONS_FILE
    }, 'Saved conversations to file');
    
    return true;
  } catch (error) {
    logger.error({ error }, 'Error saving conversations');
    return false;
  }
}

/**
 * Load conversations from the conversations file.
 * 
 * @returns {Promise<Map<string, ConversationLog>>} The loaded conversations map
 * @throws {Error} If an error occurs while loading
 */
async function loadConversations() {
  try {
    ensureDataDir();
    
    // Check if the file exists
    if (!fs.existsSync(CONVERSATIONS_FILE)) {
      logger.info({ file: CONVERSATIONS_FILE }, 'Conversations file does not exist, using defaults');
      return new Map();
    }
    
    // Read and parse the file
    const data = JSON.parse(
      await fs.promises.readFile(CONVERSATIONS_FILE, 'utf8')
    );
    
    // Convert plain object to Map
    const conversationsMap = new Map();
    for (const [userId, conversation] of Object.entries(data.conversations || {})) {
      conversationsMap.set(userId, conversation);
    }
    
    logger.info({
      userCount: conversationsMap.size,
      lastUpdated: data.lastUpdated,
      file: CONVERSATIONS_FILE
    }, 'Loaded conversations from file');
    
    return conversationsMap;
  } catch (error) {
    logger.error({ error }, 'Error loading conversations, using defaults');
    return new Map();
  }
}

/**
 * Clear all saved conversations.
 * 
 * @returns {Promise<boolean>} True if successful, false otherwise
 * @throws {Error} If an error occurs while clearing
 */
async function clearAllConversations() {
  try {
    ensureDataDir();
    
    // Check if the file exists
    if (!fs.existsSync(CONVERSATIONS_FILE)) {
      logger.info({ file: CONVERSATIONS_FILE }, 'Conversations file does not exist, nothing to clear');
      return true;
    }
    
    // Write empty conversations object
    await fs.promises.writeFile(
      CONVERSATIONS_FILE,
      JSON.stringify(DEFAULT_CONVERSATIONS, null, 2),
      'utf8'
    );
    
    logger.info({ file: CONVERSATIONS_FILE }, 'Cleared all conversations');
    
    return true;
  } catch (error) {
    logger.error({ error }, 'Error clearing conversations');
    return false;
  }
}

/**
 * Prune old conversations to keep the file size manageable.
 * Removes conversations older than the specified age.
 * 
 * @param {Map<string, ConversationLog>} conversationsMap - The conversations map to prune
 * @param {number} [maxAgeMs=7*24*60*60*1000] - Maximum age in milliseconds (default: 7 days)
 * @returns {Promise<Map<string, ConversationLog>>} The pruned conversations map
 */
async function pruneOldConversations(conversationsMap, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  try {
    const now = Date.now();
    const cutoffTime = now - maxAgeMs;
    let prunedCount = 0;
    
    // Load the current file to get timestamps
    let timestamps = {};
    if (fs.existsSync(CONVERSATIONS_FILE)) {
      try {
        const data = JSON.parse(
          await fs.promises.readFile(CONVERSATIONS_FILE, 'utf8')
        );
        timestamps = data.timestamps || {};
      } catch (error) {
        logger.error({ error }, 'Error reading timestamps, using defaults');
        timestamps = {};
      }
    }
    
    // Create a new map with only recent conversations
    const prunedMap = new Map();
    for (const [userId, conversation] of conversationsMap.entries()) {
      // If no timestamp exists, treat as old (will be pruned with short maxAgeMs)
      const lastUpdated = timestamps[userId] ? new Date(timestamps[userId]).getTime() : 0;
      
      if (lastUpdated >= cutoffTime) {
        prunedMap.set(userId, conversation);
      } else {
        prunedCount++;
        logger.debug({ userId, lastUpdated: new Date(lastUpdated).toISOString() }, 'Pruned old conversation');
      }
    }
    
    logger.info({
      originalCount: conversationsMap.size,
      prunedCount,
      remainingCount: prunedMap.size,
      maxAgeDays: maxAgeMs / (24 * 60 * 60 * 1000)
    }, 'Pruned old conversations');
    
    return prunedMap;
  } catch (error) {
    logger.error({ error }, 'Error pruning conversations');
    return conversationsMap; // Return original on error
  }
}

module.exports = {
  saveConversations,
  loadConversations,
  clearAllConversations,
  pruneOldConversations
};
