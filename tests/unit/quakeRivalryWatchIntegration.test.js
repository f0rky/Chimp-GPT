'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
const { deferred, timers, turn } = require('../helpers/slipgateFixtures');

test('real watcher publishes and arms its ordinary timer before optional rivalry resolves', async () => {
  const pending = deferred();
  const clock = timers();
  const published = [];
  const server = {
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
    players: [{ steamId: '76561198000000001', name: 'A', team: 1, score: 0, private: false }],
  };
  const client = {
    pollingPolicy: () => ({ enabled: true, minIntervalMs: 60000 }),
    selectServer: async () => server,
    getServer: async () => server,
    listMatches: async () => [],
    getMatch: async () => null,
  };
  const manager = createWatchManager({
    ...clock,
    env: {},
    rivalryEnabled: true,
    tracker: { observe: async () => {} },
    rivalryService: { collect: () => pending.promise },
  });
  manager.start('guild:channel', {
    client,
    channel: {
      send: async payload => {
        published.push(payload);
        return { id: 'scoreboard', edit: async p => published.push(p) };
      },
    },
  });
  await clock.tick();
  assert.equal(published.length, 1);
  assert.equal(clock.queue.length, 1);
  assert.equal(manager.snapshot('guild:channel').players[0].name, 'A');
  pending.resolve({
    version: 1,
    facts: [],
    players: [],
    leader: { steamId: '76561198000000001', metric: 'lifetimePummels', value: 12, population: 1 },
    rivalries: [],
  });
  await manager._watches.get('guild:channel').maintenance;
  await clock.tick();
  assert.equal(published.length, 2);
  assert.match(
    published[1].embeds[0].data.fields.map(field => field.name).join(' '),
    /Gaunt context/
  );
  await manager.stopAll();
});

test('manual watch refresh does not dispatch optional rivalry context', async () => {
  const clock = timers();
  let calls = 0;
  const server = {
    address: 'arena:27960',
    state: 'warmup',
    map: 'campgrounds',
    stale: false,
    quality: {},
    players: [],
  };
  const client = {
    pollingPolicy: () => ({ enabled: true, minIntervalMs: 60000 }),
    selectServer: async () => server,
    getServer: async () => server,
    listMatches: async () => [],
    getMatch: async () => null,
  };
  const manager = createWatchManager({
    ...clock,
    env: {},
    rivalryEnabled: true,
    tracker: { observe: async () => {} },
    rivalryService: {
      collect: async () => {
        calls++;
        return { facts: [] };
      },
    },
  });
  const channel = { send: async () => ({ id: 'card', edit: async () => {} }) };
  manager.start('manual', { client, channel });
  await clock.tick();
  await manager._watches.get('manual').maintenance;
  assert.equal(calls, 1);
  await manager.refresh('manual', 'card');
  await manager.refresh('manual', 'card');
  await turn();
  assert.equal(calls, 1);
  await manager.stopAll();
});
