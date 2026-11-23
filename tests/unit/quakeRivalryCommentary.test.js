'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRivalryContext } = require('../../src/services/quakeRivalryContext');

test('commentary model may select only complete grounded candidate observations', async () => {
  const snapshot = {
    state: 'WARMUP',
    map: 'campgrounds',
    scoreRed: 2,
    scoreBlue: 1,
    players: [{ name: 'A', team: 1, score: 3, private: false }],
  };
  const context = createRivalryContext({
    enabled: () => true,
    service: { collect: async () => null },
    commentaryProvider: async input => {
      assert.equal(input.snapshot.players[0].name, 'A');
      return { candidateIds: [0, 900] };
    },
  });
  const text = await context.summarize(snapshot, { facts: [] });
  assert.match(text, /^AI-assisted assessment:/);
  assert.match(text, /warmup scores are not a result/);
  assert.doesNotMatch(text, /900|winner|wins/);
});

test('invalid model selection falls back to grounded recorded context; private players are excluded', async () => {
  const snapshot = {
    state: 'LIVE',
    scoreRed: 8,
    scoreBlue: 4,
    players: [
      { name: 'Public', score: 7, private: false },
      { name: 'Secret', score: 99, private: true },
    ],
  };
  const context = createRivalryContext({
    enabled: () => true,
    service: { collect: async () => null },
    commentaryProvider: async () => ({ candidateIds: [99] }),
  });
  const text = await context.summarize(snapshot, { facts: ['Public leads on reported score.'] });
  assert.match(text, /^Recorded context:/);
  assert.doesNotMatch(text, /Secret|99/);
});
