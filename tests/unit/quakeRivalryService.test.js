'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRivalryService } = require('../../src/services/quakeRivalryService');
const a = '76561198000000001',
  b = '76561198000000002';
test('collect uses bounded explicit context, coalesces and preserves exact mode H2H', async () => {
  let calls = 0,
    communityCalls = 0;
  const service = createRivalryService({
    now: () => 1800000000000,
    community: {
      getPlayers: async ids => {
        communityCalls++;
        return {
          players: [
            { steam_id: a, pummels: { total: 14, victims: [{ steam_id: b, count: 3 }] } },
            { steam_id: b, pummels: { total: 11, victims: [{ steam_id: a, count: 1 }] } },
          ],
        };
      },
    },
    slipgate: {
      request: async path => {
        calls++;
        assert.match(path, /head-to-head/);
        return {
          data: {
            steam_id_a: a,
            steam_id_b: b,
            shared: 15,
            as_teammates: 3,
            as_opponents: 12,
            by_game_type: [{ game_type: 'ca', wins_a: 7, wins_b: 5, decided: 12 }],
          },
        };
      },
    },
  });
  const snapshot = {
    address: 'example:27960',
    matchGuid: 'guid-fixture',
    state: 'WARMUP',
    gameType: 'ca',
    ratingSet: 'A',
    map: 'campgrounds',
    players: [
      { steamId: a, name: 'Player A', team: 1, rating: { display: 1500 } },
      { steamId: b, name: 'Player B', team: 2, rating: { display: 1510 } },
      { steamId: null, name: 'Anonymous', team: 1, private: true },
    ],
  };
  const [r1, r2] = await Promise.all([service.collect(snapshot), service.collect(snapshot)]);
  assert.deepEqual(r1, r2);
  assert.equal(calls, 1);
  assert.equal(communityCalls, 1);
  assert.equal(r1.rivalries[0].decided, 12);
  assert.equal(r1.rivalries[0].shared, 15);
  assert.equal(r1.rivalries[0].pummelsBtoA, 1);
  assert.equal(r1.coverage.eligible, 2);
});
test('optional provider failures return base report with missing-data coverage', async () => {
  const s = createRivalryService({
    community: {
      getPlayers: async () => {
        throw Error('offline');
      },
    },
    slipgate: {
      request: async () => {
        throw Error('offline');
      },
    },
  });
  const r = await s.collect({ players: [{ steamId: a, name: 'A', team: 1 }] });
  assert.equal(r.players.length, 1);
  assert.equal(r.players[0].lifetimePummels, null);
  assert.deepEqual(r.rivalries, []);
  assert.equal(r.coverage.missing, 1);
});

test('invalid requested pairs fail closed; one-ID requests filter the report roster', async () => {
  let profileCalls = 0;
  const s = createRivalryService({
    community: {
      getPlayers: async ids => {
        profileCalls++;
        return { players: [] };
      },
    },
    slipgate: {
      request: async () => {
        throw Error('must not dispatch');
      },
    },
  });
  const snapshot = {
    players: [
      { steamId: a, name: 'A', team: 1 },
      { steamId: b, name: 'B', team: 1 },
    ],
  };
  await assert.rejects(
    s.collect(snapshot, { pairIds: ['76561198000000009', b] }),
    /not in the public roster/
  );
  await assert.rejects(s.collect(snapshot, { pairIds: [a, b] }), /opponents/);
  const result = await s.collect(snapshot, { pairIds: [a] });
  assert.deepEqual(
    result.players.map(p => p.steamId),
    [a]
  );
  assert.equal(profileCalls, 1);
});

test('cached reports are cloned and phase/map context cannot alias', async () => {
  let calls = 0;
  const s = createRivalryService({
    community: { getPlayers: async () => ({ players: [] }) },
    slipgate: {
      request: async () => {
        calls++;
        return {
          data: {
            steam_id_a: a,
            steam_id_b: b,
            by_game_type: [{ game_type: 'ca', wins_a: 1, wins_b: 0 }],
          },
        };
      },
    },
  });
  const snapshot = {
    address: 's:1',
    matchGuid: 'g',
    gameType: 'ca',
    ratingSet: 'A',
    state: 'LIVE',
    map: 'm1',
    players: [
      { steamId: a, team: 1 },
      { steamId: b, team: 2 },
    ],
  };
  const first = await s.collect(snapshot);
  first.players[0].name = 'poison';
  const second = await s.collect(snapshot);
  assert.notEqual(second.players[0].name, 'poison');
  await s.collect({ ...snapshot, state: 'FINAL' });
  await s.collect({ ...snapshot, map: 'm2' });
  assert.equal(calls, 3);
});
