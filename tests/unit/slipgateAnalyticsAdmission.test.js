'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSlipgateClient } = require('../../src/services/slipgateClient');
const A = '76561198000000001';
const B = '76561198000000002';
function fixture() {
  const calls = [];
  let time = 1800000000000;
  const client = createSlipgateClient({
    env: {},
    now: () => time,
    sleep: async ms => {
      time += ms;
    },
    httpGet: async (url, config) => {
      calls.push({ url, config });
      return { data: { ok: true, marker: 'contract-fixture' } };
    },
  });
  return { client, calls };
}
test('documented analytics paths use canonical fixed-host transport and shared cache', async () => {
  const { client, calls } = fixture();
  const h2h = `/players/${A}/head-to-head/${B}`;
  assert.equal((await client.request(h2h)).data.marker, 'contract-fixture');
  await client.request(h2h);
  await client.request(`/players/${A}/weapons`, {
    params: { game_type: 'ca', rating_set: 'A', last: 20 },
  });
  await client.request(`/players/${A}/weapons`, {
    params: { game_type: 'ca', rating_set: 'B', last: 200 },
  });
  await client.request(`/players/${A}/peers`, { params: { game_type: 'ca', last: 20, limit: 2 } });
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, `https://slipgate.gg/api/v1${h2h}`);
  assert.deepEqual(calls[1].config.params, { game_type: 'ca', last: '20', rating_set: 'A' });
  assert.equal(calls[0].config.maxRedirects, 0);
});
test('analytics rejects unsupported routes, malformed literal IDs and unsupported query dimensions before dispatch', async () => {
  const { client, calls } = fixture();
  const attempts = [
    ['/players/7656119800000000/head-to-head/' + B, {}],
    [`/players/${A}/head-to-head/${B}`, { params: { game_type: 'ca' } }],
    [`/players/${A}/head-to-head/${B}`, { params: { rating_set: 'A' } }],
    [`/players/${A}/peers`, { params: { rating_set: 'A' } }],
    [`/players/${A}/peers`, { params: { limit: 51 } }],
    [`/players/${A}/medals`, {}],
    [`/players/${A}/weapons`, { params: { last: 201 } }],
    [`/players/${A}/weapons`, { params: { rating_set: 'C' } }],
    [`/players/${A}/weapons`, { params: { last: 0 } }],
    [`/players/${A}/weapons`, { params: { game_type: 'ca/../duel' } }],
    [`/players/${A}/unknown`, {}],
    [`/players/${A}/weapons`, { params: { server: 'example:27960' } }],
    ['https://example.invalid/players/' + A + '/medals', {}],
  ];
  for (const [path, options] of attempts)
    await assert.rejects(client.request(path, options), TypeError);
  assert.equal(calls.length, 0);
});
