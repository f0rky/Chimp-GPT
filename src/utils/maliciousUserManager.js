/**
 * Malicious User Detection and Management
 *
 * Tracks and manages users who exhibit suspicious or malicious behavior,
 * particularly those who frequently delete messages after sending them.
 *
 * @module MaliciousUserManager
 */

const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('../core/logger');
const humanCircuitBreaker = require('./humanCircuitBreaker');

const logger = createLogger('maliciousUserManager');

// Configuration
const DETECTION_CONFIG = {
  // Trigger thresholds
  MAX_DELETIONS_PER_HOUR: 5,
  MAX_DELETIONS_PER_DAY: 15,
  RAPID_DELETE_THRESHOLD_MS: 30000, // 30 seconds

  // Time windows
  HOUR_MS: 60 * 60 * 1000,
  DAY_MS: 24 * 60 * 60 * 1000,

  // Data retention
  CLEANUP_AFTER_DAYS: 30,
};

// File paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const BLOCKED_USERS_FILE = path.join(DATA_DIR, 'blockedUsers.json');
const DELETION_HISTORY_FILE = path.join(DATA_DIR, 'messageDeletionHistory.json');

// In-memory storage
let blockedUsers = new Set();
let deletionHistory = new Map(); // userId -> array of deletion timestamps
let rapidDeletions = new Map(); // userId -> array of rapid deletion events

/**
 * Initialize the malicious user manager
 */
async function init() {
  try {
    await ensureDataDirectory();
    await loadBlockedUsers();
    await loadDeletionHistory();

    // Clean up old data
    await cleanupOldData();

    logger.info('Malicious user manager initialized');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize malicious user manager');
    throw error;
  }
}

/**
 * Ensure data directory exists
 */
async function ensureDataDirectory() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Load blocked users from file
 */
async function loadBlockedUsers() {
  try {
    const data = await fs.readFile(BLOCKED_USERS_FILE, 'utf8');
    const users = JSON.parse(data);
    blockedUsers = new Set(users.blockedUserIds || []);
    logger.info({ count: blockedUsers.size }, 'Loaded blocked users');
  } catch (error) {
    if (error.code === 'ENOENT') {
      blockedUsers = new Set();
      logger.info('No blocked users file found, starting fresh');
    } else {
      logger.error({ error }, 'Error loading blocked users');
      throw error;
    }
  }
}

/**
 * Save blocked users to file
 */
async function saveBlockedUsers() {
  try {
    const data = {
      blockedUserIds: Array.from(blockedUsers),
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(BLOCKED_USERS_FILE, JSON.stringify(data, null, 2));
    logger.debug('Saved blocked users to file');
  } catch (error) {
    logger.error({ error }, 'Error saving blocked users');
    throw error;
  }
}

/**
 * Load deletion history from file
 */
async function loadDeletionHistory() {
  try {
    const data = await fs.readFile(DELETION_HISTORY_FILE, 'utf8');
    const history = JSON.parse(data);

    deletionHistory = new Map();
    for (const [userId, deletions] of Object.entries(history.deletions || {})) {
      deletionHistory.set(userId, deletions);
    }

    rapidDeletions = new Map();
    for (const [userId, events] of Object.entries(history.rapidDeletions || {})) {
      rapidDeletions.set(userId, events);
    }

    logger.info({ userCount: deletionHistory.size }, 'Loaded deletion history');
  } catch (error) {
    if (error.code === 'ENOENT') {
      deletionHistory = new Map();
      rapidDeletions = new Map();
      logger.info('No deletion history file found, starting fresh');
    } else {
      logger.error({ error }, 'Error loading deletion history');
      throw error;
    }
  }
}

/**
 * Save deletion history to file
 */
async function saveDeletionHistory() {
  try {
    const data = {
      deletions: Object.fromEntries(deletionHistory),
      rapidDeletions: Object.fromEntries(rapidDeletions),
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(DELETION_HISTORY_FILE, JSON.stringify(data, null, 2));
    logger.debug('Saved deletion history to file');
  } catch (error) {
    logger.error({ error }, 'Error saving deletion history');
    throw error;
  }
}

/**
 * Record a message deletion event
 * @param {string} userId - User who deleted the message
 * @param {string} messageId - ID of deleted message
 * @param {string} channelId - Channel where message was deleted
 * @param {string} content - Content of deleted message (first 100 chars)
 * @param {number} timeSinceCreation - Time between message creation and deletion (ms)
 */
async function recordDeletion(userId, messageId, channelId, content, timeSinceCreation) {
  try {
    const now = Date.now();

    // Initialize user's deletion history if needed
    if (!deletionHistory.has(userId)) {
      deletionHistory.set(userId, []);
    }

    // Add deletion record
    const deletionRecord = {
      messageId,
      channelId,
      content: content ? content.substring(0, 100) : '',
      timestamp: now,
      timeSinceCreation,
    };

    deletionHistory.get(userId).push(deletionRecord);

    // Check for rapid deletion (deleted within threshold after creation)
    if (timeSinceCreation < DETECTION_CONFIG.RAPID_DELETE_THRESHOLD_MS) {
      if (!rapidDeletions.has(userId)) {
        rapidDeletions.set(userId, []);
      }
      rapidDeletions.get(userId).push(deletionRecord);

      logger.warn(
        {
          userId,
          messageId,
          timeSinceCreation,
          content: deletionRecord.content,
        },
        'Rapid message deletion detected'
      );
    }

    // Check for suspicious behavior
    await checkForSuspiciousBehavior(userId);

    // Save to file
    await saveDeletionHistory();

    logger.debug({ userId, messageId, timeSinceCreation }, 'Recorded message deletion');
  } catch (error) {
    logger.error({ error, userId }, 'Error recording deletion');
  }
}

/**
 * Check if user behavior is suspicious and take action
 * @param {string} userId - User to check
 */
async function checkForSuspiciousBehavior(userId, client = null) {
  try {
    const now = Date.now();
    const userDeletions = deletionHistory.get(userId) || [];
    const userRapidDeletions = rapidDeletions.get(userId) || [];

    // Count deletions in the last hour and day
    const deletionsLastHour = userDeletions.filter(
      d => now - d.timestamp < DETECTION_CONFIG.HOUR_MS
    ).length;

    const deletionsLastDay = userDeletions.filter(
      d => now - d.timestamp < DETECTION_CONFIG.DAY_MS
    ).length;

    // Check rapid deletions in last hour
    const rapidDeletionsLastHour = userRapidDeletions.filter(
      d => now - d.timestamp < DETECTION_CONFIG.HOUR_MS
    ).length;

    // Determine suspicion level
    let isSuspicious = false;
    const reasons = [];

    if (deletionsLastHour >= DETECTION_CONFIG.MAX_DELETIONS_PER_HOUR) {
      isSuspicious = true;
      reasons.push(`${deletionsLastHour} deletions in last hour`);
    }

    if (deletionsLastDay >= DETECTION_CONFIG.MAX_DELETIONS_PER_DAY) {
      isSuspicious = true;
      reasons.push(`${deletionsLastDay} deletions in last day`);
    }

    if (rapidDeletionsLastHour >= 3) {
      isSuspicious = true;
      reasons.push(`${rapidDeletionsLastHour} rapid deletions in last hour`);
    }

    if (isSuspicious) {
      logger.warn(
        {
          userId,
          deletionsLastHour,
          deletionsLastDay,
          rapidDeletionsLastHour,
          reasons,
        },
        'Suspicious user behavior detected'
      );

      // Request human approval for blocking
      if (client && !blockedUsers.has(userId)) {
        await requestBlockApproval(userId, reasons, client);
      }
    }
  } catch (error) {
    logger.error({ error, userId }, 'Error checking suspicious behavior');
  }
}

/**
 * Request human approval to block a user
 * @param {string} userId - User to potentially block
 * @param {Array} reasons - Reasons for suspicion
 * @param {Object} client - Discord client
 */
async function requestBlockApproval(userId, reasons, client) {
  try {
    const details = {
      type: 'USER_BLOCK',
      user: userId,
      context: `User showing suspicious deletion behavior: ${reasons.join(', ')}`,
      metadata: {
        reasons,
        deletionStats: {
          total: deletionHistory.get(userId)?.length || 0,
          rapid: rapidDeletions.get(userId)?.length || 0,
        },
      },
    };

    await humanCircuitBreaker.requestHumanApproval(
      details,
      async () => {
        // Approved - block the user
        await blockUser(userId, reasons.join(', '));
        logger.info({ userId }, 'User blocked after human approval');
      },
      async () => {
        // Denied - log but don't block
        logger.info({ userId }, 'User block request denied by human reviewer');
      },
      client
    );
  } catch (error) {
    logger.error({ error, userId }, 'Error requesting block approval');
  }
}

/**
 * Block a user
 * @param {string} userId - User to block
 * @param {string} reason - Reason for blocking
 */
async function blockUser(userId, reason) {
  try {
    blockedUsers.add(userId);
    await saveBlockedUsers();

    logger.warn({ userId, reason }, 'User blocked for malicious behavior');
  } catch (error) {
    logger.error({ error, userId }, 'Error blocking user');
    throw error;
  }
}

/**
 * Unblock a user
 * @param {string} userId - User to unblock
 */
async function unblockUser(userId) {
  try {
    const wasBlocked = blockedUsers.delete(userId);
    if (wasBlocked) {
      await saveBlockedUsers();
      logger.info({ userId }, 'User unblocked');
    }
    return wasBlocked;
  } catch (error) {
    logger.error({ error, userId }, 'Error unblocking user');
    throw error;
  }
}

/**
 * Check if a user is blocked
 * @param {string} userId - User to check
 * @returns {boolean} True if user is blocked
 */
function isUserBlocked(userId) {
  return blockedUsers.has(userId);
}

/**
 * Get blocked users list
 * @returns {Array} Array of blocked user IDs
 */
function getBlockedUsers() {
  return Array.from(blockedUsers);
}

/**
 * Get user deletion statistics
 * @param {string} userId - User to get stats for
 * @returns {Object} User deletion statistics
 */
function getUserStats(userId) {
  const userDeletions = deletionHistory.get(userId) || [];
  const userRapidDeletions = rapidDeletions.get(userId) || [];
  const now = Date.now();

  return {
    totalDeletions: userDeletions.length,
    rapidDeletions: userRapidDeletions.length,
    deletionsLastHour: userDeletions.filter(d => now - d.timestamp < DETECTION_CONFIG.HOUR_MS)
      .length,
    deletionsLastDay: userDeletions.filter(d => now - d.timestamp < DETECTION_CONFIG.DAY_MS).length,
    isBlocked: blockedUsers.has(userId),
    recentDeletions: userDeletions.slice(-5), // Last 5 deletions
  };
}

/**
 * Clean up old data to prevent memory/storage bloat
 */
async function cleanupOldData() {
  try {
    const cutoffTime = Date.now() - DETECTION_CONFIG.CLEANUP_AFTER_DAYS * DETECTION_CONFIG.DAY_MS;
    let cleanedCount = 0;

    // Clean up deletion history
    for (const [userId, deletions] of deletionHistory.entries()) {
      const filtered = deletions.filter(d => d.timestamp > cutoffTime);
      if (filtered.length !== deletions.length) {
        cleanedCount += deletions.length - filtered.length;
        if (filtered.length > 0) {
          deletionHistory.set(userId, filtered);
        } else {
          deletionHistory.delete(userId);
        }
      }
    }

    // Clean up rapid deletions
    for (const [userId, deletions] of rapidDeletions.entries()) {
      const filtered = deletions.filter(d => d.timestamp > cutoffTime);
      if (filtered.length !== deletions.length) {
        if (filtered.length > 0) {
          rapidDeletions.set(userId, filtered);
        } else {
          rapidDeletions.delete(userId);
        }
      }
    }

    if (cleanedCount > 0) {
      await saveDeletionHistory();
      logger.info({ cleanedCount }, 'Cleaned up old deletion history');
    }
  } catch (error) {
    logger.error({ error }, 'Error cleaning up old data');
  }
}

module.exports = {
  init,
  recordDeletion,
  blockUser,
  unblockUser,
  isUserBlocked,
  getBlockedUsers,
  getUserStats,
  checkForSuspiciousBehavior,
  cleanupOldData,
  DETECTION_CONFIG,
};
