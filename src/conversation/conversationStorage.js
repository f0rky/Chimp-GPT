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
const { createLogger } = require('../core/logger');
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
  lastUpdated: new Date().toISOString(),
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

    // Backup file path
    const BACKUP_FILE = `${CONVERSATIONS_FILE}.backup`;
    const TEMP_FILE = `${CONVERSATIONS_FILE}.temp`;

    // Load existing data to preserve timestamps
    const existingData = DEFAULT_CONVERSATIONS;

    // Convert Map to plain object for JSON serialization
    const conversationsObj = {};
    for (const [userId, conversation] of conversationsMap.entries()) {
      conversationsObj[userId] = conversation;
    }

    // Create data object with metadata
    const data = {
      conversations: conversationsObj,
      lastUpdated: new Date().toISOString(),
      version: '1.0',
    };

    // Serialize the data
    const jsonData = JSON.stringify(data, null, 2);

    // First write to a temporary file
    try {
      await fs.promises.writeFile(TEMP_FILE, jsonData, 'utf8');
      logger.debug({ tempFile: TEMP_FILE }, 'Wrote conversations to temporary file');
    } catch (tempError) {
      logger.error({ error: tempError }, 'Error writing to temporary file');
      throw tempError;
    }

    // If the main file exists, create a backup before overwriting
    if (fs.existsSync(CONVERSATIONS_FILE)) {
      try {
        await fs.promises.copyFile(CONVERSATIONS_FILE, BACKUP_FILE);
        logger.debug({ backupFile: BACKUP_FILE }, 'Created backup of conversations file');
      } catch (backupError) {
        logger.warn({ error: backupError }, 'Failed to create backup of conversations file');
        // Continue anyway - we still have the temp file
      }
    }

    // Now rename the temp file to the actual file
    try {
      await fs.promises.rename(TEMP_FILE, CONVERSATIONS_FILE);
      logger.info(
        {
          userCount: conversationsMap.size,
          file: CONVERSATIONS_FILE,
        },
        'Saved conversations to file'
      );
      return true;
    } catch (renameError) {
      logger.error({ error: renameError }, 'Error renaming temporary file to conversations file');

      // Try one more direct write as a last resort
      try {
        await fs.promises.writeFile(CONVERSATIONS_FILE, jsonData, 'utf8');
        logger.info(
          {
            userCount: conversationsMap.size,
            file: CONVERSATIONS_FILE,
            recovery: true,
          },
          'Saved conversations to file (recovery)'
        );
        return true;
      } catch (directWriteError) {
        logger.error({ error: directWriteError }, 'Error in direct write recovery attempt');
        throw directWriteError;
      }
    }
  } catch (error) {
    logger.error({ error }, 'Error saving conversations');
    throw error;
  }
}

/**
 * Load conversations from the conversations file.
 *
 * @returns {Promise<Map<string, ConversationLog>>} The loaded conversations map
 * @throws {Error} If an error occurs while loading
 */
async function loadConversations() {
  ensureDataDir();

  // Backup file path
  const BACKUP_FILE = `${CONVERSATIONS_FILE}.backup`;

  // Check if file exists
  if (!fs.existsSync(CONVERSATIONS_FILE)) {
    logger.info({ file: CONVERSATIONS_FILE }, 'Conversations file does not exist, using defaults');
    return new Map();
  }

  try {
    // Create a backup before loading (if not already exists)
    if (!fs.existsSync(BACKUP_FILE)) {
      try {
        await fs.promises.copyFile(CONVERSATIONS_FILE, BACKUP_FILE);
        logger.info({ backupFile: BACKUP_FILE }, 'Created backup of conversations file');
      } catch (backupError) {
        logger.warn({ error: backupError }, 'Failed to create backup of conversations file');
      }
    }

    // Read and parse the file
    let fileContent;
    try {
      fileContent = await fs.promises.readFile(CONVERSATIONS_FILE, 'utf8');
    } catch (readError) {
      logger.error({ error: readError }, 'Error reading conversations file');
      throw readError; // Let the outer catch handle recovery
    }

    let data;
    try {
      data = JSON.parse(fileContent);

      // Validate data structure
      if (!data || typeof data !== 'object' || !data.conversations) {
        throw new Error('Invalid data format in conversations file');
      }
    } catch (parseError) {
      logger.error({ error: parseError }, 'Error parsing conversations file');
      throw parseError; // Let the outer catch handle recovery
    }

    // Convert to Map
    const conversationsMap = new Map();
    for (const [userId, conversation] of Object.entries(data.conversations || {})) {
      if (Array.isArray(conversation)) {
        conversationsMap.set(userId, conversation);
      } else {
        logger.warn({ userId }, 'Invalid conversation format for user, skipping');
      }
    }

    logger.info(
      {
        userCount: conversationsMap.size,
        lastUpdated: data.lastUpdated,
        file: CONVERSATIONS_FILE,
      },
      'Loaded conversations from file'
    );

    return conversationsMap;
  } catch (error) {
    logger.error({ error }, 'Error loading conversations file');

    // Try to recover from backup if it exists
    if (fs.existsSync(BACKUP_FILE)) {
      try {
        logger.info({ backupFile: BACKUP_FILE }, 'Attempting to recover from backup file');
        const backupContent = await fs.promises.readFile(BACKUP_FILE, 'utf8');
        const backupData = JSON.parse(backupContent);

        // Validate backup data structure
        if (!backupData || typeof backupData !== 'object') {
          throw new Error('Invalid backup data format');
        }

        // Convert backup data to Map
        const recoveredMap = new Map();
        for (const [userId, conversation] of Object.entries(backupData.conversations || {})) {
          // Validate conversation format
          if (Array.isArray(conversation)) {
            recoveredMap.set(userId, conversation);
          }
        }

        logger.info(
          {
            userCount: recoveredMap.size,
            lastUpdated: backupData.lastUpdated,
            file: BACKUP_FILE,
          },
          'Successfully recovered conversations from backup file'
        );

        // If we recovered at least one conversation, return the map
        if (recoveredMap.size > 0) {
          return recoveredMap;
        }
        logger.warn('Backup file contained no valid conversations');
        throw new Error('No valid conversations in backup');
      } catch (backupError) {
        logger.error({ error: backupError }, 'Failed to recover from backup file, using defaults');
      }
    } else {
      logger.warn('No backup file found, using defaults');
    }

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
      logger.info(
        { file: CONVERSATIONS_FILE },
        'Conversations file does not exist, nothing to clear'
      );
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
 * @param {number} [maxAgeMs=3*24*60*60*1000] - Maximum age in milliseconds (default: 3 days)
 * @returns {Promise<Map<string, ConversationLog>>} The pruned conversations map
 */
async function pruneOldConversations(conversationsMap, maxAgeMs = 3 * 24 * 60 * 60 * 1000) {
  try {
    const now = Date.now();
    const cutoffTime = now - maxAgeMs;
    let prunedCount = 0;

    // Load the current file to get timestamps
    let timestamps = {};
    if (fs.existsSync(CONVERSATIONS_FILE)) {
      try {
        const data = JSON.parse(await fs.promises.readFile(CONVERSATIONS_FILE, 'utf8'));
        timestamps = data.timestamps || {};
      } catch (error) {
        logger.error({ error }, 'Error reading timestamps, using defaults');
        timestamps = {};
      }
    }

    // Create a new map with only recent conversations
    const prunedMap = new Map();
    for (const [userId, conversation] of conversationsMap.entries()) {
      // First check if we have a timestamp in the file
      let lastUpdated = timestamps[userId] ? new Date(timestamps[userId]).getTime() : 0;

      // If no timestamp in file, check for timestamps in the messages themselves
      if (lastUpdated === 0 && Array.isArray(conversation)) {
        // Find the most recent message with a timestamp
        for (const message of conversation) {
          if (message && message.timestamp) {
            const messageTime =
              typeof message.timestamp === 'number'
                ? message.timestamp
                : new Date(message.timestamp).getTime();
            lastUpdated = Math.max(lastUpdated, messageTime);
          }
        }
      }

      if (lastUpdated >= cutoffTime) {
        prunedMap.set(userId, conversation);
      } else {
        prunedCount++;
        logger.debug(
          { userId, lastUpdated: new Date(lastUpdated).toISOString() },
          'Pruned old conversation'
        );
      }
    }

    logger.info(
      {
        originalCount: conversationsMap.size,
        prunedCount,
        remainingCount: prunedMap.size,
        maxAgeDays: maxAgeMs / (24 * 60 * 60 * 1000),
      },
      'Pruned old conversations'
    );

    return prunedMap;
  } catch (error) {
    logger.error({ error }, 'Error pruning conversations');
    return conversationsMap; // Return original on error
  }
}

/**
 * Get the path to the conversations storage file.
 *
 * @returns {string} The path to the conversations file
 */
function getStorageFilePath() {
  return CONVERSATIONS_FILE;
}

/**
 * Get the current status of conversation storage
 *
 * This function returns information about the conversation storage system,
 * including the number of conversations, last save time, and storage size.
 *
 * @returns {Object} Object containing storage metrics
 */
function getConversationStorageStatus() {
  try {
    // Check if the file exists
    if (!fs.existsSync(CONVERSATIONS_FILE)) {
      return {
        totalConversations: 0,
        lastSave: null,
        storageSize: 0,
        exists: false,
      };
    }

    // Get file stats
    const stats = fs.statSync(CONVERSATIONS_FILE);

    // Try to read the file to get conversation count
    let conversationCount = 0;
    let lastSave = null;

    try {
      const data = JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, 'utf8'));
      conversationCount = Object.keys(data.conversations || {}).length;
      lastSave = data.lastUpdated || stats.mtime.toISOString();
    } catch (parseError) {
      logger.error({ error: parseError }, 'Error parsing conversation file for status');
    }

    return {
      totalConversations: conversationCount,
      lastSave: lastSave,
      storageSize: stats.size,
      exists: true,
      lastModified: stats.mtime,
    };
  } catch (error) {
    logger.error({ error }, 'Error getting conversation storage status');
    return {
      totalConversations: 0,
      lastSave: null,
      storageSize: 0,
      exists: false,
      error: error.message,
    };
  }
}

module.exports = {
  saveConversations,
  loadConversations,
  clearAllConversations,
  pruneOldConversations,
  getStorageFilePath,
  getConversationStorageStatus,
};
