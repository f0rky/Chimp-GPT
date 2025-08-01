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
  // Trigger thresholds (regular users)
  MAX_DELETIONS_PER_HOUR: 3, // Reduced from 5 to 3 for non-owners
  MAX_DELETIONS_PER_DAY: 10, // Reduced from 15 to 10 for non-owners
  RAPID_DELETE_THRESHOLD_MS: 30000, // 30 seconds

  // Owner-specific thresholds (more lenient)
  OWNER_MAX_DELETIONS_PER_HOUR: 10,
  OWNER_MAX_DELETIONS_PER_DAY: 30,

  // Time windows
  HOUR_MS: 60 * 60 * 1000,
  DAY_MS: 24 * 60 * 60 * 1000,

  // Data retention
  CLEANUP_AFTER_DAYS: 30,

  // WebUI integration
  ENABLE_WEBUI_TRACKING: true,
  STORE_DELETED_MESSAGE_CONTENT: true,
  MAX_STORED_CONTENT_LENGTH: 2000,

  // Comment templates for bot responses
  DELETION_COMMENT_TEMPLATES: {
    default: '**{username}** removed their message: *{context}*',
    frequent: '**{username}** removed their message again ({deleteCount} total): *{context}*',
    warning:
      '**{username}** removed their message ({deleteCount} deletions - approaching limit): *{context}*',
    owner: '**{username}** (Owner) removed their message: *{context}*',
  },
};

// File paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const BLOCKED_USERS_FILE = path.join(DATA_DIR, 'blockedUsers.json');
const DELETION_HISTORY_FILE = path.join(DATA_DIR, 'messageDeletionHistory.json');
const DELETED_MESSAGES_FILE = path.join(DATA_DIR, 'deletedMessages.json');

// In-memory storage
let blockedUsers = new Set();
let deletionHistory = new Map(); // userId -> array of deletion timestamps
let rapidDeletions = new Map(); // userId -> array of rapid deletion events
let deletedMessages = new Map(); // messageId -> full deletion record for WebUI

/**
 * Initialize the malicious user manager
 */
async function init() {
  try {
    await ensureDataDirectory();
    await loadBlockedUsers();
    await loadDeletionHistory();
    await loadDeletedMessages();

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
 * Load deleted messages for WebUI from file
 */
async function loadDeletedMessages() {
  try {
    const data = await fs.readFile(DELETED_MESSAGES_FILE, 'utf8');
    const messages = JSON.parse(data);

    deletedMessages = new Map();
    for (const [messageId, messageData] of Object.entries(messages.deletedMessages || {})) {
      deletedMessages.set(messageId, messageData);
    }

    logger.info({ messageCount: deletedMessages.size }, 'Loaded deleted messages for WebUI');
  } catch (error) {
    if (error.code === 'ENOENT') {
      deletedMessages = new Map();
      logger.info('No deleted messages file found, starting fresh');
    } else {
      logger.error({ error }, 'Error loading deleted messages');
      throw error;
    }
  }
}

/**
 * Save deleted messages for WebUI to file
 */
async function saveDeletedMessages() {
  try {
    const data = {
      deletedMessages: Object.fromEntries(deletedMessages),
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(DELETED_MESSAGES_FILE, JSON.stringify(data, null, 2));
    logger.debug('Saved deleted messages to file');
  } catch (error) {
    logger.error({ error }, 'Error saving deleted messages');
    throw error;
  }
}

/**
 * Check if a user is the bot owner
 * @param {string} userId - User ID to check
 * @returns {boolean} True if user is owner
 */
function isOwner(userId) {
  return userId === process.env.OWNER_ID;
}

/**
 * Record a message deletion event
 * @param {string} userId - User who deleted the message
 * @param {string} messageId - ID of deleted message
 * @param {string} channelId - Channel where message was deleted
 * @param {string} content - Content of deleted message (first 100 chars)
 * @param {number} timeSinceCreation - Time between message creation and deletion (ms)
 * @param {Object} fullMessage - Complete message object for WebUI storage (optional)
 */
async function recordDeletion(
  userId,
  messageId,
  channelId,
  content,
  timeSinceCreation,
  fullMessage = null
) {
  try {
    const now = Date.now();
    const userIsOwner = isOwner(userId);

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
      isOwner: userIsOwner,
    };

    deletionHistory.get(userId).push(deletionRecord);

    // Store full message details for WebUI if enabled and message provided
    if (
      DETECTION_CONFIG.ENABLE_WEBUI_TRACKING &&
      DETECTION_CONFIG.STORE_DELETED_MESSAGE_CONTENT &&
      fullMessage
    ) {
      const webUIRecord = {
        messageId,
        userId,
        channelId,
        username: fullMessage.author?.username || 'Unknown',
        displayName: fullMessage.author?.displayName || fullMessage.author?.username || 'Unknown',
        content: content ? content.substring(0, DETECTION_CONFIG.MAX_STORED_CONTENT_LENGTH) : '',
        fullContent: content || '',
        timestamp: now,
        messageCreatedAt: fullMessage.createdAt ? fullMessage.createdAt.getTime() : now,
        timeSinceCreation,
        isOwner: userIsOwner,
        channelName: fullMessage.channel?.name || 'Unknown Channel',
        guildId: fullMessage.guildId || null,
        attachments: fullMessage.attachments
          ? Array.from(fullMessage.attachments.values()).map(att => ({
              id: att.id,
              name: att.name,
              url: att.url,
              size: att.size,
              contentType: att.contentType,
            }))
          : [],
        embeds: fullMessage.embeds ? fullMessage.embeds.length : 0,
        deletionCount: deletionHistory.get(userId).length,
        isRapidDeletion: timeSinceCreation < DETECTION_CONFIG.RAPID_DELETE_THRESHOLD_MS,
        botResponseId: null, // Will be set by message handler if there's a bot response
        status: 'pending_review', // pending_review, approved, flagged, ignored
        reviewedBy: null,
        reviewedAt: null,
        notes: '',
      };

      deletedMessages.set(messageId, webUIRecord);
      await saveDeletedMessages();
    }

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
          isOwner: userIsOwner,
        },
        'Rapid message deletion detected'
      );
    }

    // Check for suspicious behavior (with owner exceptions)
    await checkForSuspiciousBehavior(userId);

    // Save to file
    await saveDeletionHistory();

    logger.debug(
      { userId, messageId, timeSinceCreation, isOwner: userIsOwner },
      'Recorded message deletion'
    );
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
    const userIsOwner = isOwner(userId);

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

    // Use different thresholds for owners vs regular users
    const hourlyLimit = userIsOwner
      ? DETECTION_CONFIG.OWNER_MAX_DELETIONS_PER_HOUR
      : DETECTION_CONFIG.MAX_DELETIONS_PER_HOUR;

    const dailyLimit = userIsOwner
      ? DETECTION_CONFIG.OWNER_MAX_DELETIONS_PER_DAY
      : DETECTION_CONFIG.MAX_DELETIONS_PER_DAY;

    // Determine suspicion level
    let isSuspicious = false;
    const reasons = [];

    if (deletionsLastHour >= hourlyLimit) {
      isSuspicious = true;
      reasons.push(`${deletionsLastHour} deletions in last hour (limit: ${hourlyLimit})`);
    }

    if (deletionsLastDay >= dailyLimit) {
      isSuspicious = true;
      reasons.push(`${deletionsLastDay} deletions in last day (limit: ${dailyLimit})`);
    }

    // Rapid deletions threshold applies to everyone (but owners get logged differently)
    if (rapidDeletionsLastHour >= 3) {
      isSuspicious = true;
      reasons.push(`${rapidDeletionsLastHour} rapid deletions in last hour`);
    }

    if (isSuspicious) {
      const logLevel = userIsOwner ? 'info' : 'warn';
      logger[logLevel](
        {
          userId,
          isOwner: userIsOwner,
          deletionsLastHour,
          deletionsLastDay,
          rapidDeletionsLastHour,
          hourlyLimit,
          dailyLimit,
          reasons,
        },
        userIsOwner
          ? 'Owner deletion activity (monitoring only)'
          : 'Suspicious user behavior detected'
      );

      // Only request blocking for non-owners
      if (!userIsOwner && client && !blockedUsers.has(userId)) {
        await requestBlockApproval(userId, reasons, client);
      } else if (userIsOwner) {
        logger.info(
          { userId, reasons },
          'Owner exceeded thresholds - no action taken due to owner status'
        );
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

    // Clean up deleted messages for WebUI
    for (const [messageId, messageInfo] of deletedMessages.entries()) {
      if (messageInfo.timestamp < cutoffTime) {
        deletedMessages.delete(messageId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      await saveDeletionHistory();
      await saveDeletedMessages();
      logger.info({ cleanedCount }, 'Cleaned up old deletion history and deleted messages');
    }
  } catch (error) {
    logger.error({ error }, 'Error cleaning up old data');
  }
}

/**
 * Get deleted messages for WebUI (owner-only access)
 * @param {string} requestingUserId - User requesting the data
 * @param {Object} filters - Optional filters
 * @returns {Array} Array of deleted message records
 */
function getDeletedMessagesForWebUI(requestingUserId, filters = {}) {
  // Only allow owner access
  if (!isOwner(requestingUserId)) {
    logger.warn({ requestingUserId }, 'Unauthorized access attempt to deleted messages');
    throw new Error('Access denied: Owner privileges required');
  }

  let messages = Array.from(deletedMessages.values());

  // Apply filters
  if (filters.status) {
    messages = messages.filter(msg => msg.status === filters.status);
  }

  if (filters.userId) {
    messages = messages.filter(msg => msg.userId === filters.userId);
  }

  if (filters.channelId) {
    messages = messages.filter(msg => msg.channelId === filters.channelId);
  }

  if (filters.isRapidDeletion !== undefined) {
    messages = messages.filter(msg => msg.isRapidDeletion === filters.isRapidDeletion);
  }

  if (filters.startDate) {
    messages = messages.filter(msg => msg.timestamp >= filters.startDate);
  }

  if (filters.endDate) {
    messages = messages.filter(msg => msg.timestamp <= filters.endDate);
  }

  // Sort by timestamp (newest first)
  messages.sort((a, b) => b.timestamp - a.timestamp);

  return messages;
}

/**
 * Update deleted message status (owner-only)
 * @param {string} requestingUserId - User making the request
 * @param {string} messageId - Message ID to update
 * @param {string} status - New status
 * @param {string} notes - Optional notes
 */
async function updateDeletedMessageStatus(requestingUserId, messageId, status, notes = '') {
  // Only allow owner access
  if (!isOwner(requestingUserId)) {
    logger.warn(
      { requestingUserId, messageId },
      'Unauthorized attempt to update deleted message status'
    );
    throw new Error('Access denied: Owner privileges required');
  }

  const message = deletedMessages.get(messageId);
  if (!message) {
    throw new Error('Message not found');
  }

  const validStatuses = ['pending_review', 'approved', 'flagged', 'ignored'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  message.status = status;
  message.reviewedBy = requestingUserId;
  message.reviewedAt = Date.now();
  message.notes = notes;

  deletedMessages.set(messageId, message);
  await saveDeletedMessages();

  logger.info(
    {
      messageId,
      reviewedBy: requestingUserId,
      status,
      userId: message.userId,
    },
    'Deleted message status updated'
  );

  return message;
}

/**
 * Get deletion comment template based on user and deletion count
 * @param {string} userId - User ID
 * @param {string} username - Username
 * @param {string} contextText - Context text
 * @param {number} deleteCount - Number of deletions
 * @returns {string} Formatted comment
 */
function getDeletionComment(userId, username, contextText, deleteCount) {
  const userIsOwner = isOwner(userId);

  let templateKey = 'default';
  if (userIsOwner) {
    templateKey = 'owner';
  } else if (deleteCount >= 5) {
    templateKey = 'frequent';
  } else if (deleteCount >= 2) {
    templateKey = 'warning';
  }

  const template = DETECTION_CONFIG.DELETION_COMMENT_TEMPLATES[templateKey];

  return template
    .replace('{username}', username)
    .replace('{context}', contextText)
    .replace('{deleteCount}', deleteCount);
}

/**
 * Link deleted message to bot response (for WebUI tracking)
 * @param {string} messageId - Deleted message ID
 * @param {string} botResponseId - Bot response message ID
 */
async function linkDeletedMessageToBotResponse(messageId, botResponseId) {
  const message = deletedMessages.get(messageId);
  if (message) {
    message.botResponseId = botResponseId;
    deletedMessages.set(messageId, message);
    await saveDeletedMessages();

    logger.debug({ messageId, botResponseId }, 'Linked deleted message to bot response');
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
  getDeletedMessagesForWebUI,
  updateDeletedMessageStatus,
  getDeletionComment,
  linkDeletedMessageToBotResponse,
  isOwner,
  DETECTION_CONFIG,
};
