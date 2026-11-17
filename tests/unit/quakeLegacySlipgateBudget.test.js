'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let rows = [],
  outage = false,
  alternateCalls = 0,
  modelCalls = 0;
const original = Module._load;
Module._load = function (name, parent, isMain) {
  if (parent?.filename.endsWith('/services/quakeLookup.js')) {
    if (name === './slipgateServerLookup')
      return {
        getSlipgateOceaniaServers: async () => {
          if (outage) throw Error('fixture outage');
          return rows;
        },
      };
    if (name === 'axios')
      return {
        get: async () => {
          alternateCalls++;
          throw Error('Forbidden alternate source');
        },
      };
    if (name === '../utils/retryWithBreaker') return async fn => fn();
    if (name === '../utils/apiKeyManager') return { getApiKey: () => 'fixture' };
    if (name === 'openai')
      return class {
        constructor() {
          this.chat = {
            completions: {
              create: async () => {
                modelCalls++;
                return { choices: [{ message: { content: 'MODEL OUTPUT' } }] };
              },
            },
          };
        }
      };
  }
  return original.call(this, name, parent, isMain);
};
let lookup;
try {
  lookup = require('../../src/services/quakeLookup');
} finally {
  Module._load = original;
}
test('empty or unavailable Slipgate never falls back to another live/player source', async () => {
  rows = [];
  await lookup();
  outage = true;
  await lookup();
  outage = false;
  assert.equal(alternateCalls, 0);
});
test('long temporary forceRefresh output is bounded without any LLM calls', async () => {
  rows = Array.from({ length: 3 }, (_, i) => ({
    address: `oce-${i}:27960`,
    source: 'slipgate',
    info: {
      serverName: `Arena ${i}`,
      map: 'campgrounds',
      players: 32,
      maxPlayers: 32,
      gameType: 'Clan Arena',
      gameTypeShort: 'CA',
    },
    rules: { g_levelStartTime: '0', g_redScore: 4, g_blueScore: 3, roundlimit: '10' },
    players: Array.from({ length: 32 }, (_, n) => ({
      name: `Player name ${n} repeated text`,
      team: (n % 2) + 1,
      score: 12,
      totalConnected: '1:00',
    })),
  }));
  const text = await lookup(null, null, { forceRefresh: true });
  assert.equal(modelCalls, 0);
  assert.ok(text.length <= 2000);
  assert.match(text, /omitted|Arena/);
});
