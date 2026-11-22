'use strict';
const crypto = require('crypto');
const { budgetPolicy, defaultClient } = require('./slipgateClient');
const { defaultTracker } = require('./quakeRoundTracker');
const { renderSlipgateCard } = require('../handlers/slipgateCardRenderer');
const { createScoreboardLifecycle } = require('./scoreboardLifecycle');
const MAX_WATCHES = 3;
// Includes injected managers as well as the default manager: the pilot limit is process-wide.
const processWatches = new Set();
function meaningfulHash(s) {
  const {
    fetchedAt: _fetchedAt,
    sourceUpdatedAt: _sourceUpdatedAt,
    elapsedSeconds: _elapsedSeconds,
    results,
    ...rest
  } = s;
  rest.results = results?.map(({ retainedAt: _retainedAt, ...r }) => r);
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}
function createWatchManager({
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  tracker = defaultTracker,
  now = Date.now,
} = {}) {
  const watches = new Map();
  let shuttingDown = false;
  function start(key, { channel, client = defaultClient, filter = '', intervalMs = 60000 } = {}) {
    if (shuttingDown) return { ok: false, reason: 'Quake tracking is shutting down.' };
    const p = client.pollingPolicy();
    if (!p.enabled) return { ok: false, reason: p.reason };
    if (!key || !channel?.send) return { ok: false, reason: 'Watch requires a guild channel.' };
    if (watches.has(key))
      return {
        ok: !watches.get(key).stopped,
        existing: true,
        reason: 'Watch is stopping; try again after stop completes.',
      };
    if ((p.experimental && processWatches.size) || [...processWatches].some(w => w.experimental))
      return { ok: false, reason: 'Experimental local budget allows one watch per process.' };
    if (watches.size >= MAX_WATCHES)
      return { ok: false, reason: 'Maximum of three watches reached.' };
    const w = {
      key,
      channel,
      address: null,
      stopped: false,
      timer: null,
      inflight: null,
      writeInFlight: null,
      writeTail: Promise.resolve(),
      maintenance: null,
      generation: Symbol(),
      hash: null,
      lastChangedAt: null,
      lastCheckedAt: null,
      failures: 0,
      message: null,
      experimental: Boolean(p.experimental),
      intervalMs: Math.max(60000, intervalMs, p.minIntervalMs || 0),
      stateIntervalMs: 60000,
      paused: false,
    };
    watches.set(key, w);
    processWatches.add(w);
    const active = generation =>
      !w.stopped && w.generation === generation && watches.get(key) === w;
    const perform = async fn => {
      if (w.stopped) return null;
      // Archive edits and live transport may run concurrently; serialize actual Discord writes.
      const pending = w.writeTail.then(() => (w.stopped ? null : fn()));
      w.writeTail = pending.catch(() => {
        // Keep subsequent transport operations usable after a failed write.
      });
      w.writeInFlight = pending;
      try {
        return await pending;
      } finally {
        w.message = w.cards?.message || w.message;
        if (w.writeInFlight === pending) w.writeInFlight = null;
      }
    };
    w.cards = createScoreboardLifecycle({
      channel,
      client,
      deferReconciliation: true,
      perform,
      now,
      active: () => !w.stopped && watches.get(key) === w,
    });
    const maintenanceClient = { ...client };
    for (const method of ['getMatch', 'listMatches']) {
      maintenanceClient[method] = async (...args) => {
        if (w.stopped || watches.get(key) !== w) throw new Error('Watch stopped');
        return client[method](...args);
      };
    }
    function maintain(snapshot) {
      if (w.maintenance || w.stopped || (client.pollingPolicy().cooldownMs || 0) > 0) return;
      // One bounded optional pass per scheduled poll, never a second timer or an unbounded queue.
      w.maintenance = Promise.resolve()
        .then(async () => {
          if (w.stopped || watches.get(key) !== w) return;
          await w.cards.reconcile();
          if (w.stopped || watches.get(key) !== w || (client.pollingPolicy().cooldownMs || 0) > 0)
            return;
          await tracker.observe(snapshot, maintenanceClient);
        })
        .catch(() => {
          // Historical failures do not consume the current watch's transport failure budget.
        })
        .finally(() => {
          w.maintenance = null;
        });
    }
    function schedule(fn, ms) {
      // Node truncates overflowing timeout values to 1ms. Split long provider cooldowns.
      const chunk = Math.min(ms, 2147483647);
      const timer = setTimer(
        ms > chunk
          ? () => {
              if (!w.stopped) w.timer = schedule(fn, ms - chunk);
            }
          : fn,
        chunk
      );
      timer?.unref?.();
      return timer;
    }
    const tick = async () => {
      if (w.stopped || w.inflight) return;
      const generation = w.generation;
      let delay = Math.max(
        w.stateIntervalMs,
        intervalMs,
        client.pollingPolicy().minIntervalMs || 0
      );
      let moveCard = false;
      let maintenanceSnapshot = null;
      const write = async payload => {
        if (!active(generation)) return;
        try {
          await w.cards.publish(payload, moveCard);
        } finally {
          w.message = w.cards.message;
          // An uncertain reposition POST must never turn the stop-status edit into another POST.
          moveCard = false;
        }
      };
      const pause = async cooldownMs => {
        delay = Math.max(delay, cooldownMs);
        w.intervalMs = delay;
        w.paused = true;
        if (w.message)
          await write({
            content: `Auto-refresh paused: Slipgate rate limit/backoff. Next refresh no sooner than ${Math.ceil(delay / 1000)}s.`,
            allowedMentions: { parse: [] },
          });
      };
      const work = (async () => {
        try {
          const s = w.address
            ? await client.getServer(w.address, { forceRefresh: true, includePrediction: true })
            : await client.selectServer(filter, { includePrediction: true });
          if (!active(generation)) return;
          if (!s) throw new Error('No matching server');
          w.address = s.address;
          await w.cards.prepare(s);
          w.message = w.cards.message;
          if (!active(generation)) return;
          moveCard = !s.stale && !s.quality?.a2sOnly && (await w.cards.shouldMove());
          if (!active(generation)) return;
          w.stateIntervalMs = !(s.players || []).some(player => player.team !== 3)
            ? 300000
            : /warmup|waiting/i.test(s.state || '')
              ? 120000
              : 60000;
          delay = Math.max(
            w.stateIntervalMs,
            intervalMs,
            client.pollingPolicy().minIntervalMs || 0
          );
          w.intervalMs = delay;
          const cooldownMs = client.pollingPolicy().cooldownMs || 0;
          if (cooldownMs > 0) {
            // Preserve prior success evidence; cooldown snapshots are not successful checks.
            if (!w.message)
              await write({
                embeds: [
                  renderSlipgateCard({
                    ...s,
                    localCheckedAt: w.lastCheckedAt,
                    localChangedAt: w.lastChangedAt,
                  }),
                ],
                allowedMentions: { parse: [] },
              });
            await pause(cooldownMs);
            return;
          }
          const hash = meaningfulHash(s);
          const fresh = !s.stale && !s.quality?.a2sOnly;
          const changedAt = fresh && w.hash !== hash ? now() : w.lastChangedAt;
          const checkedAt = fresh ? now() : w.lastCheckedAt;
          const displaySnapshot = {
            ...s,
            localCheckedAt: checkedAt,
            localChangedAt: changedAt,
          };
          if (w.hash === hash && !w.paused && !moveCard && w.message && !fresh) {
            if (s.stale) throw new Error('Stale Slipgate snapshot');
            w.failures = 0;
            maintenanceSnapshot = s;
            return;
          }
          const payload = {
            content: `Auto-refresh active · ${Math.ceil(delay / 1000)}s minimum.`,
            embeds: [renderSlipgateCard(displaySnapshot)],
            allowedMentions: { parse: [] },
          };
          await write(payload);
          if (!active(generation)) return;
          if (fresh) {
            w.hash = hash;
            w.lastChangedAt = changedAt;
            w.lastCheckedAt = checkedAt;
          }
          w.paused = false;
          if (!fresh)
            throw new Error(s.stale ? 'Stale Slipgate snapshot' : 'Unreliable A2S-only snapshot');
          w.failures = 0;
          maintenanceSnapshot = s;
        } catch (caught) {
          let error = caught;
          if (!active(generation)) return;
          if (error.status === 429) {
            try {
              await pause(error.retryAfterMs || client.pollingPolicy().cooldownMs || 60000);
              return;
            } catch (writeError) {
              error = writeError;
            }
          }
          w.failures++;
          if (
            [10008, 50001, 50013].includes(error.code) ||
            error.status === 404 ||
            error.uncertainSend ||
            w.failures >= 3
          ) {
            // Preserve the last embed/fetch timestamp, but make a provider-side stop truthful.
            if (w.message && ![10008, 50001, 50013].includes(error.code)) {
              try {
                await write({
                  content:
                    'Auto-refresh stopped: Slipgate unavailable. Run !quakestats to start again.',
                  allowedMentions: { parse: [] },
                });
              } catch (_) {
                /* Transport may also be unavailable; never recreate the card. */
              }
            }
            if (!active(generation)) return;
            w.stopped = true;
            if (watches.get(key) === w) watches.delete(key);
            processWatches.delete(w);
          }
        }
      })();
      w.inflight = work;
      try {
        await work;
      } finally {
        w.inflight = null;
      }
      if (active(generation)) {
        w.timer = schedule(tick, delay);
        if (maintenanceSnapshot) maintain(structuredClone(maintenanceSnapshot));
      }
    };
    w.timer = schedule(tick, 0);
    return { ok: true, existing: false };
  }
  async function stop(key) {
    const w = watches.get(key);
    if (!w) return false;
    if (w.stopPromise) return w.stopPromise;
    w.stopped = true;
    w.generation = Symbol();
    clearTimer(w.timer);
    w.stopPromise = (async () => {
      if (w.writeInFlight) {
        try {
          await w.writeInFlight;
        } catch (_) {
          /* The failed write has settled. */
        }
      }
      // This explicit stop-status edit is separate from the invalidated poll generation.
      // It changes no fetched/source timestamp and is settled before acknowledging stop.
      w.message = w.cards.message || w.message;
      if (w.message && !w.cards.retainedFinal) {
        try {
          await w.message.edit({
            content: 'Auto-refresh stopped. Run !quakestats to start again.',
            allowedMentions: { parse: [] },
          });
        } catch (_) {
          /* Deleted/inaccessible cards cannot be updated; never recreate them. */
        }
      }
      if (watches.get(key) === w) watches.delete(key);
      processWatches.delete(w);
      return true;
    })();
    return w.stopPromise;
  }
  async function stopAll() {
    await Promise.all([...watches.keys()].map(stop));
  }
  async function shutdown() {
    shuttingDown = true;
    await stopAll();
  }
  function status(key) {
    const w = watches.get(key);
    return w
      ? {
          pending: !w.message,
          stopping: w.stopped,
          paused: w.paused,
          intervalMs: w.intervalMs,
          url: w.message?.url || null,
        }
      : null;
  }
  return { start, stop, stopAll, shutdown, status, _watches: watches };
}
const manager = createWatchManager();
// Invalidate generations and timers immediately when the application's shutdown begins.
// The existing application signal handlers own process exit and transport teardown.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'beforeExit'])
  process.prependOnceListener(signal, () => {
    // Invalidation starts synchronously; application signal handlers own process exit.
    manager.shutdown().catch(() => {
      console.error('Quake watch shutdown did not complete.');
    });
  });
module.exports = {
  ...manager,
  createWatchManager,
  meaningfulHash,
  policy: env => {
    const { enabled, reason, minIntervalMs } = budgetPolicy(env);
    return { enabled, reason, minIntervalMs };
  },
  MAX_WATCHES,
};
