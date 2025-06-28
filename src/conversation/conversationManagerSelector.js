/**
 * Conversation Manager Selector
 *
 * This module dynamically selects between blended and individual conversation managers
 * based on the configuration setting USE_BLENDED_CONVERSATIONS.
 *
 * @module ConversationManagerSelector
 */

const config = require('./configValidator');
const { createLogger } = require('./logger');
const logger = createLogger('conversationManagerSelector');

// Dynamically load the appropriate conversation manager
let conversationManager;

if (config.USE_BLENDED_CONVERSATIONS) {
  logger.info('Using blended conversation manager');
  conversationManager = require('./useBlendedConversations');
} else {
  logger.info('Using individual conversation manager');
  conversationManager = require('./useSimpleOptimizer');
}

// Export all functions from the selected manager
module.exports = conversationManager;
