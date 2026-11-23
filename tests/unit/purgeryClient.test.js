'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPurgeryClient } = require('../../src/services/purgeryClient');
test('bulk validated query, cache, normalization and missing IDs', async () => {
  let now = 1000,
    calls = 0;
  const client = createPurgeryClient({
    now: () => now,
    httpGet: async (url, opt) => {
      calls++;
      assert.equal(url, 'https://thepurgery.com/api/v1/players');
      assert.equal(opt.maxRedirects, 0);
      return {
        status: 200,
        data: {
          players: [
            {
              steam_id: '76561198000000001',
              name_plain: 'A',
              pummels: { total: 0, victims: [] },
              games: { completed: 1, left: 0 },
            },
          ],
        },
      };
    },
  });
  const ids = ['76561198000000001', '76561198000000002'];
  const a = await client.getPlayers(ids);
  assert.equal(a.players[0].pummels.total, 0);
  assert.deepEqual(a.missing, ['76561198000000002']);
  await client.getPlayers(ids);
  assert.equal(calls, 1);
  await assert.rejects(client.getPlayers(['nope']), /valid Steam IDs/);
});
test('honours full Retry-After without automatic retry and fails fast during cooldown', async () => {
  let now = 10_000,
    calls = 0,
    slept = 0;
  const client = createPurgeryClient({
    now: () => now,
    httpGet: async () => {
      calls += 1;
      return { status: 429, headers: { 'retry-after': '120' } };
    },
  });
  await assert.rejects(
    client.getPlayers(['76561198000000001']),
    error => error.status === 429 && error.retryAfterMs === 120000
  );
  assert.equal(calls, 1);
  await assert.rejects(
    client.getPlayers(['76561198000000002']),
    error => error.status === 429 && error.retryAfterMs === 120000
  );
  assert.equal(calls, 1);
});
test('coalesces concurrent duplicate requests', async () => {
  let calls = 0,
    release;
  const wait = new Promise(r => (release = r));
  const c = createPurgeryClient({
    httpGet: async () => {
      calls++;
      await wait;
      return { status: 200, data: { players: [] } };
    },
  });
  const a = c.getPlayers(['76561198000000001']),
    b = c.getPlayers(['76561198000000001']);
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 1);
  release();
  await Promise.all([a, b]);
});
