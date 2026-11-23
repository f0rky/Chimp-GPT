'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEvidence } = require('../../src/services/gauntAnalysis');
test('builds v1 report matching shared positive interchange and preserves zero/null', () => {
  const a = '76561198000000001',
    b = '76561198000000002';
  const report = buildEvidence({
    snapshot: {
      address: 'example:27960',
      matchGuid: 'guid-fixture',
      state: 'WARMUP',
      gameType: 'ca',
      ratingSet: 'A',
      map: 'campgrounds',
      window: 20,
      checkedAt: 1800000000000,
      players: [
        { steamId: a, name: 'Player A', team: 1, rating: { display: 1500 } },
        { steamId: b, name: 'Player B', team: 2, rating: { display: 1510 } },
        { steamId: null, name: 'Anonymous', team: 1, private: true },
      ],
    },
    communityProfiles: [
      { steam_id: a, pummels: { total: 14, victims: [{ steam_id: b, count: 3 }] } },
      { steam_id: b, pummels: { total: 11, victims: [{ steam_id: a, count: 1 }] } },
    ],
    headToHeads: [
      {
        steam_id_a: a,
        steam_id_b: b,
        shared: 15,
        as_teammates: 3,
        as_opponents: 12,
        by_game_type: [{ game_type: 'ca', wins_a: 7, wins_b: 5, decided: 12 }],
      },
    ],
  });
  assert.equal(report.version, 1);
  assert.deepEqual(report.scope, {
    server: 'example:27960',
    matchGuid: 'guid-fixture',
    phase: 'WARMUP',
    gameType: 'ca',
    ratingSet: 'A',
    map: 'campgrounds',
    window: 20,
    checkedAt: 1800000000000,
  });
  assert.deepEqual(report.coverage, { eligible: 2, matched: 2, missing: 0 });
  assert.deepEqual(report.players, [
    {
      steamId: a,
      name: 'Player A',
      team: 1,
      lifetimePummels: 14,
      recentGaunts: null,
      matchGaunts: null,
      rating: 1500,
    },
    {
      steamId: b,
      name: 'Player B',
      team: 2,
      lifetimePummels: 11,
      recentGaunts: null,
      matchGaunts: null,
      rating: 1510,
    },
  ]);
  assert.deepEqual(report.rivalries, [
    {
      a,
      b,
      winsA: 7,
      winsB: 5,
      decided: 12,
      shared: 15,
      sharedScope: 'all_modes',
      teammates: 3,
      opponents: 12,
      teammateOpponentScope: 'all_modes',
      pummelsAtoB: 3,
      pummelsBtoA: 1,
      gameType: 'ca',
    },
  ]);
  assert.deepEqual(report.leader, {
    steamId: a,
    metric: 'lifetimePummels',
    value: 14,
    population: 2,
  });
  assert.deepEqual(report.facts, ['Player A leads the decided CA matchup 7–5 (12 matches).']);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.commentary, null);
});
test('counts only exact-match canonical gauntlet medal; mismatched identity and missing medal data stay null', () => {
  const id = '76561198000000001';
  const snapshot = {
    address: 'srv:27960',
    matchGuid: '590a32da-90f2-46f4-94d2-a0d35bc12e34',
    state: 'FINAL',
    gameType: 'ca',
    ratingSet: 'A',
    players: [{ steamId: id, name: 'A', team: 1 }],
  };
  const base = {
    match_guid: '590a32da-90f2-46f4-94d2-a0d35bc12e34',
    ended_at: '2026-09-12T00:00:00Z',
    aborted: false,
    server: { addr: 'srv:27960' },
    game_type: 'ca',
    rating_set: 'A',
    players: [
      {
        steam_id: id,
        team: 1,
        medals: [
          { medal: 'gauntlet', count: 4 },
          { medal: 'rocket', count: 99 },
        ],
      },
    ],
  };
  assert.equal(buildEvidence({ snapshot, archive: base }).players[0].matchGaunts, 4);
  assert.equal(
    buildEvidence({ snapshot: { ...snapshot, state: 'final' }, archive: base }).players[0]
      .matchGaunts,
    4,
    'accepts the real archiveFinal lowercase state'
  );
  assert.equal(
    buildEvidence({
      snapshot,
      archive: {
        ...base,
        players: [{ steam_id: id, weapons: [{ weapon: 'gauntlet', kills: 88 }] }],
      },
    }).players[0].matchGaunts,
    null
  );
  assert.equal(
    buildEvidence({ snapshot, archive: { ...base, match_guid: 'other' } }).players[0].matchGaunts,
    null
  );
  assert.equal(
    buildEvidence({ snapshot, archive: { ...base, server: { addr: 'other:27960' } } }).players[0]
      .matchGaunts,
    null
  );
  assert.equal(
    buildEvidence({ snapshot, archive: { ...base, game_type: 'tdm' } }).players[0].matchGaunts,
    null
  );
  assert.equal(
    buildEvidence({ snapshot, archive: { ...base, rating_set: 'B' } }).players[0].matchGaunts,
    null
  );
});

test('H2H facts identify the actual winner or draw and reject malformed, duplicate, and wrong-pair data', () => {
  const a = '76561198000000001',
    b = '76561198000000002',
    c = '76561198000000003';
  const snapshot = {
    gameType: 'ca',
    players: [
      { steamId: a, name: 'A' },
      { steamId: b, name: 'B' },
      { steamId: c, name: 'C' },
    ],
  };
  const row = (x, y, w1, w2) => ({
    steam_id_a: x,
    steam_id_b: y,
    shared: 12,
    as_teammates: 9,
    as_opponents: 3,
    by_game_type: [{ game_type: 'ca', wins_a: w1, wins_b: w2, decided: w1 + w2 }],
  });
  const report = buildEvidence({
    snapshot,
    headToHeads: [row(a, b, 3, 8)],
    expectedPairIds: [a, b],
  });
  assert.deepEqual(
    report.rivalries.map(r => [r.a, r.b]),
    [[a, b]]
  );
  assert.match(report.facts[0], /B leads.*8–3/);
  assert.equal(report.rivalries[0].shared, 12);
  assert.equal(report.rivalries[0].decided, 11);
  assert.deepEqual(
    buildEvidence({
      snapshot,
      headToHeads: [row(a, b, 3, 8), row(a, b, 8, 3)],
      expectedPairIds: [a, b],
    }).rivalries,
    []
  );
  assert.deepEqual(
    buildEvidence({
      snapshot,
      headToHeads: [row(a, b, 3, 8), row(b, a, 8, 3), null, {}],
    }).rivalries,
    [],
    'unordered pair keys reject reversed duplicate evidence without changing directed results'
  );
});

test('lifetime ties are represented as multiple leaders, never an arbitrary unique winner', () => {
  const a = '76561198000000001',
    b = '76561198000000002';
  const report = buildEvidence({
    snapshot: {
      players: [
        { steamId: a, name: 'A', team: 1 },
        { steamId: a, name: 'duplicate', team: 2 },
        { steamId: b, name: 'B', team: 2 },
        { steamId: '76561198000000003', private: true },
      ],
    },
    communityProfiles: [
      { steam_id: a, pummels: { total: 3 } },
      { steam_id: b, pummels: { total: 3 } },
    ],
  });
  assert.equal(report.players.length, 2);
  assert.equal(report.leader, null);
  assert.deepEqual(report.leaders, [a, b]);
});
test('lifetime outlier assessment uses the conventional median for an even roster', () => {
  const totals = [0, 2, 4, 20];
  const players = totals.map((_, i) => ({
    steamId: '7656119800000000' + String(i + 1),
    name: 'P' + i,
    team: i < 2 ? 1 : 2,
  }));
  const report = buildEvidence({
    snapshot: { players },
    communityProfiles: players.map((p, i) => ({
      steam_id: p.steamId,
      pummels: { total: totals[i] },
    })),
  });
  assert.match(report.facts.join(' '), /median \(3; n=4\)/);
});
