const assert = require('node:assert/strict');
const test = require('node:test');

const { createSlipgateServerLookup } = require('../../src/services/slipgateServerLookup');

function makeDetail({ addr, name, players, gameType = 'ca' }) {
  return {
    data: {
      ok: true,
      addr,
      name,
      info: {
        name,
        game_type: gameType,
        game_name: gameType === 'ca' ? 'Clan Arena' : 'Duel',
        map: 'campgrounds',
        max_clients: 16,
        rules: { roundlimit: '10' },
      },
      live: {
        state: 'live',
        game_type: gameType,
        map: 'campgrounds',
        elapsed_sec: 120,
        player_count: players.length,
        score_red: 4,
        score_blue: 3,
        players,
      },
    },
  };
}

test('fetches populated Oceania servers, gets details concurrently, and maps them to the existing renderer shape', async () => {
  const calls = [];
  let clock = 2_000_000_000_000;
  const lookup = createSlipgateServerLookup({
    now: () => clock,
    sleep: async ms => {
      clock += ms;
    },
    httpGet: url => {
      calls.push(url);
      if (url === 'https://slipgate.gg/api/v1/servers') {
        return {
          data: {
            ok: true,
            servers: [
              { addr: 'oce-low:27960', region: 'OCE', players: 2, name: 'Low' },
              { addr: 'eu:27960', region: 'EU', players: 8, name: 'EU' },
              { addr: 'oce-high:27960', region: 'OCE', players: 4, name: 'High' },
              { addr: 'oce-empty:27960', region: 'OCE', players: 0, name: 'Empty' },
            ],
          },
        };
      }
      if (url.endsWith('/oce-high%3A27960')) {
        return makeDetail({
          addr: 'oce-high:27960',
          name: 'High',
          players: [{ name: '^1Red', team: 1, score: 7 }],
        });
      }
      if (url.endsWith('/oce-low%3A27960')) {
        return makeDetail({
          addr: 'oce-low:27960',
          name: 'Low',
          players: [{ name: '^4Blue', team: 2, score: 5 }],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const servers = await lookup.getServers({ serverFilter: null });

  assert.equal(calls[0], 'https://slipgate.gg/api/v1/servers');
  assert.equal(servers.length, 2);
  assert.deepEqual(
    servers.map(server => server.address),
    ['oce-high:27960', 'oce-low:27960']
  );
  assert.deepEqual(servers[0], {
    address: 'oce-high:27960',
    source: 'slipgate',
    sourceUrl: 'https://slipgate.gg/servers/oce-high%3A27960',
    info: {
      serverName: 'High',
      map: 'campgrounds',
      players: 1,
      maxPlayers: 16,
      gameTypeShort: 'CA',
      gameType: 'Clan Arena',
    },
    rules: {
      g_levelStartTime: String(Math.floor(clock / 1000) - 120),
      g_redScore: 4,
      g_blueScore: 3,
      roundlimit: '10',
    },
    players: [{ name: '^1Red', team: 1, score: 7, totalConnected: undefined }],
  });
});

test('reuses a five-minute shared result cache and does not retain it after expiry', async () => {
  let now = 0;
  let requests = 0;
  const lookup = createSlipgateServerLookup({
    now: () => now,
    sleep: async ms => {
      now += ms;
    },
    cacheMinutes: 5,
    httpGet: url => {
      requests += 1;
      if (url === 'https://slipgate.gg/api/v1/servers') {
        return { data: { ok: true, servers: [{ addr: 'oce:27960', region: 'OCE', players: 1 }] } };
      }
      return makeDetail({ addr: 'oce:27960', name: 'OCE', players: [] });
    },
  });

  await lookup.getServers();
  await lookup.getServers();
  assert.equal(requests, 2);

  await lookup.getServers({ forceRefresh: true });
  assert.equal(requests, 4);

  now += 5 * 60 * 1000;
  await lookup.getServers();
  assert.equal(requests, 6);
});

test('only adds a Bearer token when one is configured and propagates provider failures for Syncore fallback', async () => {
  const calls = [];
  const lookup = createSlipgateServerLookup({
    apiKey: 'sg_test_key',
    httpGet: (url, options) => {
      calls.push({ url, options });
      const error = new Error('provider unavailable');
      error.config = { headers: options.headers };
      throw error;
    },
  });

  await assert.rejects(lookup.getServers(), error => {
    assert.match(error.message, /Slipgate request failed/);
    assert.equal(error.config, undefined);
    return true;
  });
  assert.deepEqual(calls[0].options.headers, { Authorization: 'Bearer sg_test_key' });
});

test('honours Slipgate Retry-After before making another provider request', async () => {
  let now = 0;
  let requests = 0;
  const lookup = createSlipgateServerLookup({
    now: () => now,
    sleep: async ms => {
      now += ms;
    },
    httpGet: () => {
      requests += 1;
      const error = new Error('rate limited');
      error.response = { status: 429, headers: { 'retry-after': '300' } };
      throw error;
    },
  });

  await assert.rejects(lookup.getServers(), /rate limited/);
  await assert.rejects(lookup.getServers(), /cooldown active for 300s/);
  assert.equal(requests, 1);

  now = 300_000;
  await assert.rejects(lookup.getServers(), /rate limited/);
  assert.equal(requests, 2);
});

test('honours an HTTP-date Retry-After before making another provider request', async () => {
  let now = Date.parse('2026-01-01T00:00:00Z');
  let requests = 0;
  const lookup = createSlipgateServerLookup({
    now: () => now,
    sleep: async ms => {
      now += ms;
    },
    httpGet: () => {
      requests += 1;
      const error = new Error('rate limited');
      error.response = {
        status: 429,
        headers: { 'retry-after': 'Thu, 01 Jan 2026 00:05:00 GMT' },
      };
      throw error;
    },
  });

  await assert.rejects(lookup.getServers(), /rate limited/);
  await assert.rejects(lookup.getServers(), /cooldown active for 300s/);
  assert.equal(requests, 1);

  now = Date.parse('2026-01-01T00:05:00Z');
  await assert.rejects(lookup.getServers(), /rate limited/);
  assert.equal(requests, 2);
});
