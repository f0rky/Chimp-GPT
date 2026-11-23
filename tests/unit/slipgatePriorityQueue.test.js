'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSlipgateClient } = require('../../src/services/slipgateClient');
function deferred() {
  let resolve;
  const promise = new Promise(r => {
    resolve = r;
  });
  return { promise, resolve };
}
const env = {
  SLIPGATE_EXPERIMENTAL_POLLING: 'true',
  SLIPGATE_EXPERIMENTAL_REQUESTS_PER_MINUTE: '6',
  SLIPGATE_API_KEY: 'test',
};
const detail = addr => ({
  data: { ok: true, addr, info: {}, live: { state: 'live', players: [] } },
});

test('live request is selected over queued background after shared slot opens', async () => {
  let time = 0,
    firstSleep;
  const calls = [];
  const client = createSlipgateClient({
    env,
    now: () => time,
    sleep: async ms => {
      if (!firstSleep) {
        firstSleep = deferred();
        await firstSleep.promise;
      }
      time += ms;
    },
    httpGet: async url => {
      calls.push(url);
      return url.includes('/servers/')
        ? detail('oce.example:27960')
        : { data: { ok: true, servers: [] } };
    },
  });
  await client.request('/matches');
  const bg = client.request('/servers');
  await new Promise(r => setImmediate(r));
  const live = client.getServer('oce.example:27960');
  await new Promise(r => setImmediate(r));
  firstSleep.resolve();
  await Promise.all([bg, live]);
  assert.match(calls[1], /servers\/oce\.example%3A27960/);
});

test('deferRatings never dispatches a missing bulk request', async () => {
  const calls = [];
  const raw = detail('oce.example:27960');
  raw.data.live.game_type = 'ca';
  raw.data.live.rating_set = 'B';
  raw.data.live.players = [{ steam_id: '76561198000000001', name: 'Player', team: 1 }];
  const client = createSlipgateClient({
    env,
    httpGet: async url => {
      calls.push(url);
      return raw;
    },
    httpPost: async url => {
      calls.push(url);
      throw Error('should not dispatch');
    },
  });
  const result = await client.getServer('oce.example:27960', { deferRatings: true });
  assert.equal(result.gameType, 'ca');
  assert.equal(result.ratingSet, 'B');
  assert.equal(result.players.length, 1);
  assert.deepEqual(calls, ['https://slipgate.gg/api/v1/servers/oce.example%3A27960']);
});

test('timing hook has safe fields and diagnostics cannot fail requests', async () => {
  const timing = [];
  const client = createSlipgateClient({
    env: {},
    httpGet: async () => ({ status: 200, data: { ok: true, servers: [] } }),
  });
  await client.request('/servers', {
    onRequestTiming: value => {
      timing.push(value);
      throw Error('ignored');
    },
  });
  assert.deepEqual(Object.keys(timing[0]).sort(), ['httpMs', 'kind', 'queueMs', 'status']);
  assert.equal(timing[0].kind, 'get');
  assert.equal(timing[0].status, 200);
});

function queueFixture() {
  let time = 0;
  const sleeps = [],
    starts = [];
  const client = createSlipgateClient({
    env,
    now: () => time,
    sleep: ms =>
      new Promise(resolve =>
        sleeps.push(() => {
          time += ms;
          resolve();
        })
      ),
    httpGet: async url => {
      starts.push({ path: new URL(url).pathname, time });
      return { data: { ok: true } };
    },
  });
  const turn = () => new Promise(resolve => setImmediate(resolve));
  async function release() {
    for (let i = 0; i < 5 && !sleeps.length; i++) await turn();
    assert.ok(sleeps.length, 'expected the shared limiter to wait');
    sleeps.shift()();
    await turn();
    await turn();
  }
  return { client, starts, release, turn };
}

test('three live admissions at most precede waiting optional work; all retain quota spacing', async () => {
  const f = queueFixture();
  await f.client.request('/matches/seed');
  const background = f.client.request('/matches/background');
  const lives = Array.from({ length: 5 }, (_, i) =>
    f.client.request(`/matches/live${i}`, { priority: 'live' })
  );
  for (let i = 0; i < 6; i++) await f.release();
  await Promise.all([background, ...lives]);
  assert.equal(f.starts[4].path, '/api/v1/matches/background');
  for (let i = 1; i < f.starts.length; i++)
    assert.ok(f.starts[i].time - f.starts[i - 1].time >= 10000);
  for (const s of f.starts)
    assert.ok(f.starts.filter(x => x.time > s.time - 60000 && x.time <= s.time).length <= 6);
});

test('a coalesced live waiter promotes its canonical pending request without a duplicate HTTP call', async () => {
  const f = queueFixture();
  await f.client.request('/matches/seed');
  const old = f.client.request('/matches/old'),
    target = f.client.request('/matches/target');
  const promoted = f.client.request('/matches/target', { priority: 'live' });
  await f.release();
  assert.equal(f.starts[1].path, '/api/v1/matches/target');
  await f.release();
  await Promise.all([old, target, promoted]);
  assert.equal(f.starts.filter(x => x.path.endsWith('/target')).length, 1);
});

test('queued background and live work both fail on full Retry-After without another HTTP dispatch', async () => {
  let time = 0,
    calls = 0;
  const client = createSlipgateClient({
    env,
    now: () => time,
    sleep: async ms => {
      time += ms;
    },
    httpGet: async () => {
      calls++;
      throw Object.assign(Error('limit'), {
        response: { status: 429, headers: { 'retry-after': '120' } },
      });
    },
  });
  const results = await Promise.allSettled([
    client.request('/matches/first'),
    client.request('/matches/background'),
    client.request('/matches/live', { priority: 'live' }),
  ]);
  assert.equal(calls, 1);
  for (const r of results) {
    assert.equal(r.status, 'rejected');
    assert.equal(r.reason.status, 429);
    assert.equal(r.reason.retryAfterMs, 120000);
  }
  assert.equal(client.pollingPolicy().cooldownMs, 120000);
});

test('queue capacity remains 64 across both priorities and drains after the held slot', async () => {
  const f = queueFixture();
  await f.client.request('/matches/seed');
  const requests = Array.from({ length: 64 }, (_, i) =>
    f.client.request(`/matches/q${i}`, { priority: i % 2 ? 'live' : 'background' })
  );
  await assert.rejects(f.client.request('/matches/overflow'), /queue full/);
  for (let i = 0; i < 64; i++) await f.release();
  await Promise.all(requests);
  assert.equal(f.starts.length, 65);
});
