'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createScoreboardLifecycle } = require('../../src/services/scoreboardLifecycle');
const { createRivalryContext } = require('../../src/services/quakeRivalryContext');
const { createRivalryService } = require('../../src/services/quakeRivalryService');
const { renderSlipgateCard } = require('../../src/handlers/slipgateCardRenderer');
const { deferred, turn } = require('../helpers/slipgateFixtures');
const A = '76561198000000001',
  B = '76561198000000002',
  C = '76561198000000003';
function setup(gate = null) {
  const old = {
    address: 'arena:27960',
    matchGuid: '590a32da-90f2-46f4-94d2-a0d35bc12e34',
    state: 'live',
    gameType: 'ca',
    ratingSet: 'A',
    map: 'campgrounds',
    stale: false,
    quality: {},
    scoreRed: 5,
    scoreBlue: 4,
    players: [
      { steamId: A, name: 'Old Alpha', team: 1, score: 8, kills: 4, deaths: 2 },
      { steamId: B, name: 'Old Beta', team: 2, score: 5, kills: 2, deaths: 4 },
    ],
  };
  const archive = {
    ok: true,
    match_guid: old.matchGuid,
    server: { addr: old.address },
    game_type: 'ca',
    rating_set: 'A',
    map: old.map,
    ended_at: '2026-11-23T00:00:00Z',
    duration_sec: 600,
    aborted: false,
    rated: true,
    team_red_score: 6,
    team_blue_score: 4,
    players: old.players.map((p, i) => ({
      steam_id: p.steamId,
      nick: p.name,
      team: p.team,
      score: p.score,
      kills: p.kills,
      deaths: p.deaths,
      medals: [{ medal: 'gauntlet', count: i ? 0 : 4 }],
    })),
  };
  const edits = [],
    queries = [];
  let active = true,
    modelCalls = 0;
  const service = createRivalryService({
    community: {
      getPlayers: async ids => {
        queries.push(ids);
        if (gate) await gate.promise;
        return {
          players: ids.map(steam_id => ({ steam_id, pummels: { total: 10, victims: [] } })),
        };
      },
    },
    slipgate: { request: async () => ({ data: null }) },
  });
  const context = createRivalryContext({
    service,
    enabled: () => true,
    commentaryProvider: async () => {
      modelCalls++;
      return { candidateIds: [0] };
    },
  });
  const lifecycle = createScoreboardLifecycle({
    channel: {
      send: async body => ({
        id: 'old-card',
        edit: async payload => edits.push(payload),
        payload: body,
      }),
    },
    client: { getMatch: async () => archive, pollingPolicy: () => ({ cooldownMs: 0 }) },
    perform: async fn => fn(),
    active: () => active,
    deferReconciliation: true,
    rivalryContext: context,
  });
  return {
    old,
    archive,
    lifecycle,
    edits,
    queries,
    stop: () => {
      active = false;
    },
    get modelCalls() {
      return modelCalls;
    },
  };
}
async function boundary(f) {
  await f.lifecycle.prepare(f.old);
  await f.lifecycle.publish({ embeds: [renderSlipgateCard(f.old)] });
  await f.lifecycle.prepare({
    ...f.old,
    state: 'warmup',
    matchGuid: null,
    map: 'newmap',
    players: [{ steamId: C, name: 'New Player', team: 1 }],
  });
}
test('confirmed final enrichment uses exact old archive and preserves the complete frozen scoreboard', async () => {
  const f = setup();
  await boundary(f);
  await f.lifecycle.reconcile();
  assert.deepEqual(f.queries, [[A, B]]);
  const confirmed = f.edits.find(e => e.content === 'FINAL · Slipgate archived result confirmed.');
  const enriched = f.edits.at(-1);
  const json = enriched.embeds[0].toJSON();
  assert.match(JSON.stringify(json), /Old Alpha · match gaunts 4/);
  assert.doesNotMatch(JSON.stringify(json), /New Player/);
  const base = confirmed.embeds[0].toJSON();
  assert.deepEqual(json.fields.slice(0, base.fields.length), base.fields);
  assert.equal(json.title, base.title);
  assert.equal(f.modelCalls, 1);
});
test('stopping while final optional collection waits prevents AI and late historical writes', async () => {
  const gate = deferred(),
    f = setup(gate);
  await boundary(f);
  const pending = f.lifecycle.reconcile();
  await turn();
  const before = f.edits.length;
  assert(f.edits.some(e => e.content === 'FINAL · Slipgate archived result confirmed.'));
  f.stop();
  gate.resolve();
  await pending;
  assert.equal(f.modelCalls, 0);
  assert.equal(f.edits.length, before);
});
