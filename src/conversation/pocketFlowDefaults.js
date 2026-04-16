/**
 * Shared PocketFlow configuration defaults
 *
 * Both PocketFlowAdapter and ParallelTestingAdapter construct the same
 * flow configuration from configValidator values.  This module centralises
 * those defaults so they are defined once.
 *
 * @module conversation/pocketFlowDefaults
 */

const config = require('../core/configValidator');

/**
 * Build the common PocketFlow options object.
 *
 * @param {Object} [overrides] - Per-adapter overrides merged on top.
 * @returns {Object} PocketFlow configuration suitable for
 *   PocketFlowConversationManager or ParallelConversationTester.
 */
function buildPocketFlowOptions(overrides = {}) {
  return {
    cleanupInterval: config.POCKETFLOW_CLEANUP_INTERVAL,
    maxConcurrentFlows: config.POCKETFLOW_MAX_CONCURRENT_FLOWS,
    flows: {
      individual: {
        timeout: 15000,
        config: {
          charsPerToken: 4,
          defaultMaxTokens: config.POCKETFLOW_CONTEXT_MAX_TOKENS,
          maxConversationLength: 20,
        },
      },
      blended: {
        confidenceThreshold: config.POCKETFLOW_INTENT_CONFIDENCE_THRESHOLD,
        config: {
          maxConversationLength: 15,
          defaultMaxTokens: config.POCKETFLOW_CONTEXT_MAX_TOKENS * 1.25,
          blendedChannelThreshold: 3,
          blendedModeTimeout: 300000,
        },
      },
      command: {
        enableBuiltins: true,
      },
    },
    ...overrides,
  };
}

/**
 * Create a mock command handler (placeholder until real integration).
 *
 * @param {string} [label='PocketFlow'] - Label shown in debug logs.
 * @returns {Object} Object with an `executeCommand` method.
 */
function createMockCommandHandler(label = 'PocketFlow') {
  return {
    executeCommand: async (commandName, _context) => {
      const { createLogger } = require('../core/logger');
      const logger = createLogger('mockCommandHandler');
      logger.debug(`Mock command execution: ${commandName}`);
      return {
        response: `Command ${commandName} executed (${label} mode)`,
      };
    },
  };
}

module.exports = { buildPocketFlowOptions, createMockCommandHandler };
