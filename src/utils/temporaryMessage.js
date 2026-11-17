const { createLogger } = require('../core/logger');

const logger = createLogger('temporaryMessage');
const QUAKE_RESULT_REFRESH_MS = 60 * 1000;
const QUAKE_RESULT_TTL_MS = 5 * 60 * 1000;

function unref(timer) {
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

function scheduleMessageDeletion(
  message,
  delayMs = QUAKE_RESULT_TTL_MS,
  { setTimer = setTimeout, log = logger } = {}
) {
  if (!message || typeof message.delete !== 'function') return null;

  const timer = setTimer(() => {
    Promise.resolve()
      .then(() => message.delete())
      .catch(error => {
        if (error?.code !== 10008) {
          log.warn({ error, messageId: message.id }, 'Unable to delete temporary Discord message');
        }
      });
  }, delayMs);

  return unref(timer);
}

/**
 * Re-renders a request-scoped Quake result every minute, then removes it after five minutes.
 * Refresh failures are logged but leave the most recent successful result visible.
 */
function scheduleQuakeResultLifecycle(
  message,
  refresh,
  {
    setInterval: setRepeatingTimer = setInterval,
    setTimeout: setExpiryTimer = setTimeout,
    clearInterval: stopRepeatingTimer = clearInterval,
    log = logger,
    pollingPolicy = () => require('../services/slipgateClient').defaultClient.pollingPolicy(),
  } = {}
) {
  if (!message || typeof message.delete !== 'function' || typeof refresh !== 'function')
    return null;

  let stopped = false;
  let refreshInFlight = false;
  const refreshTimer = unref(
    setRepeatingTimer(() => {
      if (stopped || refreshInFlight || !pollingPolicy().enabled) return;
      refreshInFlight = true;
      Promise.resolve()
        .then(() => refresh(message))
        .catch(error => {
          if (error?.code === 10008) {
            stopped = true;
            stopRepeatingTimer(refreshTimer);
            return;
          }
          log.warn({ error, messageId: message.id }, 'Unable to refresh temporary Quake result');
        })
        .finally(() => {
          refreshInFlight = false;
        });
    }, QUAKE_RESULT_REFRESH_MS)
  );

  const stop = () => {
    stopped = true;
    stopRepeatingTimer(refreshTimer);
  };

  const expiryTimer = unref(
    setExpiryTimer(() => {
      stop();
      Promise.resolve()
        .then(() => message.delete())
        .catch(error => {
          if (error?.code !== 10008) {
            log.warn(
              { error, messageId: message.id },
              'Unable to delete temporary Discord message'
            );
          }
        });
    }, QUAKE_RESULT_TTL_MS)
  );

  return { refreshTimer, expiryTimer, stop };
}

module.exports = {
  QUAKE_RESULT_REFRESH_MS,
  QUAKE_RESULT_TTL_MS,
  scheduleMessageDeletion,
  scheduleQuakeResultLifecycle,
};
