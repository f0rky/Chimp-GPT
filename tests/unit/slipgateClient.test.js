'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSlipgateClient } = require('../../src/services/slipgateClient');
const detail = (addr = 'oce.example:27960') => ({
  data: {
    ok: true,
    addr,
    name: 'Test',
    info: { standard_factory: false },
    live: {
      state: 'live',
      score_red: 0,
      score_blue: null,
      elapsed_sec: 0,
      players: [{ name: 'secret', private: true, kills: 0, score: 0 }],
    },
  },
});
test('normalizes nullable values, preserves zero and anonymizes private players', async () => {
  const c = createSlipgateClient({ env: {}, httpGet: async () => detail() });
  const s = await c.getServer('oce.example:27960');
  assert.equal(s.scoreRed, 0);
  assert.equal(s.scoreBlue, null);
  assert.equal(s.elapsedSeconds, 0);
  assert.equal(s.players[0].name, 'Anonymous');
  assert.equal(s.players[0].kills, 0);
  assert.equal(s.players[0].private, true);
  assert.deepEqual(Object.keys(s), [
    'address',
    'name',
    'map',
    'state',
    'gameType',
    'ratingSet',
    'matchGuid',
    'round',
    'elapsedSeconds',
    'scoreRed',
    'scoreBlue',
    'players',
    'prediction',
    'sourceUpdatedAt',
    'fetchedAt',
    'stale',
    'staleReason',
    'quality',
  ]);
});
test('rejects URL/path injection, requires address and GUID validation, and rejects mismatched responses', async () => {
  const c = createSlipgateClient({ env: {}, httpGet: async () => detail('wrong:27960') });
  await assert.rejects(c.getServer('https://evil.test/x'), /Invalid server address/);
  await assert.rejects(c.getServer('oce:27960'), /mismatch/);
  await assert.rejects(c.getMatch(''), /Invalid match GUID/);
  await assert.rejects(c.request('https://evil.test'), /Invalid Slipgate API path/);
});
test('polling fails closed without confirmed quota; confirmed watch budget is capped', () => {
  assert.equal(createSlipgateClient({ env: {} }).pollingPolicy().enabled, false);
  assert.equal(
    createSlipgateClient({
      env: {
        SLIPGATE_CONFIRMED_REQUESTS_PER_WINDOW: '100',
        SLIPGATE_CONFIRMED_WINDOW_SECONDS: '60',
        SLIPGATE_WATCH_BUDGET_FRACTION: '0.25',
      },
    }).pollingPolicy().enabled,
    true
  );
  assert.equal(
    createSlipgateClient({
      env: {
        SLIPGATE_CONFIRMED_REQUESTS_PER_WINDOW: '100',
        SLIPGATE_CONFIRMED_WINDOW_SECONDS: '60',
        SLIPGATE_WATCH_BUDGET_FRACTION: '0.5',
      },
    }).pollingPolicy().enabled,
    false
  );
});
test('catalogue pagination is capped at ten pages and empty OCE catalogue returns null', async () => {
  let calls = 0;
  const c = createSlipgateClient({
    env: {},
    httpGet: async url => {
      calls++;
      return {
        data: { ok: true, servers: Array(100).fill({ addr: 'x:27960', region: 'EU', players: 1 }) },
      };
    },
  });
  assert.equal(await c.selectServer(), null);
  assert.equal(calls, 10);
});
test('singleflight coalesces and cached data is reused', async () => {
  let calls = 0,
    resolve;
  const c = createSlipgateClient({
    env: {},
    httpGet: () => {
      calls++;
      return new Promise(r => (resolve = r));
    },
  });
  const a = c.request('/servers'),
    b = c.request('/servers');
  await new Promise(r => setImmediate(r));
  resolve({ data: { ok: true, servers: [] } });
  await Promise.all([a, b]);
  await c.request('/servers');
  assert.equal(calls, 1);
});
test('429 Retry-After establishes a shared cooldown without retries', async () => {
  let now = 1000,
    calls = 0;
  const c = createSlipgateClient({
    env: {},
    now: () => now,
    httpGet: async () => {
      calls++;
      const e = Error('secret');
      e.response = { status: 429, headers: { 'retry-after': '10' } };
      throw e;
    },
  });
  await assert.rejects(c.request('/servers'), /rate limited/);
  await assert.rejects(c.request('/matches'), /cooldown/);
  assert.equal(calls, 1);
  now += 10000;
});

test('shared force-refresh/lookup budget, cooldown, exact recovery and stale cache preserve original fetch time', async () => {
  const { createSlipgateServerLookup } = require('../../src/services/slipgateServerLookup');
  let time = 0,
    calls = 0,
    limited = false;
  const client = createSlipgateClient({
    env: {},
    now: () => time,
    sleep: async ms => {
      time += ms;
    },
    httpGet: async url => {
      calls++;
      if (limited)
        throw Object.assign(Error('secret credentials'), {
          response: { status: 429, headers: { 'retry-after': '10' } },
        });
      if (url.endsWith('/servers'))
        return {
          data: { ok: true, servers: [{ addr: 'oce.example:27960', region: 'OCE', players: 1 }] },
        };
      return detail();
    },
  });
  const first = await client.getServer('oce.example:27960');
  assert.equal(first.fetchedAt, 0);
  const lookup = createSlipgateServerLookup({ client, now: () => time });
  await lookup.getServers();
  assert.equal(calls, 2);
  limited = true;
  const stale = await client.getServer('oce.example:27960', { forceRefresh: true });
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, 0);
  assert.equal(calls, 3);
  await assert.rejects(lookup.getServers({ forceRefresh: true }), /cooldown/);
  assert.equal(calls, 3);
  await assert.rejects(client.request('/matches', { noCache: true }), /cooldown/);
  assert.equal(calls, 3);
  time += 10000;
  limited = false;
  const recovered = await client.getServer('oce.example:27960', { forceRefresh: true });
  assert.equal(recovered.stale, false);
  assert.equal(calls, 4);
  time += 600001;
  limited = true;
  await assert.rejects(client.getServer('oce.example:27960'), /rate limited/);
});
test('queued requests recheck 429 cooldown after admission waits, with no network retries', async () => {
  let time = 0,
    calls = 0;
  const client = createSlipgateClient({
    env: {},
    now: () => time,
    sleep: async ms => {
      time += ms;
    },
    httpGet: async () => {
      calls++;
      throw Object.assign(Error('quota'), {
        response: { status: 429, headers: { 'retry-after': '60' } },
      });
    },
  });
  const results = await Promise.allSettled([
    client.request('/servers'),
    client.request('/matches'),
    client.request('/matches/guid'),
  ]);
  assert.equal(results.filter(r => r.status === 'rejected').length, 3);
  assert.equal(calls, 1);
});
test('typed hostile/null fields remain missing, spectators separate, no enrichment, no redirects and steam IDs never numeric', async () => {
  let calls = 0;
  const client = createSlipgateClient({
    env: {},
    httpGet: async (_url, opts) => {
      calls++;
      assert.equal(opts.maxRedirects, 0);
      const d = detail();
      d.data.updated_at = 'invalid';
      d.data.live.players = [
        {
          name: 'private real name',
          private: true,
          steam_id: '76561198000000001',
          team: 3,
          kills: '99',
          damage_dealt: 0,
          alive: false,
        },
      ];
      d.data.info.standard_factory = false;
      d.data.live.game_type = 'ca';
      d.data.prediction = {
        family: 'team',
        state: 'live',
        game_type: 'ca',
        rating_set: 'B',
        basis: 'set',
        calibrated: true,
        conditioned: true,
        roundlimit: 10,
        prior: { red: 0.5, blue: 0.5 },
        probs: { red: 0.4, blue: 0.6 },
        fairness: 1,
        red: [],
        blue: [],
      };
      return d;
    },
  });
  const s = await client.getServer('oce.example:27960', { includePrediction: true });
  assert.equal(calls, 1);
  assert.equal(s.players[0].name, 'Anonymous');
  assert.equal(s.players[0].kills, null);
  assert.equal(s.players[0].team, 3);
  assert.equal(s.players[0].damage, 0);
  assert.equal(s.players[0].alive, false);
  assert.equal(s.sourceUpdatedAt, null);
  assert.deepEqual(s.prediction.probs, { red: 0.4, blue: 0.6 });
  assert.equal(JSON.stringify(s).includes('76561198000000001'), false);
  for (const path of [
    '/servers/..',
    '/servers/evil%2Fpath',
    '/matches/%2F%2Fevil',
    '//evil',
    '/servers#bad',
  ])
    await assert.rejects(client.request(path), /Invalid/);
});

test('pending requests and HTTP cache have hard bounds, independent of freshness', async () => {
  let time = 0,
    calls = 0;
  const { deferred, turn } = require('../helpers/slipgateFixtures');
  const barrier = deferred();
  let hold = true;
  const client = createSlipgateClient({
    env: {},
    now: () => time,
    sleep: async ms => {
      if (hold) await barrier.promise;
      time += ms;
    },
    httpGet: async () => {
      calls++;
      return { data: { ok: true } };
    },
  });
  await client.request('/servers');
  const queued = Array.from({ length: 64 }, (_, i) => client.request(`/matches/q${i}`));
  await turn();
  await assert.rejects(client.request('/matches/overflow'), /queue full/);
  assert.equal(calls, 1);
  hold = false;
  barrier.resolve();
  await Promise.all(queued);
  assert.equal(calls, 65);
  let requests = 0;
  time = 0;
  const cached = createSlipgateClient({
    env: {
      SLIPGATE_CONFIRMED_REQUESTS_PER_WINDOW: '100000',
      SLIPGATE_CONFIRMED_WINDOW_SECONDS: '1',
      SLIPGATE_WATCH_BUDGET_FRACTION: '0.25',
    },
    now: () => time,
    sleep: async ms => {
      time += ms;
    },
    httpGet: async () => {
      requests++;
      return { data: { ok: true } };
    },
  });
  for (let i = 0; i < 257; i++) await cached.request(`/matches/m${i}`);
  assert.equal(requests, 257);
  await cached.request('/matches/m0');
  assert.equal(requests, 258);
  await cached.request('/matches/m256');
  assert.equal(requests, 258);
});
test('old source timestamps are explicitly stale', async () => {
  let time = Date.parse('2026-01-01T01:00:00Z');
  const client = createSlipgateClient({
    env: {},
    now: () => time,
    httpGet: async () => {
      const d = detail();
      d.data.source_updated_at = '2026-01-01T00:00:00Z';
      return d;
    },
  });
  const s = await client.getServer('oce.example:27960');
  assert.equal(s.stale, true);
  assert.match(s.staleReason, /older/);
});
