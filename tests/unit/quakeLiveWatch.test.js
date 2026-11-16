'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
const { createRoundTracker } = require('../../src/services/quakeRoundTracker');
const { snapshot, deferred, turn, timers } = require('../helpers/slipgateFixtures');
function fixture() {
  const clock = timers();
  const sent = [],
    edits = [];
  let s = snapshot(),
    lookups = 0,
    archive = 0;
  const client = {
    pollingPolicy: () => ({ enabled: true, minIntervalMs: 500 }),
    selectServer: async () => {
      lookups++;
      return s;
    },
    getServer: async () => {
      lookups++;
      return s;
    },
    listMatches: async () => {
      archive++;
      return [];
    },
    getMatch: async () => ({ rounds: [] }),
  };
  const channel = {
    send: async p => {
      sent.push(p);
      return {
        edit: async v => {
          edits.push(v);
        },
      };
    },
  };
  const manager = createWatchManager({ ...clock, tracker: createRoundTracker({ now: () => 0 }) });
  return {
    clock,
    sent,
    edits,
    client,
    channel,
    manager,
    setSnapshot: v => {
      s = v;
    },
    lookups: () => lookups,
    archive: () => archive,
  };
}
test('adaptive cadence is 60s live, 2m populated warmup, and 5m empty or spectator-only, recalculated each poll', async () => {
  const f = fixture();
  f.manager.start('cadence', f);
  for (const [overrides, expected] of [
    [{ state: 'live' }, 60000],
    [{ state: 'warmup' }, 120000],
    [{ state: 'waiting' }, 120000],
    [{ state: 'warmup', players: [] }, 300000],
    [{ state: 'live', players: [{ team: 3, name: 'Watcher' }] }, 300000],
    [{ state: 'live', players: [] }, 300000],
    [{ state: 'live' }, 60000],
  ]) {
    f.setSnapshot({ ...snapshot(), ...overrides });
    await f.clock.tick();
    assert.equal(f.clock.queue.length, 1);
    assert.equal(f.clock.queue[0].ms, expected, JSON.stringify(overrides));
  }
  assert.equal(f.lookups(), 7);
  // Live→warmup now freezes the previous result and starts a separate warmup card.
  assert.equal(f.sent.length, 2);
  await f.manager.stopAll();
});
test('adaptive cadence never overrides a slower quota policy or caller interval', async () => {
  for (const [quotaMs, intervalMs, expected] of [
    [900000, 60000, 900000],
    [500, 180000, 180000],
  ]) {
    const f = fixture();
    f.client.pollingPolicy = () => ({ enabled: true, minIntervalMs: quotaMs });
    f.manager.start('budget', { ...f, intervalMs });
    await f.clock.tick();
    assert.equal(f.clock.queue[0].ms, expected);
    await f.manager.stopAll();
  }
});
test('one message, idempotence, no overlap, meaningful edits, warmup cadence, three channel maximum', async () => {
  const f = fixture();
  assert.equal(f.manager.start('b:g:c', f).existing, false);
  assert.equal(f.manager.start('b:g:c', f).existing, true);
  await f.clock.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.lookups(), 1);
  assert.equal(f.archive(), 1);
  f.setSnapshot({
    ...snapshot(),
    fetchedAt: 1000,
    elapsedSeconds: 20,
    sourceUpdatedAt: new Date().toISOString(),
  });
  await f.clock.tick();
  assert.equal(f.edits.length, 0);
  assert.equal(f.lookups(), 2);
  f.setSnapshot({ ...snapshot(), scoreRed: 1 });
  await f.clock.tick();
  assert.equal(f.edits.length, 1);
  assert.equal(f.edits[0].allowedMentions.parse.length, 0);
  f.setSnapshot({ ...snapshot(), state: 'warmup', players: [] });
  await f.clock.tick();
  assert.equal(f.clock.queue[0].ms, 300000);
  assert.equal(f.manager.start('b:g:d', f).ok, true);
  assert.equal(f.manager.start('b:g:e', f).ok, true);
  assert.equal(f.manager.start('b:g:f', f).ok, false);
  await f.manager.stopAll();
  assert.equal(f.clock.queue.length, 0);
});
test('stop during lookup prevents late sends and no timers survive; overlapping callback skipped', async () => {
  const f = fixture();
  const held = deferred();
  let lookups = 0;
  f.client.selectServer = async () => {
    lookups++;
    return held.promise;
  };
  f.manager.start('b:g:c', f);
  const fn = f.clock.queue[0].fn;
  const tick = f.clock.tick();
  await turn();
  await fn();
  assert.equal(lookups, 1);
  let stopped = false;
  const stop = f.manager.stop('b:g:c').then(() => {
    stopped = true;
  });
  await turn();
  assert.equal(stopped, true);
  held.resolve(snapshot());
  await Promise.all([stop, tick]);
  assert.equal(f.sent.length, 0);
  assert.equal(f.clock.queue.length, 0);
});
test('stop waits for already-started Discord write and blocks replacement until settled', async () => {
  const f = fixture();
  const held = deferred();
  let sends = 0;
  f.channel.send = async () => {
    sends++;
    return held.promise;
  };
  f.manager.start('b:g:c', f);
  const tick = f.clock.tick();
  await turn();
  assert.equal(sends, 1);
  let acknowledged = false;
  const stop = f.manager.stop('b:g:c').then(() => {
    acknowledged = true;
  });
  await turn();
  assert.equal(acknowledged, false);
  assert.equal(f.manager.start('b:g:c', f).ok, false);
  held.resolve({ edit: async () => {} });
  await Promise.all([stop, tick]);
  assert.equal(acknowledged, true);
  assert.equal(f.clock.queue.length, 0);
});
test('bounded failures and missing/deleted messages stop without recreating', async () => {
  const f = fixture();
  let failures = 0;
  f.client.selectServer = async () => {
    failures++;
    throw Error('outage');
  };
  f.manager.start('b:g:c', f);
  for (let i = 0; i < 3; i++) await f.clock.tick();
  assert.equal(failures, 3);
  assert.equal(f.clock.queue.length, 0);
  assert.equal(f.manager._watches.size, 0);
  const g = fixture();
  g.manager.start('b:g:c', g);
  await g.clock.tick();
  g.manager._watches.get('b:g:c').message.edit = async () => {
    throw Object.assign(Error('deleted'), { code: 10008 });
  };
  g.setSnapshot({ ...snapshot(), scoreRed: 2 });
  await g.clock.tick();
  assert.equal(g.sent.length, 1);
  assert.equal(g.clock.queue.length, 0);
});
test('stale cached fallback is visibly labeled before a bounded outage stops polling', async () => {
  const f = fixture();
  f.manager.start('b:g:c', f);
  await f.clock.tick();
  f.setSnapshot({ ...snapshot(), stale: true, staleReason: 'Slipgate cooldown active' });
  await f.clock.tick();
  assert.equal(f.edits.length, 1);
  assert.match(f.edits[0].embeds[0].toJSON().footer.text, /Stale snapshot/);
  await f.clock.tick();
  await f.clock.tick();
  assert.equal(f.clock.queue.length, 0);
  assert.equal(f.sent.length, 1);
});
test('refresh label shows effective cadence only, without experimental-budget or control prose', async () => {
  for (const [overrides, policyMs, seconds] of [
    [{ state: 'live' }, 20000, 60],
    [{ state: 'warmup' }, 20000, 120],
    [{ players: [] }, 20000, 300],
    [{ state: 'live' }, 180000, 180],
  ]) {
    const f = fixture();
    f.client.pollingPolicy = () => ({
      enabled: true,
      experimental: true,
      minIntervalMs: policyMs,
      budgetLabel: 'experimental local budget (provider quota unknown)',
    });
    f.setSnapshot({ ...snapshot(), ...overrides });
    f.manager.start('label', f);
    await f.clock.tick();
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].content, `Auto-refresh active · ${seconds}s minimum.`);
    assert.equal(f.clock.queue[0].ms, seconds * 1000);
    await f.manager.stopAll();
  }
});
test('paused status retains truthful backoff timing but omits budget explanation', async () => {
  const f = fixture();
  f.client.pollingPolicy = () => ({
    enabled: true,
    experimental: true,
    minIntervalMs: 20000,
    cooldownMs: 90000,
    budgetLabel: 'experimental local budget (provider quota unknown)',
  });
  f.manager.start('paused-label', f);
  await f.clock.tick();
  assert.equal(
    f.edits.at(-1).content,
    'Auto-refresh paused: Slipgate rate limit/backoff. Next refresh no sooner than 90s.'
  );
  assert.equal(f.clock.queue[0].ms, 90000);
  await f.manager.stopAll();
});
