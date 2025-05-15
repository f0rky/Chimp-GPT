/**
 * retryWithBreaker.js
 *
 * A simple retry + circuit breaker utility for async functions.
 *
 * Usage:
 *   await retryWithBreaker(() => openaiCall(...), { maxRetries: 3, breakerLimit: 5, breakerTimeoutMs: 120000, onBreakerOpen })
 */

const breakerState = {
  failures: 0,
  breakerOpen: false,
  breakerOpenedAt: null
};

/**
 * Retry an async function with exponential backoff and circuit breaker.
 * @param {Function} fn - The async function to call.
 * @param {Object} [opts]
 * @param {number} [opts.maxRetries=3] - Max retry attempts.
 * @param {number} [opts.breakerLimit=5] - Failures before breaker opens.
 * @param {number} [opts.breakerTimeoutMs=120000] - Breaker open duration (ms).
 * @param {Function} [opts.onBreakerOpen] - Callback when breaker opens.
 * @returns {Promise<*>}
 */
async function retryWithBreaker(fn, opts = {}) {
  const {
    maxRetries = 3,
    breakerLimit = 5,
    breakerTimeoutMs = 120000,
    onBreakerOpen = null
  } = opts;

  if (breakerState.breakerOpen) {
    const elapsed = Date.now() - breakerState.breakerOpenedAt;
    if (elapsed < breakerTimeoutMs) {
      throw new Error(`Circuit breaker is open. Try again in ${Math.ceil((breakerTimeoutMs - elapsed) / 1000)}s`);
    } else {
      breakerState.breakerOpen = false;
      breakerState.failures = 0;
    }
  }

  let attempt = 0;
  let lastError = null;
  while (attempt <= maxRetries) {
    try {
      const result = await fn();
      breakerState.failures = 0;
      return result;
    } catch (err) {
      lastError = err;
      attempt++;
      breakerState.failures++;
      if (breakerState.failures >= breakerLimit) {
        breakerState.breakerOpen = true;
        breakerState.breakerOpenedAt = Date.now();
        if (onBreakerOpen) onBreakerOpen(lastError);
        throw new Error('Circuit breaker opened due to repeated failures.');
      }
      if (attempt > maxRetries) break;
      // Exponential backoff
      await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

module.exports = retryWithBreaker;
