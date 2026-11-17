'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSlipgateCard } = require('../../src/handlers/slipgateCardRenderer');
const analysis = require('../../src/services/quakeMatchAnalysis');
const { createCommand } = require('../../src/commands/modules/quakestats');
const { snapshot } = require('../helpers/slipgateFixtures');
const embedText = require('../helpers/embedText');
const match = (overrides = {}) => ({
  ...snapshot(),
  scoreRed: 6,
  scoreBlue: 7,
  round: 13,
  elapsedSeconds: 125,
  sourceUpdatedAt: '2026-11-14T00:00:00Z',
  fetchedAt: 1794614400000,
  archiveStatus: 'archive404',
  results: [{ guid: 'hidden-guid', round: 13, authoritative: false }],
  players: [
    { name: 'Low', team: 1, score: 0, kills: 0, deaths: 2, alive: false },
    { name: 'High', team: 1, score: 12, kills: 9, deaths: 0, alive: true },
    { name: 'Blue', team: 2, score: 7, kills: 3, deaths: 1, alive: true },
    { name: 'Watcher', team: 3, score: 99, kills: 99, deaths: 99, alive: true },
  ],
  ...overrides,
});
const card = s => renderSlipgateCard(s, 1794614400000).toJSON();
const renderText = embedText;
const visible = s => JSON.stringify(card(s));

test('Red and Blue use stacked fields separated by VS; prediction stays above and spectators below', () => {
  const c = card(
    match({
      ratingSet: 'A',
      prediction: {
        family: 'team',
        conditioned: true,
        rating_set: 'A',
        state: 'live',
        game_type: 'ca',
        basis: 'set',
        calibrated: true,
        roundlimit: 13,
        probs: { red: 0.6, blue: 0.4 },
        prior: { red: 0.5, blue: 0.5 },
        fairness: 0.9,
      },
    })
  );
  assert.equal(c.fields.length, 4);
  assert.deepEqual(
    c.fields.map(f => f.inline),
    [false, false, false, false]
  );
  assert.match(c.description, /LIVE[\s\S]*Live win chance/);
  assert.match(c.fields[0].name, /🔴 \*\*Red \(2\).*6/);
  assert.match(c.fields[2].name, /🔵 \*\*Blue \(1\).*7/);
  assert.match(c.fields[0].value, /High[\s\S]*Low/);
  assert.match(c.fields[2].value, /Blue/);
  assert.match(c.fields[3].name, /👀 \*\*Spectators/);
  assert.match(c.fields[3].value, /Watcher/);
  assert.equal(c.fields[3].inline, false);
});
const clutter =
  /damage|accuracy|\bdmg\b|ladder|guid-1|hidden-guid|archive404|provisional|winner unknown|quality|connStatus/i;

test('scoreboard uses team/spectator emoji and live-only aligned player status emoji', () => {
  const live = renderText(card(match()));
  assert.match(live, /🔴 \*\*Red/);
  assert.match(live, /🔵 \*\*Blue/);
  assert.match(live, /👀 \*\*Spectators/);
  assert.match(live, /🟢 High/);
  assert.match(live, /💀 Low/);
  assert.match(live, /🟢 alive \/ 💀 dead/);
  const rows = live.split('\n');
  assert.equal(
    rows.find(x => x.startsWith('🟢 High')).indexOf('12') + 2,
    rows.find(x => x.startsWith('💀 Low')).indexOf('0') + 1
  );
  for (const s of [
    match({ state: 'warmup' }),
    match({ state: 'final' }),
    match({ stale: true }),
    match({ state: null }),
  ]) {
    assert.doesNotMatch(renderText(card(s)), /🟢|💀/);
  }
});

test('warmup with carried-over 6–7, round 13 and K/D shows only roster and match not started', async () => {
  const s = match({ state: 'warmup' });
  const output = visible(s);
  assert.match(output, /WARMUP/);
  assert.match(output, /match has not started/i);
  assert.doesNotMatch(output, /K\/D|Round 13|6 – 7|02:05|alive|dead|score/i);
  assert.match(output, /High/);
  assert.match(output, /Red \(2\)/);
  assert.doesNotMatch(output, clutter);
  let calls = 0;
  const text = await analysis.analyze(s, {
    provider: async () => {
      calls++;
      return {};
    },
  });
  assert.match(text, /Warmup — match has not started/);
  assert.match(text, /Red 2, Blue 1/);
  assert.doesNotMatch(text, /6|7|13|lead|winner|trend|focus|tactic/i);
  assert.equal(calls, 0);
});

test('live card has readable map/mode, compact clock, sorted aligned scores and names-only spectators', () => {
  const c = card(match());
  assert.match(c.description, /^\*\*LIVE/);
  assert.match(c.description, /campgrounds · Clan Arena/);
  assert.match(c.description, /Round 13 · 02:05/);
  assert.match(renderText(c), /Red \(2\) · 6/);
  assert.match(renderText(c), /Blue \(1\) · 7/);
  assert.ok(renderText(c).indexOf('Red') < renderText(c).indexOf('Blue'));
  assert.ok(renderText(c).indexOf('High') < renderText(c).indexOf('Low'));
  assert.match(renderText(c), /S\s+K\/D/);
  assert.match(renderText(c), /Low\s+0\s+0\/2/);
  assert.match(renderText(c), /🟢 High/);
  assert.match(renderText(c), /💀 Low/);
  assert.match(renderText(c), /Spectators \(1\)\*\*\n```\nWatcher\n```/);
  assert.doesNotMatch(JSON.stringify(c), clutter);
  for (const block of renderText(c).matchAll(/```\n([\s\S]*?)\n```/g))
    for (const line of block[1].split('\n')) assert.ok([...line].length <= 42, line);
});

test('authoritative zero scores stay live, missing optional fields stay omitted and null differs from zero', () => {
  const s = match({
    scoreRed: 0,
    scoreBlue: null,
    round: null,
    elapsedSeconds: null,
    players: [{ name: 'Zero', team: 1, score: 0, kills: 0, deaths: null }],
  });
  const c = card(s);
  assert.match(c.description, /LIVE/);
  assert.match(renderText(c), /Red \(1\) · 0/);
  assert.doesNotMatch(c.description, /Blue.*· 0|\bRound\b|elapsed|warmup|unavailable/i);
  assert.match(renderText(c), /Zero\s+0\s+0\/—/);
  assert.match(analysis.factual(s), /Red 0/);
  assert.match(analysis.factual(s), /Red 0; Blue score unreported/);
});

for (const state of ['final', 'finished', 'postgame', 'intermission', 'ended'])
  test(`${state} is FINAL with final score and no alive claims or model calls`, async () => {
    const s = match({ state });
    assert.match(visible(s), /FINAL/);
    assert.doesNotMatch(renderText(card(s)), /alive|dead|🟢 High|💀 Low|\+ High|- Low|Round 13/);
    let calls = 0;
    const text = await analysis.analyze(s, {
      provider: async () => {
        calls++;
        return {};
      },
    });
    assert.match(text, /Final — Red 6 – Blue 7/);
    assert.doesNotMatch(text, /alive|focus|next round|advantage/);
    assert.equal(calls, 0);
  });

test('unknown, waiting and stale are honest and cannot trigger paid inference', async () => {
  for (const s of [
    match({ state: null }),
    match({ state: 'mystery' }),
    match({ state: 'waiting' }),
    match({ stale: true, staleReason: 'Slipgate request failed' }),
  ]) {
    const c = card(s);
    assert.match(c.description, /UNKNOWN|WARMUP|STALE/);
    assert.doesNotMatch(renderText(c), /🟢 High|💀 Low|\+ High|- Low/);
    if (s.stale) {
      assert.match(c.footer.text, /Stale snapshot.*refresh unavailable/i);
      assert.match(c.description, /last reported LIVE/i);
    }
    let calls = 0;
    const text = await analysis.analyze(s, {
      provider: async () => {
        calls++;
        return {};
      },
    });
    assert.match(text, /state.*unavailable|Warmup|Stale snapshot/i);
    assert.doesNotMatch(text, /leads|advantage|next round|focus/);
    assert.equal(calls, 0);
  }
});

test('alive markers/counts require live round modes and a reported active round', async () => {
  for (const overrides of [
    { gameType: 'ctf' },
    { gameType: 'tdm' },
    { round: null },
    { round: 0 },
  ]) {
    const s = match(overrides);
    assert.doesNotMatch(renderText(card(s)), /🟢 High|💀 Low|\+ High|- Low|alive/);
    assert.doesNotMatch(await analysis.analyze(s, { env: {} }), /alive/);
  }
  assert.match(analysis.factual(match()), /alive: Red 1\/2, Blue 1\/1/);
});

test('unassigned players keep their reported identity and never become inferred teams or spectators', () => {
  const c = card(
    match({
      scoreRed: null,
      scoreBlue: null,
      players: [
        { name: 'red volunteer', team: 0, score: 0 },
        { name: 'blue visitor', team: null, score: 9 },
      ],
    })
  );
  assert.match(renderText(c), /Unassigned \(2\)/);
  assert.doesNotMatch(renderText(c), /\*\*Red|\*\*Blue|Spectators/);
});

test('private names, Quake colors, bidi controls, fences, markdown and mentions are neutralized', () => {
  const c = card(
    match({
      name: '^1```<@123>\u202e**Arena**',
      map: '^4map\u2066<@everyone>```',
      players: [
        { name: 'SECRET', private: true, team: 3 },
        { name: '^2```\n<@&123>@everyone\u202e[x](url)\\**', team: 1, score: 0 },
      ],
    })
  );
  const text = JSON.stringify(c);
  assert.doesNotMatch(text, /SECRET|\^2|<@|@everyone|[\u202a-\u202e\u2066-\u2069]/);
  assert.match(text, /Anonymous/);
  assert.equal(
    c.fields.reduce((n, f) => n + (f.value.match(/```/g) || []).length, 0),
    6
  );
  assert.doesNotMatch(c.title, /`|\*\*/);
  assert.equal(c.url, 'https://slipgate.gg/servers/oce%3A27960');
});

test('long rosters preserve all population counts and honest omissions within Discord and mobile limits', () => {
  const players = Array.from({ length: 105 }, (_, i) => ({
    name: 'long😀name'.repeat(30),
    team: i % 5,
    score: i,
    kills: 0,
    deaths: 0,
    private: i % 5 === 3,
  }));
  const c = card(match({ name: 'x'.repeat(500), map: 'm'.repeat(500), players }));
  assert.ok(c.title.length <= 256);
  assert.ok(c.description.length <= 4096);
  const length =
    c.title.length +
    c.description.length +
    c.footer.text.length +
    (c.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0);
  assert.ok(length <= 6000);
  for (const team of ['Red', 'Blue', 'Spectators'])
    assert.match(renderText(c), new RegExp(`${team} \\(21\\)`));
  assert.match(renderText(c), /Unassigned \(42\)/);
  for (const block of renderText(c).matchAll(/```\n([\s\S]*?)\n```/g))
    for (const line of block[1].split('\n')) assert.ok([...line].length <= 42, line);
  const shown = [...renderText(c).matchAll(/^.*(?:long|Anonymous).*$/gm)].length;
  const omitted = [...renderText(c).matchAll(/… (\d+) more reported/g)].reduce(
    (n, m) => n + Number(m[1]),
    0
  );
  assert.equal(shown + omitted, players.length);
});

test('real command uses state-aware renderer/analyzer with fake provider and disables mentions', async () => {
  const replies = [];
  let models = 0;
  const s = match({ state: 'warmup' });
  const command = createCommand({
    rateLimit: async () => ({ limited: false }),
    client: { pollingPolicy: () => ({ enabled: false }), selectServer: async () => s },
    tracker: { observe: async v => v },
    analysisOptions: {
      provider: async () => {
        models++;
        return {};
      },
    },
  });
  await command.execute({ guild: { id: 'g' }, reply: async p => replies.push(p) }, []);
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].allowedMentions, { parse: [] });
  assert.match(replies[0].content, /match has not started/);
  assert.match(replies[0].embeds[0].toJSON().description, /WARMUP/);
  assert.equal(models, 0);
});

test('clock and map helpers are pure, bounded and preserve legitimate zero time', () => {
  const { elapsedClock, modeLabel } = require('../../src/services/quakeScoreboardPresentation');
  for (const [input, expected] of [
    [0, '00:00'],
    [9, '00:09'],
    [125.9, '02:05'],
    [3600, '60:00'],
    [null, null],
    ['125', null],
    [-1, null],
    [Infinity, null],
    [NaN, null],
    [1e15, null],
  ])
    assert.equal(elapsedClock(input), expected);
  assert.equal(modeLabel('CTF'), 'Capture the Flag');
  assert.equal(modeLabel('ca'), 'Clan Arena');
  assert.equal(modeLabel('__proto__'), null);
  const s = match({ state: 'warmup' });
  const before = JSON.stringify(s);
  card(s);
  analysis.factual(s);
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.scoreRed, 6);
  assert.equal(s.results[0].authoritative, false);
});

test('live summary gives exact tied/lead observations, final score, and no invented tactical narrative', () => {
  assert.match(analysis.factual(match()), /Live — Red 6 – Blue 7; Blue leads by 1/);
  assert.match(analysis.factual(match({ scoreRed: 0, scoreBlue: 0 })), /Red 0 – Blue 0, tied/);
  assert.match(analysis.factual(match({ scoreRed: 8, scoreBlue: 6 })), /Red leads by 2/);
  assert.match(analysis.factual(match({ state: 'final' })), /^Final — Red 6 – Blue 7\.$/);
  assert.doesNotMatch(
    analysis.factual(match()),
    /matchpoint|probabilit|positions|comms|causes|trend|damage|accuracy|verify|focus|fallback/i
  );
});

test('footer differentiates delayed source from failed or rate-limited refresh without raw internals', () => {
  for (const [reason, expected] of [
    ['Source timestamp is older than two minutes', /source update delayed/],
    ['Slipgate cooldown active', /refresh rate limited/],
    ['Slipgate request failed', /refresh unavailable/],
  ]) {
    const c = card(match({ stale: true, staleReason: reason }));
    assert.match(c.footer.text, expected);
    assert.match(c.footer.text, /source 2026-11-14 00:00 UTC · fetched 00:00 UTC/);
  }
  for (const fetchedAt of [NaN, Infinity, 1e99])
    assert.doesNotThrow(() => card(match({ fetchedAt, sourceUpdatedAt: 'invalid' })));
  assert.ok(card(match({ name: '😀'.repeat(500) })).title.length <= 256);
});

test('stale summary distinguishes delayed updates from refresh outages, including cached transitions', async () => {
  analysis._cache.clear();
  const s = match({ stale: true, staleReason: 'Slipgate request failed' });
  assert.match(await analysis.analyze(s, { env: {} }), /refresh unavailable/i);
  const delayed = { ...s, staleReason: 'Source timestamp is older than two minutes' };
  const result = await analysis.analyze(delayed, { env: {} });
  assert.match(result, /source update delayed/i);
  assert.doesNotMatch(result, /refresh unavailable/i);
});

test('reported phase stays authoritative with limited source detail, and limited detail never triggers a model', async () => {
  for (const state of ['warmup', 'live', 'final']) {
    const s = match({ state, quality: { a2sOnly: true } });
    assert.match(card(s).description, new RegExp(`\\*\\*${state.toUpperCase()}\\*\\*`));
    assert.doesNotMatch(renderText(card(s)), /🟢 High|💀 Low|\+ High|- Low|Round 13|K\/D|02:05/);
    let calls = 0;
    await analysis.analyze(s, {
      provider: async () => {
        calls++;
        return {};
      },
    });
    assert.equal(calls, 0);
  }
});
