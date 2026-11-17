'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { archiveFinal } = require('../../src/services/scoreboardLifecycle');
const { renderSlipgateCard } = require('../../src/handlers/slipgateCardRenderer');
const { snapshot } = require('../helpers/slipgateFixtures');
const A = '76561198000000001',
  B = '76561198000000002';
const END = '2026-11-16T05:09:07Z',
  CHECKED = Date.parse('2026-11-16T05:10:50Z');
function fixture() {
  const old = {
    ...snapshot(),
    matchGuid: 'old-guid',
    ratingSet: 'B',
    map: 'previous-live-map',
    fetchedAt: Date.parse('2026-11-16T05:08:00Z'),
    players: [
      {
        name: 'Red live',
        steamId: A,
        team: 1,
        private: false,
        score: 50,
        kills: 12,
        deaths: 8,
        rating: { display: 1800, provisional: true },
      },
      {
        name: 'Blue live',
        steamId: B,
        team: 2,
        private: false,
        score: 75,
        kills: 20,
        deaths: 7,
        rating: { display: 1900 },
      },
    ],
  };
  const archive = {
    ok: true,
    match_guid: 'old-guid',
    server: { addr: old.address },
    game_type: 'ca',
    rating_set: 'B',
    map: 'cannedheat',
    ended_at: END,
    duration_sec: 642,
    team_red_score: 4,
    team_blue_score: 10,
    rated: false,
    aborted: false,
    players: [
      {
        steam_id: A,
        nick: 'Red archived',
        team: 1,
        score: 61,
        kills: 15,
        deaths: 10,
        display_before: null,
        display_after: null,
      },
      {
        steam_id: B,
        nick: 'Blue archived',
        team: 2,
        score: 95,
        kills: 21,
        deaths: 9,
        display_before: null,
        display_after: null,
      },
    ],
    rounds: [],
  };
  return { old, archive, final: () => archiveFinal(archive, old, CHECKED) };
}
const card = s => renderSlipgateCard(s, CHECKED).toJSON();
const text = c =>
  [c.title, c.description, c.footer?.text, ...(c.fields || []).flatMap(f => [f.name, f.value])]
    .filter(Boolean)
    .join('\n');
test('final archive retains exact-match live ELO with explicit provenance when archived ratings are absent', () => {
  const f = fixture(),
    result = f.final();
  assert.equal(result.players[0].rating.display, 1800);
  assert.equal(result.players[0].rating.source, 'match_cache');
  assert.equal(result.players[0].rating.provisional, true);
  assert.equal(result.players[0].rating.delta, undefined);
  assert.equal(result.map, 'cannedheat');
  assert.equal(result.finalConfirmed, true);
  assert.equal(result.finalRated, false);
  assert.equal(result.finalCheckedAt, CHECKED);
});
test('archived after ELO wins; verified before/after changes preserve positive, zero and negative values', () => {
  const f = fixture();
  Object.assign(f.archive.players[0], {
    display_before: 1790,
    display_after: 1802,
    display_delta: 999,
  });
  Object.assign(f.archive.players[1], { display_before: 1900, display_after: 1892 });
  let result = f.final();
  assert.deepEqual(
    result.players.map(p => [p.rating.display, p.rating.source, p.rating.delta]),
    [
      [1802, 'archive_after', 12],
      [1892, 'archive_after', -8],
    ]
  );
  Object.assign(f.archive.players[0], { display_before: 0, display_after: 0 });
  result = f.final();
  assert.equal(result.players[0].rating.display, 0);
  assert.equal(result.players[0].rating.delta, 0);
});
test('archive-before fallback is explicitly pre-match and cannot invent a rating change', () => {
  const f = fixture();
  f.archive.players[0].display_before = 0;
  const r = f.final().players[0].rating;
  assert.equal(r.display, 0);
  assert.equal(r.source, 'archive_before');
  assert.equal(r.delta, undefined);
  assert.match(text(card(f.final())), /pre-match ELO/);
});
test('cached ELO never crosses unknown or different ladder, player identity or duplicate identity', () => {
  const f = fixture();
  f.old.ratingSet = null;
  assert.equal(f.final().players[0].rating, undefined);
  f.old.ratingSet = 'A';
  assert.equal(f.final(), null);
  f.old.ratingSet = 'B';
  f.archive.players[0].steam_id = '76561198000000003';
  f.archive.players[0].nick = 'Red live';
  assert.equal(f.final().players[0].rating, undefined);
  f.archive.players[0].steam_id = A;
  f.old.players.push({ ...f.old.players[0], rating: { display: 999 } });
  assert.equal(f.final().players[0].rating, undefined);
});
test('private players never acquire archived identities, ratings or spotlight labels', () => {
  const f = fixture();
  f.old.players[0] = { ...f.old.players[0], private: true, name: 'PRIVATE-SECRET', steamId: null };
  const result = f.final(),
    rendered = text(card(result));
  assert.ok(result.players.some(p => p.private && p.name === 'Anonymous' && !p.rating));
  assert.doesNotMatch(rendered, /PRIVATE-SECRET|Red archived|1800/);
});
test('confirmed result has distinct final title, winner, scoreline, duration, end time and reported-score highlight', () => {
  const f = fixture(),
    c = card(f.final()),
    visible = text(c);
  assert.match(c.title, /🏁.*FINAL.*RESULTS/);
  assert.equal(c.color, 0xf1c40f);
  assert.match(c.description, /\*\*FINAL\*\*/);
  assert.match(c.description, /Blue wins/);
  assert.match(c.description, /Red \*\*4\*\*.*\*\*10\*\* Blue/);
  assert.match(visible, /Duration.*10:42/);
  assert.match(visible, /Ended.*05:09.*UTC/);
  assert.match(visible, /Highest reported score.*Blue archived.*95/);
  assert.match(visible, /Unrated match/);
  assert.match(visible, /ELO/);
  assert.match(visible, /1800/);
  assert.match(visible, /1900/);
  assert.match(visible, /last-observed match ELO/);
  assert.doesNotMatch(visible, /live win chance|alive|dead|🟢|💀/i);
  assert.ok(c.fields.every(x => x.inline === false));
});
test('verified rating changes are shown only for archive after/before pairs', () => {
  const f = fixture();
  Object.assign(f.archive.players[0], { display_before: 1800, display_after: 1812 });
  const c = card(f.final());
  assert.match(text(c), /Δ/);
  assert.match(text(c), /\+12/);
  const blue = c.fields.find(x => x.name.includes('Blue')).value;
  assert.doesNotMatch(blue, /\+100|\+0/);
});
test('pending results never assert a winner, verified delta, or confirmed final scores', () => {
  const f = fixture();
  const s = {
    ...f.old,
    state: 'final',
    finalNotice: 'Final result pending · last observed statistics, not confirmed final scores',
  };
  const c = card(s);
  assert.notEqual(c.color, 0xf1c40f);
  assert.match(text(c), /last observed statistics/);
  assert.doesNotMatch(text(c), /Blue wins|Red wins|Highest reported score|Δ verified/);
});
test('aborted results declare no winner; completed tied and unavailable scores remain honest', () => {
  const f = fixture();
  f.archive.aborted = true;
  assert.match(text(card(f.final())), /Aborted/);
  assert.doesNotMatch(text(card(f.final())), /Blue wins|Red wins/);
  f.archive.aborted = false;
  f.archive.team_red_score = 10;
  assert.match(text(card(f.final())), /Draw/);
  f.archive.team_red_score = null;
  assert.doesNotMatch(text(card(f.final())), /Blue wins|Red wins|Draw/);
});
test('final confirmation footer uses the archive check time, not an earlier live-fetch time', () => {
  const f = fixture(),
    c = card(f.final());
  assert.match(c.footer.text, /confirmed 05:10 UTC/);
  assert.doesNotMatch(c.footer.text, /fetched 05:08/);
});
test('missing ELO is explained once without invented values or duplicate player queries', () => {
  const f = fixture();
  f.old.players.forEach(p => delete p.rating);
  const c = card(f.final());
  assert.match(c.description, /ELO not reported/);
  assert.ok(c.fields.filter(x => /Red|Blue/.test(x.name)).every(x => !x.value.includes('ELO')));
});
test('final embed respects Discord limits for hostile Unicode and large rosters', () => {
  const f = fixture();
  f.archive.players = Array.from({ length: 128 }, (_, i) => ({
    nick: '@everyone```👩‍💻'.repeat(80),
    team: (i % 2) + 1,
    score: i,
    kills: i,
    deaths: 0,
    display_after: 1800,
    display_before: 1790,
  }));
  const c = card(f.final()),
    visible = text(c);
  assert.ok(c.title.length <= 256);
  assert.ok(c.description.length <= 4096);
  assert.ok(c.fields.every(f => f.name.length <= 256 && f.value.length <= 1024));
  assert.ok(
    c.title.length +
      c.description.length +
      c.footer.text.length +
      c.fields.reduce((n, f) => n + f.name.length + f.value.length, 0) <=
      6000
  );
  assert.doesNotMatch(visible, /@everyone/);
});
