'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRivalryContext,
  identity,
  deterministic,
} = require('../../src/services/quakeRivalryContext');
const { renderGauntReport, appendGauntContext } = require('../../src/handlers/gauntCardRenderer');
const { EmbedBuilder } = require('discord.js');
const fixture = require('../helpers/gauntFixtures');
const { createRivalryService } = require('../../src/services/quakeRivalryService');
test('context identity includes server but not round scores or phase case', () => {
  const s = { address: 'a:27960', state: 'warmup', players: [] };
  assert.notEqual(identity(s), identity({ ...s, address: 'b:27960' }));
  assert.equal(identity(s), identity({ ...s, state: 'WARMUP', scoreRed: 4 }));
});
test('confirmed archive context cannot reuse live cache; cache hits are cloned', async () => {
  let calls = 0;
  const c = createRivalryContext({
    enabled: () => true,
    service: {
      collect: async (_, opts) => ({
        facts: [opts.archive ? 'final' : 'live'],
        players: [],
        number: ++calls,
      }),
    },
  });
  const s = { state: 'live', address: 'a:27960', players: [] };
  const one = await c.collect(s);
  one.facts[0] = 'poison';
  assert.equal((await c.collect(s)).facts[0], 'live');
  assert.equal(
    (await c.collect({ ...s, state: 'final' }, { archive: { match_guid: 'fixture' } })).facts[0],
    'final'
  );
  assert.equal(calls, 2);
});
test('warmup assessment ignores carried-over scores and private names', () => {
  const result = deterministic(
    {
      state: 'warmup',
      scoreRed: 99,
      scoreBlue: 44,
      players: [{ name: 'Secret', private: true, score: 900 }],
    },
    { facts: [] }
  );
  assert.doesNotMatch(result, /99|44|900|Secret|highest|lead/i);
  assert.match(result, /warmup|roster/i);
});
test('commentary is bounded, aborts the underlying operation and excludes IDs', async () => {
  let payload, signal;
  const c = createRivalryContext({
    commentaryTimeoutMs: 10,
    commentaryProvider: input => {
      payload = input;
      signal = input.signal;
      return new Promise(() => {});
    },
  });
  const result = await c.summarize(
    { state: 'live', players: fixture.players.map(p => ({ ...p, score: 4 })) },
    fixture
  );
  assert.match(result, /^Recorded context:/);
  assert.equal(signal.aborted, true);
  assert.doesNotMatch(JSON.stringify(payload), /7656119/);
});
test('final scoreboard context includes named exact-match gaunts without altering base fields', () => {
  const r = {
    ...fixture,
    players: fixture.players.map((p, i) => ({ ...p, matchGaunts: i ? null : 4 })),
  };
  const base = new EmbedBuilder()
    .setTitle('FINAL')
    .addFields({ name: 'Original score', value: 'Complete original rows' });
  const out = appendGauntContext(base, r, { kind: 'final' }).toJSON();
  assert.deepEqual(out.fields[0], base.toJSON().fields[0]);
  assert.match(JSON.stringify(out), /Player A.*(?:match gaunts|this match).*4/);
});
test('hostile fact text and oversized rosters remain serializable and account for omissions', () => {
  const r = {
    ...fixture,
    facts: Array(5).fill('😀'.repeat(300)),
    players: Array.from({ length: 70 }, (_, i) => ({
      ...fixture.players[i % 2],
      name: 'Player ' + i,
      team: i % 2 ? 2 : 1,
    })),
  };
  const out = renderGauntReport(r).toJSON();
  assert.ok(out.fields.every(f => f.value.length <= 1024));
  assert.ok(out.fields.some(f => /Coverage/.test(f.name)));
  assert.ok(out.fields.some(f => /omitted/.test(f.value)));
  assert.ok(out.fields.filter(f => /Red|Blue/.test(f.name)).length >= 2);
});
test('actual collector accepts explicit duel opponents sharing neutral team zero', async () => {
  const players = fixture.players.map(p => ({ ...p, team: 0 }));
  let queries = 0;
  const s = createRivalryService({
    community: { getPlayers: async () => ({ players: [] }) },
    slipgate: {
      request: async () => {
        queries++;
        return { data: {} };
      },
    },
  });
  await s.collect(
    { address: 'a:27960', gameType: 'duel', players },
    { pairIds: players.map(p => p.steamId) }
  );
  assert.equal(queries, 1);
});
