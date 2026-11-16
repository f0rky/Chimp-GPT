'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSlipgateCard } = require('../../src/handlers/slipgateCardRenderer');
const base = () => ({
  name: 'Fixture',
  address: 'fixture:27960',
  state: 'live',
  gameType: 'ca',
  ratingSet: 'B',
  round: 3,
  scoreRed: 2,
  scoreBlue: 1,
  quality: {},
  players: [
    {
      name: 'Red player',
      team: 1,
      score: 23,
      kills: 5,
      deaths: 2,
      alive: true,
      rating: { display: 2100 },
    },
    { name: 'Blue player', team: 2, score: 18, kills: 3, deaths: 3, alive: false },
    { name: 'Watcher', team: 3 },
  ],
});
test('native team fields have identical compact headers and missing rating remains unknown', () => {
  const c = renderSlipgateCard(base()).toJSON();
  assert.equal(c.fields.length, 4);
  assert.deepEqual(
    c.fields.map(f => f.inline),
    [false, false, false, false]
  );
  assert.match(c.fields[0].name, /Red/);
  assert.match(c.fields[2].name, /Blue/);
  assert.equal(c.fields[0].value.split('\n')[1], c.fields[2].value.split('\n')[1]);
  for (const f of c.fields.filter(f => f.name !== 'VS').slice(0, 2))
    for (const line of f.value.split('\n')) assert.ok([...line].length <= 32);
  assert.match(c.fields[2].value, /3\/3\s+—/);
  assert.doesNotMatch(c.description, /Red player|Blue player|Watcher/);
  assert.match(c.fields[3].value, /Watcher/);
});
test('adaptive widths preserve larger score/KD/rating values without numeric truncation', () => {
  const s = base();
  Object.assign(s.players[0], {
    score: 1234567,
    kills: 123456,
    deaths: 54321,
    rating: { display: 99999 },
  });
  const c = renderSlipgateCard(s).toJSON();
  assert.match(c.fields[0].value, /1234567/);
  assert.match(c.fields[0].value, /123456\/54321/);
  assert.match(c.fields[0].value, /99999/);
  assert.equal(c.fields[0].value.split('\n')[1], c.fields[2].value.split('\n')[1]);
});
test('field limits preserve closed fences and exact shown plus omitted population under hostile Unicode rosters', () => {
  const s = base();
  s.players = Array.from({ length: 256 }, (_, i) => ({
    name: '長🦍'.repeat(30) + '<@everyone>`',
    team: i % 4,
    score: i,
    kills: i,
    deaths: 0,
    alive: true,
    private: i % 5 === 0,
    rating: { display: 2100 },
  }));
  const c = renderSlipgateCard(s).toJSON();
  let total = (c.title || '').length + (c.description || '').length + c.footer.text.length;
  for (const f of c.fields) {
    assert.ok(f.name.length <= 256);
    assert.ok(f.value.length <= 1024);
    assert.doesNotMatch(f.value, /<@|@everyone/);
    if (f.name === 'VS') {
      assert.equal(f.value, '\u200b');
      total += f.name.length + f.value.length;
      continue;
    }
    assert.equal((f.value.match(/```/g) || []).length, 2);
    const inside = f.value.match(/```\n([\s\S]*?)\n```/)[1].split('\n');
    const hasHeader = /^\s*Name/.test(inside[0]);
    const shown = inside.length - Number(hasHeader);
    const omitted = Number(f.value.match(/… (\d+) more reported/)?.[1] || 0);
    assert.equal(shown + omitted, 64);
    total += f.name.length + f.value.length;
  }
  assert.ok(total <= 6000);
  assert.ok(c.description.length <= 4096);
});
test('warmup and final stacked layouts preserve state/privacy and never claim live player status', () => {
  for (const state of ['warmup', 'final']) {
    const s = base();
    s.state = state;
    s.players[0].private = true;
    s.players[0].name = 'HIDDEN';
    s.finalNotice = 'Archived result confirmed';
    const c = renderSlipgateCard(s).toJSON();
    const text = JSON.stringify(c);
    assert.match(c.description, new RegExp(state.toUpperCase()));
    assert.match(text, /Anonymous/);
    assert.doesNotMatch(text, /HIDDEN|🟢|💀/);
    assert.equal(c.fields[0].inline, false);
    assert.equal(c.fields[2].inline, false);
    if (state === 'warmup') assert.doesNotMatch(c.fields[0].value, /23|5\/2|2100/);
    else assert.match(c.description, /Archived result confirmed/);
  }
});
