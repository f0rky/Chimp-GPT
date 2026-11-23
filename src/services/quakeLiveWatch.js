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
  env = process.env || {},
  rivalryService = null,
  commentaryProvider = null,
  rivalryEnabled = env.SLIPGATE_RIVALRY_ENABLED === 'true',
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
      client,
      address: null,
      lastPublishedSnapshot: null,
      rivalryReport: null,
      rivalryIdentity: null,
      rivalryCollectedIdentity: null,
      rivalryInFlight: null,
      rivalryController: new AbortController(),
      watchController: new AbortController(),
      rivalrySnapshot: null,
      suppressRivalry: false,
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
      refreshAt: 0,
      refreshPromise: null,
      tick: null,
    };
    watches.set(key, w);
    processWatches.add(w);
    const rivalryContext = rivalryEnabled
      ? require('./quakeRivalryContext').createRivalryContext({
          service: rivalryService || require('./quakeRivalryService').defaultService,
          commentaryProvider,
          enabled: () => true,
          env,
        })
      : null;
    w.rivalryContext = rivalryContext;
    const active = generation =>
      !w.stopped && w.generation === generation && watches.get(key) === w;
    const removeOwnReaction = message => {
      const botId = channel.client?.user?.id;
      if (!botId || !message?.reactions?.cache) return;
      const existing = message.reactions.cache.find(r => r.emoji?.name === '🔄');
      if (existing) {
        try {
          Promise.resolve(existing.users?.remove?.(botId)).catch(() => undefined);
        } catch (_) {
          // Failed cleanup must not affect the retained card or watch teardown.
        }
      }
    };
    w.removeOwnReaction = removeOwnReaction;
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
      rivalryContext,
      contextSignal: w.watchController.signal,
      active: () => !w.stopped && watches.get(key) === w,
    });
    const maintenanceClient = { ...client };
    for (const method of ['getMatch', 'listMatches']) {
      maintenanceClient[method] = async (...args) => {
        if (w.stopped || watches.get(key) !== w) throw new Error('Watch stopped');
        return client[method](...args);
      };
    }
    function maintain(observedSnapshot, { manual = false } = {}) {
      if (w.maintenance || w.stopped || (client.pollingPolicy().cooldownMs || 0) > 0) return;
      // One bounded optional pass per scheduled poll, never a second timer or an unbounded queue.
      w.maintenance = Promise.resolve()
        .then(async () => {
          if (w.stopped || watches.get(key) !== w) return;
          // Missing ratings share the provider queue, but never hold up the base card.
          // Enrichment seeds only the client's match-scoped cache; a later normal poll
          // renders it, so this old snapshot cannot overwrite newer scores or timestamps.
          if (
            client.enrichRatings &&
            !observedSnapshot.stale &&
            !observedSnapshot.quality?.a2sOnly
          ) {
            try {
              await client.enrichRatings(structuredClone(observedSnapshot));
            } catch (_) {
              /* Optional ELO coverage must not affect the current watch. */
            }
          }
          if (w.stopped || watches.get(key) !== w) return;
          const ratingsCooldown = client.pollingPolicy().cooldownMs || 0;
          if (ratingsCooldown > 0) {
            w.paused = true;
            w.lastPollOutcome = 'backoff';
            const delay = Math.max(w.intervalMs, ratingsCooldown);
            w.intervalMs = delay;
            clearTimer(w.timer);
            w.timer = schedule(w.tick, delay);
            await w.cards.publish({
              content: `Auto-refresh paused: Slipgate rate limit/backoff. Next refresh no sooner than ${Math.ceil(delay / 1000)}s.`,
              allowedMentions: { parse: [] },
            });
            return;
          }
          await w.cards.reconcile({ allowOptionalContext: !manual });
          if (w.stopped || watches.get(key) !== w || (client.pollingPolicy().cooldownMs || 0) > 0)
            return;
          await tracker.observe(observedSnapshot, maintenanceClient);
          if (
            !manual &&
            rivalryContext &&
            ['WARMUP', 'LIVE'].includes(
              require('./quakeScoreboardPresentation').matchState(observedSnapshot)
            ) &&
            !observedSnapshot.stale &&
            !observedSnapshot.quality?.a2sOnly
          ) {
            const id = require('./quakeRivalryContext').identity(observedSnapshot);
            if (w.rivalryCollectedIdentity !== id && !w.rivalryInFlight) {
              w.rivalryIdentity = id;
              w.rivalryCollectedIdentity = id;
              const controller = w.rivalryController;
              const stillActive = () =>
                !w.stopped &&
                watches.get(key) === w &&
                w.rivalryController === controller &&
                !controller.signal.aborted;
              w.rivalryInFlight = rivalryContext
                .collect(observedSnapshot, { signal: controller.signal, isActive: stillActive })
                .then(async report => {
                  if (!stillActive()) return;
                  const commentary = report
                    ? await rivalryContext.summarize(observedSnapshot, report, {
                        signal: controller.signal,
                        isActive: stillActive,
                      })
                    : null;
                  if (!stillActive()) return;
                  w.rivalryReport = report;
                  w.rivalryCommentary = commentary;
                })
                .catch(() => {
                  /* Remember this identity to avoid retrying on every poll. */
                })
                .finally(() => {
                  w.rivalryInFlight = null;
                });
              await w.rivalryInFlight;
            }
          }
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
    const tick = async ({ manual = false } = {}) => {
      if (w.stopped || w.inflight) return null;
      if (w.timer) {
        clearTimer(w.timer);
        w.timer = null;
      }
      const generation = w.generation;
      let delay = Math.max(
        w.stateIntervalMs,
        intervalMs,
        client.pollingPolicy().minIntervalMs || 0
      );
      let moveCard = false;
      let maintenanceSnapshot = null;
      w.lastPollOutcome = 'pending';
      const write = async payload => {
        if (!active(generation)) return;
        try {
          if (w.rivalryReport && !w.suppressRivalry && payload.embeds?.[0]) {
            const { appendGauntContext } = require('../handlers/gauntCardRenderer');
            payload.embeds[0] = appendGauntContext(
              payload.embeds[0],
              { ...w.rivalryReport, commentary: w.rivalryCommentary || null },
              { kind: 'prematch' }
            );
          }
          await w.cards.publish(payload, moveCard);
          // Button-only controls. Remove only our obsolete reaction on a reused owned card.
          w.removeOwnReaction(w.cards.message);
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
        w.lastPollOutcome = 'backoff';
        if (w.message)
          await write({
            content: `Auto-refresh paused: Slipgate rate limit/backoff. Next refresh no sooner than ${Math.ceil(delay / 1000)}s.`,
            allowedMentions: { parse: [] },
          });
      };
      const work = (async () => {
        try {
          const s = w.address
            ? await client.getServer(w.address, {
                forceRefresh: true,
                includePrediction: true,
                deferRatings: true,
              })
            : await client.selectServer(filter, { includePrediction: true, deferRatings: true });
          if (!active(generation)) return;
          if (!s) throw new Error('No matching server');
          w.address = s.address;
          w.suppressRivalry = s.stale || s.quality?.a2sOnly;
          await w.cards.prepare(s);
          w.message = w.cards.message;
          if (w.cards.retainedFinal) {
            w.removeOwnReaction(w.message);
            w.reactionMessageId = null;
          }
          if (!active(generation)) return;
          moveCard = !s.stale && (await w.cards.shouldMove());
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
                components: [
                  {
                    type: 1,
                    components: [
                      {
                        type: 2,
                        style: 2,
                        label: 'Refresh',
                        emoji: { name: '🔄' },
                        custom_id: `quake_refresh:${encodeURIComponent(key)}`,
                      },
                    ],
                  },
                ],
                allowedMentions: { parse: [] },
              });
            await pause(cooldownMs);
            return;
          }
          const hash = meaningfulHash(s);
          const fresh = !s.stale && !s.quality?.a2sOnly;
          // A2S is a successful basic check, not authoritative live-match evidence.
          const successfulCheck = !s.stale;
          const changedAt = fresh && w.hash !== hash ? now() : w.lastChangedAt;
          const checkedAt = successfulCheck ? now() : w.lastCheckedAt;
          const displaySnapshot = { ...s, localCheckedAt: checkedAt, localChangedAt: changedAt };
          const freshIdentity =
            fresh && !s.stale ? require('./quakeRivalryContext').identity(s) : null;
          const warmupBoundary =
            fresh &&
            w.rivalrySnapshot &&
            /^(live|final)$/i.test(w.rivalrySnapshot.state || '') &&
            /^(warmup|waiting)$/i.test(s.state || '');
          if (freshIdentity && (w.rivalryIdentity !== freshIdentity || warmupBoundary)) {
            const { identity } = require('./quakeRivalryContext');
            const { matchState } = require('./quakeScoreboardPresentation');
            const previous = w.rivalrySnapshot;
            const promotion =
              previous &&
              !previous.matchGuid &&
              s.matchGuid &&
              matchState(previous) === 'WARMUP' &&
              matchState(s) === 'LIVE' &&
              identity(previous, { ignoreGuid: true }) === identity(s, { ignoreGuid: true });
            if (promotion) {
              if (w.rivalryCollectedIdentity) w.rivalryCollectedIdentity = freshIdentity;
            } else {
              w.rivalryController.abort();
              w.rivalryController = new AbortController();
              rivalryContext?.invalidate();
              w.rivalryCollectedIdentity = null;
              w.rivalryReport = null;
              w.rivalryCommentary = null;
            }
            w.rivalryIdentity = freshIdentity;
          }
          if (fresh) w.rivalrySnapshot = structuredClone(s);
          const payload = {
            content: `Auto-refresh active · ${Math.ceil(delay / 1000)}s minimum.`,
            embeds: [renderSlipgateCard(displaySnapshot)],
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    style: 2,
                    label: 'Refresh',
                    emoji: { name: '🔄' },
                    custom_id: `quake_refresh:${encodeURIComponent(key)}`,
                  },
                ],
              },
            ],
            allowedMentions: { parse: [] },
          };
          await write(payload);
          if (!active(generation)) return;
          if (fresh) {
            w.hash = hash;
            w.lastChangedAt = changedAt;
          }
          if (successfulCheck) w.lastCheckedAt = checkedAt;
          if (!s.stale)
            w.lastPublishedSnapshot = structuredClone({
              ...s,
              localCheckedAt: checkedAt,
              localChangedAt: changedAt,
            });
          w.paused = false;
          if (s.stale) throw new Error('Stale Slipgate snapshot');
          w.failures = 0;
          w.lastPollOutcome = 'success';
          maintenanceSnapshot = fresh ? s : null;
        } catch (caught) {
          let error = caught;
          if (!active(generation)) return;
          w.lastPollOutcome = error.status === 429 ? 'backoff' : 'error';
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
            w.rivalryController.abort();
            w.watchController.abort();
            w.rivalryContext?.invalidate();
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
        if (maintenanceSnapshot) maintain(structuredClone(maintenanceSnapshot), { manual });
      }
      return null;
    };
    w.tick = tick;
    w.timer = schedule(tick, 0);
    return { ok: true, existing: false };
  }
  function enqueueRefresh(key, messageId) {
    const w = watches.get(key);
    if (
      !w ||
      w.stopped ||
      w.cards.retainedFinal ||
      !w.message?.id ||
      String(w.message.id) !== String(messageId)
    )
      return { ok: false, reason: 'This refresh control is no longer active.' };
    if (w.inflight || w.refreshPromise)
      return {
        ok: true,
        coalesced: true,
        reason: 'A refresh is already queued or running; the scoreboard will update when ready.',
        promise: w.refreshPromise || w.inflight,
      };
    if ((w.client?.pollingPolicy?.().cooldownMs || 0) > 0)
      return {
        ok: false,
        backoff: true,
        reason: 'Provider backoff is active; the watch will retry when allowed.',
      };
    if (now() < w.refreshAt)
      return { ok: false, reason: 'Refresh is cooling down; scheduled polling remains active.' };
    w.refreshAt = now() + 5000;
    clearTimer(w.timer);
    w.timer = null;
    const promise = w.tick({ manual: true }).finally(() => {
      if (w.refreshPromise === promise) w.refreshPromise = null;
    });
    w.refreshPromise = promise;
    // The interaction owns admission only; the existing watch owns completion and its timer.
    promise.catch(() => undefined);
    return {
      ok: true,
      queued: true,
      coalesced: false,
      reason: 'Refresh queued; the scoreboard will update when ready.',
      promise,
    };
  }
  async function refresh(key, messageId) {
    const w = watches.get(key);
    const result = enqueueRefresh(key, messageId);
    if (!result.ok || result.coalesced) return result;
    await result.promise;
    if (w.stopped || watches.get(key) !== w)
      return { ok: false, reason: 'This watch stopped before refresh completed.' };
    if (w.lastPollOutcome === 'backoff')
      return {
        ok: true,
        backoff: true,
        reason: 'Provider backoff is active; scheduled refresh remains paused.',
      };
    if (w.lastPollOutcome !== 'success')
      return { ok: false, reason: 'Refresh failed; the scheduled watch will retry.' };
    return { ok: true, coalesced: false };
  }
  async function stop(key) {
    const w = watches.get(key);
    if (!w) return false;
    if (w.stopPromise) return w.stopPromise;
    w.stopped = true;
    w.rivalryController.abort();
    w.watchController.abort();
    w.rivalryContext?.invalidate();
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
      w.removeOwnReaction(w.message);
      w.reactionMessageId = null;
      if (w.message && !w.cards.retainedFinal) {
        try {
          await w.message.edit({
            content: 'Auto-refresh stopped. Run !quakestats to start again.',
            components: [],
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
  function snapshot(key) {
    const w = watches.get(key);
    return w && !w.stopped && w.lastPublishedSnapshot
      ? structuredClone({
          ...w.lastPublishedSnapshot,
          stale:
            w.lastPublishedSnapshot.stale ||
            w.paused ||
            w.lastPollOutcome === 'error' ||
            w.lastPollOutcome === 'backoff',
        })
      : null;
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
  return {
    start,
    enqueueRefresh,
    refresh,
    snapshot,
    stop,
    stopAll,
    shutdown,
    status,
    _watches: watches,
  };
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
