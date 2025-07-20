/**
 * Conversation Manager Selector
 *
 * This module provides the PocketFlow conversation system as the sole conversation manager.
 * Legacy conversation systems have been removed in favor of PocketFlow's graph-based architecture.
 *
 * @module ConversationManagerSelector
 */

const { createLogger } = require('../core/logger');
const logger = createLogger('conversationManagerSelector');

// PocketFlow is now the only conversation system
logger.info('Using PocketFlow conversation system (graph-based architecture)');
const conversationManager = require('./pocketFlowAdapter');

// Export all functions from PocketFlow adapter
module.exports = conversationManager;
