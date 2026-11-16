'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSlipgateCard } = require('../../src/handlers/slipgateCardRenderer');
const fixture = () => ({
  name: 'Test arena',
  address: 'fixture:27960',
  state: 'live',
  gameType: 'ca',
  ratingSet: 'B',
  round: 2,
  scoreRed: 1,
  scoreBlue: 0,
  players: [
    {
      name: 'Red player',
      team: 1,
      score: 18,
      kills: 3,
      deaths: 2,
      alive: true,
      rating: { display: 1630 },
    },
    {
      name: 'Blue player',
      team: 2,
      score: 17,
      kills: 2,
      deaths: 3,
      alive: true,
      rating: { display: 1667 },
    },
    { name: 'Spectator', team: 3 },
  ],
});
test('Red then full-width VS then Blue; spectators follow both opponents', () => {
  const c = renderSlipgateCard(fixture()).toJSON();
  assert.equal(c.fields.length, 4);
  assert.match(c.fields[0].name, /Red/);
  assert.equal(c.fields[1].name, 'VS');
  assert.ok(c.fields[1].value.length > 0);
  assert.match(c.fields[2].name, /Blue/);
  assert.match(c.fields[3].name, /Spectators/);
  assert.ok(c.fields.every(f => f.inline === false));
  assert.match(c.description, /LIVE/);
  for (const f of [c.fields[0], c.fields[2]]) {
    assert.match(f.value.split('\n')[1], /ELO/);
    assert.doesNotMatch(f.value, /Rtg/);
  }
});
test('VS is omitted without two team sections, including spectator-only and empty views', () => {
  for (const players of [
    [],
    fixture().players.filter(p => p.team !== 2),
    fixture().players.filter(p => p.team === 3),
  ]) {
    const s = { ...fixture(), scoreRed: null, scoreBlue: null, players };
    const c = renderSlipgateCard(s).toJSON();
    assert.ok((c.fields || []).every(f => f.name !== 'VS' && f.inline === false));
  }
});
test('warmup/final/stale keep stacked teams and VS without unsupported active-status claims', () => {
  for (const overrides of [{ state: 'warmup' }, { state: 'final' }, { stale: true }]) {
    const c = renderSlipgateCard({ ...fixture(), ...overrides }).toJSON();
    assert.equal(c.fields.filter(f => f.name === 'VS').length, 1);
    assert.ok(c.fields.every(f => f.inline === false));
    assert.doesNotMatch(JSON.stringify(c), /🟢|💀/);
    if (overrides.state === 'warmup') assert.doesNotMatch(c.fields[0].value, /ELO|K\/D|1630/);
  }
});
