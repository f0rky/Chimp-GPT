'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSlipgateClient } = require('../../src/services/slipgateClient');

function detail() {
  return {
    ok: true,
    addr: 'thepurgery.com:27960',
    name: 'Public contract fixture',
    conn_status: 'online',
    live: {
      state: 'live',
      map: 'hiddenfortress',
      game_type: 'ca',
      rating_set: 'B',
      match_guid: 'fixture-guid',
      score_red: 0,
      score_blue: 2,
      round: 2,
      a2s_only: true,
      score_source: 'a2s',
      updated_at: new Date().toISOString(),
      players: [],
      prediction: {
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
      },
    },
  };
}

test('actual API nests a2s_only and score_source inside live, not server detail', async () => {
  const client = createSlipgateClient({ env: {}, httpGet: async () => ({ data: detail() }) });
  const snapshot = await client.getServer('thepurgery.com:27960');
  assert.equal(snapshot.quality.a2sOnly, true);
  assert.equal(snapshot.quality.scoreSource, 'a2s');
  assert.equal(snapshot.quality.connStatus, 'online');
  assert.equal(snapshot.scoreRed, 0);
});

test('optional prediction is actually requested with documented include_prediction flag', async () => {
  const client = createSlipgateClient({
    env: {},
    httpGet: async (_url, options) => {
      assert.equal(options.params.include_prediction, 'true');
      return { data: detail() };
    },
  });
  const snapshot = await client.getServer('thepurgery.com:27960', { includePrediction: true });
  assert.deepEqual(snapshot.prediction.probs, { red: 0.4, blue: 0.6 });
});

test('server selection passes prediction opt-in to its initial detail GET', async () => {
  const paramsSeen = [];
  const client = createSlipgateClient({
    env: {},
    httpGet: async (_url, options) => {
      paramsSeen.push(options.params);
      return { data: detail() };
    },
  });
  await client.selectServer('thepurgery.com:27960', { includePrediction: true });
  assert.equal(paramsSeen.length, 1);
  assert.equal(paramsSeen[0].include_prediction, 'true');
});

test('private prediction rows are discarded before the normalized snapshot is exposed', async () => {
  const raw = detail();
  raw.live.rating_set = 'B';
  raw.live.prediction = {
    family: 'team',
    state: 'live',
    game_type: 'ca',
    rating_set: 'B',
    basis: 'set',
    calibrated: true,
    conditioned: true,
    roundlimit: 10,
    prior: { red: 0.5, blue: 0.5 },
    probs: { red: 0.5, blue: 0.5 },
    fairness: 1,
    red: [{ steam_id: '76561198000000001', name: 'SecretName', private: true, display: 2000 }],
    blue: [],
  };
  const client = createSlipgateClient({ env: {}, httpGet: async () => ({ data: raw }) });
  const result = await client.getServer('thepurgery.com:27960', { includePrediction: true });
  assert.doesNotMatch(JSON.stringify(result), /SecretName|76561198000000001|2000/);
});
