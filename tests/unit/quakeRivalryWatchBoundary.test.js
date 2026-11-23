'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
const { buildEvidence } = require('../../src/services/gauntAnalysis');
const { timers } = require('../helpers/slipgateFixtures');
async function setup() {
  const clock = timers();
  let current = {
    address: 'arena:27960',
    state: 'warmup',
    map: 'campgrounds',
    gameType: 'ca',
    ratingSet: 'A',
    matchGuid: null,
    stale: false,
    quality: {},
    scoreRed: 0,
    scoreBlue: 0,
    players: [
      { steamId: '76561198000000001', name: 'A', team: 1 },
      { steamId: '76561198000000002', name: 'B', team: 2 },
    ],
  };
  let calls = 0,
    models = 0,
    fail = false;
  const client = {
    pollingPolicy: () => ({ enabled: true, minIntervalMs: 60000 }),
    selectServer: async () => current,
    getServer: async () => {
      if (fail) throw new Error('fixture failure');
      return current;
    },
    getMatch: async () => null,
    listMatches: async () => [],
  };
  const manager = createWatchManager({
    ...clock,
    env: {},
    rivalryEnabled: true,
    tracker: { observe: async () => {} },
    rivalryService: {
      collect: async s => {
        calls++;
        return buildEvidence({ snapshot: s });
      },
    },
    commentaryProvider: async () => {
      models++;
      return { candidateIds: [0] };
    },
  });
  manager.start('b:g:c', {
    client,
    channel: { send: async () => ({ id: 'current', edit: async () => {}, react: async () => {} }) },
  });
  async function tick() {
    await clock.tick();
    await manager._watches.get('b:g:c')?.maintenance;
  }
  await tick();
  return {
    manager,
    tick,
    set: s => {
      current = s;
    },
    get current() {
      return current;
    },
    get calls() {
      return calls;
    },
    get models() {
      return models;
    },
    fail: () => {
      fail = true;
    },
  };
}
test('trusted warmup-to-first-GUID promotion and ordinary live rounds reuse one assessment', async t => {
  const f = await setup();
  t.after(() => f.manager.stopAll());
  assert.equal(f.calls, 1);
  assert.equal(f.models, 1);
  f.set({ ...f.current, state: 'live', matchGuid: 'first-guid' });
  await f.tick();
  assert.equal(f.calls, 1);
  assert.equal(f.models, 1);
  f.set({ ...f.current, scoreRed: 3 });
  await f.tick();
  assert.equal(f.calls, 1);
  assert.equal(f.models, 1);
  f.set({ ...f.current, matchGuid: 'second-guid' });
  await f.tick();
  assert.equal(f.calls, 2);
});
test('a fresh live-to-warmup boundary resets assessment even if the provider retains its old GUID', async t => {
  const f = await setup();
  t.after(() => f.manager.stopAll());
  f.set({ ...f.current, state: 'live', matchGuid: 'first-guid' });
  await f.tick();
  assert.equal(f.calls, 1);
  f.set({ ...f.current, state: 'warmup' });
  await f.tick();
  assert.equal(f.calls, 2);
});
test('a basic A2S success replaces the public command snapshot without inventing old identities', async t => {
  const f = await setup();
  t.after(() => f.manager.stopAll());
  f.set({
    ...f.current,
    quality: { a2sOnly: true },
    players: [{ name: 'Anonymous', steamId: null, team: 0 }],
    matchGuid: null,
  });
  await f.tick();
  const current = f.manager.snapshot('b:g:c');
  assert.equal(current.quality.a2sOnly, true);
  assert.equal(current.players[0].steamId, null);
  assert.equal(f.calls, 1);
});
test('failed fetch retains prior check evidence but command snapshot is marked stale', async t => {
  const f = await setup();
  t.after(() => f.manager.stopAll());
  const before = f.manager.snapshot('b:g:c').localCheckedAt;
  f.fail();
  await f.tick();
  assert.equal(f.manager.snapshot('b:g:c').stale, true);
  assert.equal(f.manager.snapshot('b:g:c').localCheckedAt, before);
});
