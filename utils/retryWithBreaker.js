/**
 * retryWithBreaker.js
 *
 * A retry + circuit breaker utility for async functions with human-in-the-loop approval.
 *
 * Usage:
 *   await retryWithBreaker(() => openaiCall(...), {
 *     maxRetries: 3,
 *     breakerLimit: 3,
 *     breakerTimeoutMs: 120000,
 *     onBreakerOpen,
 *     requireApproval: true,
 *     approvalDetails: { type: 'api_call', user: 'username', context: 'context' },
 *     client: discordClient
 *   })
 */

const breakerManager = require('../src/middleware/breakerManager');
const { createLogger } = require('../src/core/logger');
const logger = createLogger('retryBreaker');
const humanCircuitBreaker = require('./humanCircuitBreaker');

const breakerState = {
  failures: 0,
  breakerOpen: false,
  breakerOpenedAt: null,
};

/**
 * Retry an async function with exponential backoff and circuit breaker.
 * @param {Function} fn - The async function to call.
 * @param {Object} [opts]
 * @param {number} [opts.maxRetries=3] - Max retry attempts.
 * @param {number} [opts.breakerLimit=3] - Failures before breaker opens.
 * @param {number} [opts.breakerTimeoutMs=120000] - Breaker open duration (ms).
 * @param {Function} [opts.onBreakerOpen] - Callback when breaker opens.
 * @param {boolean} [opts.requireApproval=false] - Whether to require human approval.
 * @param {Object} [opts.approvalDetails] - Details for human approval.
 * @param {Object} [opts.client] - Discord client for notifications.
 * @returns {Promise<*>}
 */
async function retryWithBreaker(fn, opts = {}) {
  const {
    maxRetries = 3,
    breakerLimit = 3,
    breakerTimeoutMs = 120000,
    onBreakerOpen = null,
    requireApproval = false,
    approvalDetails = null,
    client = null,
  } = opts;

  // Check if circuit breaker is open
  if (breakerState.breakerOpen || breakerManager.isBreakerOpen()) {
    const elapsed = Date.now() - breakerState.breakerOpenedAt;
    if (breakerState.breakerOpen && elapsed < breakerTimeoutMs) {
      throw new Error(
        `Circuit breaker is open. Try again in ${Math.ceil((breakerTimeoutMs - elapsed) / 1000)}s`
      );
    } else {
      breakerState.breakerOpen = false;
      breakerState.failures = 0;
      // Note: We don't reset the global breaker here, that requires explicit reset
    }
  }

  // If human approval is required, request it before proceeding
  if (requireApproval) {
    if (!approvalDetails) {
      logger.warn('Human approval required but no approval details provided');
      throw new Error('Human approval required but no details provided');
    }

    logger.info(
      {
        approvalDetails,
        requireApproval,
      },
      'Requesting human approval before execution'
    );

    const { approved, result, error } = await humanCircuitBreaker.executeWithApproval(
      approvalDetails,
      fn,
      client
    );

    if (!approved) {
      throw new Error('Operation not approved by human circuit breaker');
    }

    if (error) {
      throw error;
    }

    return result;
  }

  // Normal retry logic if no human approval required
  let attempt = 0;
  let lastError = null;
  while (attempt <= maxRetries) {
    try {
      const result = await fn();
      breakerState.failures = 0;
      return result;
    } catch (err) {
      lastError = err;

      // Check if this is a non-retryable error
      const isContentPolicyViolation =
        err.status === 400 &&
        (err.code === 'moderation_blocked' ||
          err.message?.includes('content policy') ||
          err.message?.includes('safety system'));

      const isNonRetryableError =
        isContentPolicyViolation ||
        err.status === 401 || // Authentication error
        err.status === 403 || // Forbidden
        err.code === 'invalid_request_error';

      if (isNonRetryableError) {
        logger.warn(
          {
            error: err.message,
            status: err.status,
            code: err.code,
            attempt,
          },
          'Non-retryable error encountered, failing immediately'
        );
        throw err; // Don't retry, just fail immediately
      }

      attempt++;
      breakerState.failures++;

      // Log the failure
      logger.warn(
        {
          error: err.message,
          attempt,
          maxRetries,
          breakerFailures: breakerState.failures,
          breakerLimit,
        },
        'Operation failed, may retry'
      );

      // Check if we need to open the breaker
      if (breakerState.failures >= breakerLimit) {
        breakerState.breakerOpen = true;
        breakerState.breakerOpenedAt = Date.now();

        // Set the global breaker state
        breakerManager.setBreakerOpen(true);

        // Notify the owner
        if (onBreakerOpen) {
          try {
            onBreakerOpen(lastError);
          } catch (notifyError) {
            logger.error({ error: notifyError }, 'Error in onBreakerOpen callback');
          }
        }

        // Try to notify via breaker manager
        try {
          breakerManager.notifyOwnerBreakerTriggered(
            `Repeated failures (${breakerState.failures}): ${lastError.message}`
          );
        } catch (notifyError) {
          logger.error({ error: notifyError }, 'Error notifying owner about breaker');
        }

        throw new Error(`Circuit breaker opened due to repeated failures: ${lastError.message}`);
      }

      if (attempt > maxRetries) break;

      // Exponential backoff with configurable limits
      const initialBackoff = opts.initialBackoffMs || 200;
      const maxBackoff = opts.maxBackoffMs || 10000;
      const backoffMs = Math.min(initialBackoff * Math.pow(2, attempt - 1), maxBackoff);
      logger.info({ backoffMs, attempt }, 'Backing off before retry');
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }

  throw lastError;
}

module.exports = retryWithBreaker;
