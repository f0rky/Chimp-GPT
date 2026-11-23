'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
const { createRivalryContext } = require('../../src/services/quakeRivalryContext');

test('rivalry context stays disabled by default and skips stale/basic snapshots', async () => {
  let calls = 0;
  const context = createRivalryContext({
    enabled: () => false,
    service: {
      collect: async () => {
        calls++;
      },
    },
  });
  assert.equal(await context.collect({ state: 'WARMUP' }), null);
  assert.equal(calls, 0);
  const enabled = createRivalryContext({
    enabled: () => true,
    service: {
      collect: async () => {
        calls++;
        return { facts: [] };
      },
    },
  });
  assert.equal(await enabled.collect({ stale: true }), null);
  assert.equal(await enabled.collect({ quality: { a2sOnly: true } }), null);
  assert.equal(calls, 0);
});

test('published snapshot clone stays available while optional context is pending; stop blocks late effects', async () => {
  const { deferred, timers, turn } = require('../helpers/slipgateFixtures');
  const pending = deferred();
  const clock = timers();
  const sent = [];
  const snapshot = {
    state: 'WARMUP',
    map: 'campgrounds',
    gameType: 'ca',
    ratingSet: 'A',
    matchGuid: null,
    address: 'arena:27960',
    stale: false,
    quality: {},
    scoreRed: 0,
    scoreBlue: 0,
    players: [{ name: 'A', steamId: '76561198000000001', team: 1, score: 0, private: false }],
  };
  const client = {
    pollingPolicy: () => ({ enabled: true, minIntervalMs: 60000 }),
    selectServer: async () => snapshot,
    getServer: async () => snapshot,
    listMatches: async () => [],
    getMatch: async () => null,
  };
  const manager = createWatchManager({
    ...clock,
    tracker: { observe: async () => {} },
    env: {},
    rivalryEnabled: true,
    rivalryService: { collect: () => pending.promise },
  });
  const channel = {
    send: async body => {
      sent.push(body);
      return { id: 'card', edit: async b => sent.push(b) };
    },
  };
  manager.start('b:g:c', { channel, client });
  await clock.tick();
  assert.equal(sent.length, 1, 'base card published without waiting for service');
  assert.equal(clock.queue.length, 1, 'ordinary timer armed before service settles');
  const cached = manager.snapshot('b:g:c');
  assert.ok(cached);
  cached.players[0].name = 'mutated';
  assert.equal(manager.snapshot('b:g:c').players[0].name, 'A');
  await manager.stop('b:g:c');
  pending.resolve({ facts: ['fixture'] });
  await turn();
  assert.equal(sent.length, 2, 'only the expected stop-status edit follows the base publish');
  assert.match(sent[1].content, /Auto-refresh stopped/);
  assert.equal(manager.snapshot('b:g:c'), null);
});

test('commentary selects only validated evidence candidates and otherwise uses supported deterministic text', async () => {
  const snapshot = {
    state: 'WARMUP',
    scoreRed: 8,
    scoreBlue: 4,
    players: [{ name: 'A', score: 3, team: 1 }],
  };
  const provider = async () => ({ candidateIds: [0, 999, '1'] });
  const context = createRivalryContext({
    enabled: () => true,
    service: { collect: async () => ({ facts: [] }) },
    commentaryProvider: provider,
  });
  assert.match(
    await context.summarize(snapshot, { facts: [] }),
    /^AI-assisted assessment: Warmup roster:/
  );
});
