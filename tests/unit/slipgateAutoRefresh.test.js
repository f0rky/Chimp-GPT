'use strict';
const embedText = require('../helpers/embedText');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionsBitField } = require('discord.js');
const { createSlipgateClient, budgetPolicy } = require('../../src/services/slipgateClient');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
const { createCommand } = require('../../src/commands/modules/quakestats');
const { renderSlipgateCard } = require('../../src/handlers/slipgateCardRenderer');
const { timers, deferred, turn, snapshot } = require('../helpers/slipgateFixtures');
const ids = ['76561198000000001', '76561198000000002'];
const experimental = {
  SLIPGATE_API_KEY: 'fixture-only',
  SLIPGATE_EXPERIMENTAL_POLLING: 'true',
  SLIPGATE_EXPERIMENTAL_REQUESTS_PER_MINUTE: '6',
};
const body = (steam_ids = ids, rating_set = 'B') => ({ steam_ids, game_type: 'ca', rating_set });
const ratings = (b, display = 0) => ({
  data: {
    ok: true,
    game_type: b.game_type,
    rating_set: b.rating_set,
    players: b.steam_ids.map(steam_id => ({
      steam_id,
      found: true,
      display,
      provisional: true,
      ordinal: 999,
    })),
  },
});
function setup(overrides = {}) {
  let time = 0;
  const calls = [];
  const raw = {
    ok: true,
    addr: 'oce:27960',
    info: { standard_factory: false },
    live: {
      state: 'live',
      game_type: 'ca',
      round: 1,
      players: [
        { steam_id: ids[0], name: 'Public', team: 1 },
        { steam_id: ids[1], private: true, name: 'Secret', team: 2 },
        { steam_id: '76561198000000003', name: 'Watcher', team: 3 },
      ],
    },
  };
  const client = createSlipgateClient({
    env: experimental,
    now: () => time,
    sleep: async ms => {
      time += ms;
    },
    httpGet: async (url, options) => {
      calls.push({ method: 'GET', url, options, time });
      return { data: raw };
    },
    httpPost: async (url, b, options) => {
      calls.push({ method: 'POST', url, b, options, time });
      return ratings(b);
    },
    ...overrides,
  });
  return {
    client,
    raw,
    calls,
    setTime: value => {
      time = value;
    },
  };
}
test('experimental opt-in requires key and strict cap <=6; provider quota remains unknown', () => {
  const p = budgetPolicy(experimental);
  assert.equal(p.enabled, true);
  assert.equal(p.providerQuotaConfirmed, false);
  assert.equal(p.experimental, true);
  assert.equal(p.minIntervalMs, 10000);
  for (const cap of ['', '0', '-1', '7', 'Infinity', '1.5', '9007199254740992'])
    assert.equal(
      budgetPolicy({ ...experimental, SLIPGATE_EXPERIMENTAL_REQUESTS_PER_MINUTE: cap }).enabled,
      false
    );
  assert.equal(budgetPolicy({ ...experimental, SLIPGATE_API_KEY: '' }).enabled, false);
  assert.equal(
    budgetPolicy({ ...experimental, SLIPGATE_EXPERIMENTAL_POLLING: 'false' }).enabled,
    false
  );
});
test('read-only bulk POST authenticates, canonicalizes singleflight and shares GET pacing', async () => {
  const f = setup();
  await f.client.request('/servers/oce:27960');
  const [a, b] = await Promise.all([
    f.client.request('/ratings/bulk', { method: 'POST', body: body([ids[1], ids[0], ids[1]]) }),
    f.client.request('/ratings/bulk', { method: 'POST', body: body() }),
  ]);
  assert.deepEqual(a, b);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].time - f.calls[0].time, 10000);
  assert.deepEqual(f.calls[1].b, body());
  assert.equal(f.calls[1].url, 'https://slipgate.gg/api/v1/ratings/bulk');
  assert.equal(f.calls[1].options.headers.Authorization, 'Bearer fixture-only');
  assert.equal(f.calls[1].options.maxRedirects, 0);
  assert.equal(f.calls[1].options.timeout, 2500);
  assert.equal(f.calls[1].options.maxContentLength, 1048576);
  await f.client.request('/ratings/bulk', { method: 'POST', body: body() });
  assert.equal(f.calls.length, 2);
});
test('bulk rejects arbitrary methods, paths, query and malformed body before HTTP', async () => {
  const f = setup();
  for (const [path, options] of [
    ['/ratings/bulk', {}],
    ['/ratings/bulk?x=1', { method: 'POST', body: body() }],
    ['/servers', { method: 'POST', body: body() }],
    ['/ratings/bulk', { method: 'PUT', body: body() }],
    ...[
      {},
      body([]),
      body([123]),
      body(['bad']),
      body(Array.from({ length: 65 }, (_, i) => String(76561198000000000n + BigInt(i)))),
      { ...body(), game_type: 'evil' },
      { ...body(), rating_set: 'ca' },
      { ...body(), include_rank: true },
    ].map(b => ['/ratings/bulk', { method: 'POST', body: b }]),
    ['/ratings/bulk', { method: 'POST', body: body(), params: { include_rank: true } }],
    ['/servers', { method: 'DELETE' }],
    ['/servers', { body: {} }],
  ])
    await assert.rejects(f.client.request(path, options), /Invalid/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(
    setup({ env: {} }).client.request('/ratings/bulk', { method: 'POST', body: body() }),
    /authentication/i
  );
});
test('actual server snapshots enrich public active players only; preserve zero/provisional, cache and resolve both ladders', async () => {
  const f = setup();
  let s = await f.client.getServer('oce:27960');
  assert.equal(s.gameType, 'ca');
  assert.equal(s.ratingSet, 'B');
  assert.equal(s.players[0].steamId, ids[0]);
  assert.deepEqual(s.players[0].rating, { display: 0, provisional: true });
  assert.equal(s.players[1].steamId, null);
  assert.equal(s.players[1].name, 'Anonymous');
  assert.equal(s.players[1].rating, undefined);
  assert.deepEqual(f.calls[1].b.steam_ids, [ids[0]]);
  assert.doesNotMatch(JSON.stringify(f.calls[1]), /76561198000000002|76561198000000003|Secret/);
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  f.raw.live.players.push({ steam_id: '76561198000000004', name: 'New', team: 2 });
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.deepEqual(f.calls.at(-1).b.steam_ids, ['76561198000000004']);
  f.raw.info.standard_factory = true;
  s = await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(s.ratingSet, 'A');
  assert.equal(f.calls.at(-1).b.rating_set, 'A');
  f.setTime(1000000);
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.notEqual(f.calls.at(-1).method, 'POST');
  const card = renderSlipgateCard(s).toJSON();
  assert.match(embedText(card), /ELO|Elo/);
  assert.match(embedText(card), /0\*/);
  assert.match(embedText(card), /CA.*A/);
  assert.doesNotMatch(JSON.stringify(card), /7656119|999|Secret/);
});
test('unknown ladder/no IDs/private/spectators/unsupported mode cause no POST, valid explicit ladder wins', async () => {
  for (const mutate of [
    r => {
      delete r.info.standard_factory;
    },
    r => {
      r.info.standard_factory = 'false';
    },
    r => {
      r.live.game_type = 'unknown';
    },
    r => {
      r.live.players = r.live.players.slice(1);
    },
    r => {
      r.live.players[0].steam_id = 76561198000000000;
    },
  ]) {
    const f = setup();
    mutate(f.raw);
    const s = await f.client.getServer('oce:27960');
    assert.equal(f.calls.length, 1);
    assert.equal(
      s.players.some(p => p.rating),
      false
    );
  }
  const f = setup();
  f.raw.live.rating_set = 'A';
  assert.equal((await f.client.getServer('oce:27960')).ratingSet, 'A');
  assert.equal(f.calls.at(-1).b.rating_set, 'A');
});
test('mismatched/malformed bulk response never supplies ratings; failures leave healthy scoreboard intact', async () => {
  for (const change of [
    d => {
      d.game_type = 'duel';
    },
    d => {
      d.rating_set = 'A';
    },
    d => {
      d.players = [];
    },
    d => {
      d.players[0].display = '2600';
    },
    d => {
      d.players[0].found = 'true';
    },
    d => {
      d.players.push(d.players[0]);
    },
  ]) {
    const f = setup({
      httpPost: async (_url, b) => {
        const r = ratings(b);
        change(r.data);
        return r;
      },
    });
    const s = await f.client.getServer('oce:27960');
    assert.equal(s.stale, false);
    assert.equal(s.players[0].rating, undefined);
  }
});
test('found false is cached, extra IDs ignored, missing display never uses ordinal', async () => {
  for (const player of [{ found: false }, { found: true, ordinal: 3000 }]) {
    let posts = 0;
    const f = setup({
      httpPost: async (_url, b) => {
        posts++;
        return {
          data: {
            ok: true,
            game_type: 'ca',
            rating_set: 'B',
            players: [
              { steam_id: ids[0], ...player },
              { steam_id: ids[1], found: true, display: 9999 },
            ],
          },
        };
      },
    });
    assert.equal((await f.client.getServer('oce:27960')).players[0].rating, undefined);
    await f.client.getServer('oce:27960', { forceRefresh: true });
    assert.equal(posts, 1);
  }
});
test('auth failures negatively cool down ratings without disabling GET scoreboard or retrying POST', async () => {
  let posts = 0;
  const f = setup({
    httpPost: async () => {
      posts++;
      throw Object.assign(Error('secret'), { response: { status: 401 } });
    },
  });
  await f.client.getServer('oce:27960');
  const s = await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(posts, 1);
  assert.equal(s.stale, false);
  assert.equal(s.players[0].rating, undefined);
});
test('old enrichment cannot attach after mode, ladder, roster or privacy changes during await', async () => {
  for (const change of [
    s => {
      s.gameType = 'duel';
    },
    s => {
      s.ratingSet = 'A';
    },
    s => {
      s.players[0].steamId = ids[1];
    },
    s => {
      s.players[0].private = true;
    },
  ]) {
    const held = deferred();
    const f = setup({
      httpPost: async (_url, b) => {
        await held.promise;
        return ratings(b);
      },
    });
    const s = {
      ...snapshot(),
      gameType: 'ca',
      ratingSet: 'B',
      players: [{ steamId: ids[0], team: 1, private: false }],
    };
    const work = f.client.enrichRatings(s);
    await turn();
    change(s);
    held.resolve();
    const result = await work;
    assert.equal(result.players[0].rating, undefined);
  }
});
test('ordinary duplicate concurrency starts one pending loop, zero duplicate lookups, models or cards; existing link and changed filter remain stable', async () => {
  const clock = timers(),
    held = deferred();
  let lookups = 0,
    models = 0;
  const sent = [],
    replies = [];
  const client = {
    pollingPolicy: () => ({ enabled: true, experimental: true, minIntervalMs: 10000 }),
    selectServer: async () => {
      lookups++;
      return held.promise;
    },
    getServer: async () => snapshot(),
  };
  const channel = {
    send: async p => {
      sent.push(p);
      return { url: 'https://discord.com/channels/g/c/m', edit: async () => {} };
    },
  };
  const manager = createWatchManager({ ...clock, tracker: { observe: async s => s } });
  const command = createCommand({
    rateLimit: async () => ({ limited: false }),
    client,
    manager,
    analysis: async () => {
      models++;
    },
  });
  const message = {
    guild: {},
    guildId: 'g',
    channelId: 'c',
    channel,
    member: { permissions: new PermissionsBitField(PermissionsBitField.Flags.ManageChannels) },
    reply: async p => {
      replies.push(p);
    },
  };
  await Promise.all([command.execute(message, []), command.execute(message, [])]);
  assert.equal(clock.queue.length, 1);
  assert.match(replies[1], /already polling/i);
  assert.equal(lookups, 0);
  const tick = clock.tick();
  await turn();
  await command.execute(message, ['different']);
  assert.equal(lookups, 1);
  assert.equal(clock.queue.length, 0);
  held.resolve(snapshot());
  await tick;
  await command.execute(message, []);
  assert.match(replies.at(-1), /https:\/\/discord.com\/channels\/g\/c\/m/);
  assert.equal(sent.length, 1);
  assert.equal(models, 0);
  assert.equal(manager.start('another', { channel, client }).ok, false);
  await command.execute(message, ['stop']);
  assert.equal(clock.queue.length, 0);
});
test('implicit watch permissions and DM gate precede lookup; disabled mode truthfully snapshots', async () => {
  let calls = 0;
  const replies = [],
    clock = timers();
  const client = {
    pollingPolicy: () => ({ enabled: true }),
    selectServer: async () => {
      calls++;
      return snapshot();
    },
  };
  const manager = createWatchManager({ ...clock });
  const command = createCommand({
    rateLimit: async () => ({ limited: false }),
    client,
    manager,
    tracker: { observe: async s => s },
    analysis: async () => 'Live score',
  });
  const m = {
    guild: {},
    guildId: 'g',
    channelId: 'c',
    channel: { send: async () => {} },
    member: { permissions: new PermissionsBitField() },
    reply: async p => {
      replies.push(p);
    },
  };
  await command.execute(m);
  assert.match(replies.at(-1), /permission is required/);
  await command.execute({ ...m, guild: null });
  assert.equal(calls, 0);
  client.pollingPolicy = () => ({ enabled: false, reason: 'Polling disabled: quota unknown' });
  await command.execute(m);
  assert.match(replies.at(-1).content, /Snapshot.*disabled/i);
  assert.equal(clock.queue.length, 0);
  assert.equal(calls, 1);
});
test('429 pauses same card beyond three generic failures with exact remaining cooldown and recovers', async () => {
  const clock = timers(),
    sent = [],
    edits = [];
  let limited = false;
  const client = {
    pollingPolicy: () => ({
      enabled: true,
      minIntervalMs: 10000,
      cooldownMs: limited ? 900000 : 0,
    }),
    selectServer: async () => snapshot(),
    getServer: async () => {
      if (limited)
        throw Object.assign(Error('rate limited'), { status: 429, retryAfterMs: 900000 });
      return { ...snapshot(), scoreRed: 4 };
    },
  };
  const manager = createWatchManager({ ...clock, tracker: { observe: async s => s } });
  const channel = {
    send: async p => {
      sent.push(p);
      return {
        edit: async p => {
          edits.push(p);
        },
      };
    },
  };
  manager.start('one', { channel, client });
  await clock.tick();
  limited = true;
  for (let i = 0; i < 4; i++) {
    await clock.tick();
    assert.equal(clock.queue[0].ms, 900000);
  }
  assert.equal(manager._watches.size, 1);
  assert.match(edits.at(-1).content, /paus|backoff/i);
  limited = false;
  await clock.tick();
  assert.equal(sent.length, 1);
  assert.match(edits.at(-1).content, /refresh/i);
  await manager.stopAll();
});

test('private IDs and names are removed from the raw GET cache, and ratings never enter analysis facts', async () => {
  const f = setup();
  const raw = await f.client.request('/servers/oce:27960');
  assert.doesNotMatch(JSON.stringify(raw), /76561198000000002|Secret/);
  await f.client.request('/servers/oce:27960');
  assert.equal(f.calls.length, 1);
  const { analyze, _cache } = require('../../src/services/quakeMatchAnalysis');
  _cache.clear();
  const s = await f.client.getServer('oce:27960');
  let models = 0;
  s.scoreRed = 1;
  s.scoreBlue = 2;
  s.players[1].alive = false;
  s.players[0].alive = true;
  await analyze(s, {
    provider: async request => {
      models++;
      assert.doesNotMatch(JSON.stringify(request), /7656119|Secret|Public|display|provisional/);
      return { focus: 'alive' };
    },
  });
  assert.equal(models, 1);
});

test('queued distinct rating batches recheck authentication cooldown after a 403, with no replay', async () => {
  let posts = 0;
  const f = setup({
    httpPost: async () => {
      posts++;
      throw Object.assign(Error('private failure'), { response: { status: 403 } });
    },
  });
  const results = await Promise.allSettled(
    ids.map(id => f.client.request('/ratings/bulk', { method: 'POST', body: body([id]) }))
  );
  assert.equal(results.filter(r => r.status === 'rejected').length, 2);
  assert.equal(posts, 1);
  await f.client.getServer('oce:27960');
  assert.equal(posts, 1);
});

test('GET and POST force refresh share the experimental rolling cap; POST 429 blocks GET until exact HTTP-date recovery', async () => {
  const f = setup();
  for (let i = 0; i < 8; i++) {
    if (i % 2)
      await f.client.request('/ratings/bulk', { method: 'POST', body: body(), noCache: true });
    else await f.client.request('/servers', { noCache: true });
  }
  for (let i = 1; i < f.calls.length; i++)
    assert.ok(f.calls[i].time - f.calls[i - 1].time >= 10000);
  for (const call of f.calls)
    assert.ok(f.calls.filter(c => c.time > call.time - 60000 && c.time <= call.time).length <= 6);
  let time = Date.parse('2026-01-01T00:00:00Z'),
    posts = 0,
    gets = 0;
  let limited = true;
  const client = createSlipgateClient({
    env: experimental,
    now: () => time,
    sleep: async ms => {
      time += ms;
    },
    httpPost: async (_url, b) => {
      posts++;
      if (limited)
        throw Object.assign(Error('quota'), {
          response: { status: 429, headers: { 'retry-after': 'Thu, 01 Jan 2026 00:15:00 GMT' } },
        });
      return ratings(b);
    },
    httpGet: async () => {
      gets++;
      return { data: {} };
    },
  });
  await assert.rejects(
    client.request('/ratings/bulk', { method: 'POST', body: body() }),
    e => e.retryAfterMs === 900000
  );
  await assert.rejects(
    client.request('/servers'),
    e => e.status === 429 && e.retryAfterMs === 900000
  );
  assert.equal(posts, 1);
  assert.equal(gets, 0);
  time += 900000;
  limited = false;
  await client.request('/servers');
  assert.equal(gets, 1);
  assert.equal(posts, 1);
});

test('one experimental watch is process-wide across managers and blocks confirmed additions until stopped', async () => {
  const a = createWatchManager({ ...timers() }),
    b = createWatchManager({ ...timers() });
  const channel = { send: async () => ({}) };
  const client = {
    pollingPolicy: () => ({ enabled: true, experimental: true, minIntervalMs: 10000 }),
  };
  try {
    assert.equal(a.start('a', { channel, client }).ok, true);
    assert.equal(b.start('b', { channel, client }).ok, false);
    assert.equal(
      b.start('b', { channel, client: { pollingPolicy: () => ({ enabled: true }) } }).ok,
      false
    );
    await a.stopAll();
    assert.equal(b.start('b', { channel, client }).ok, true);
  } finally {
    await a.stopAll();
    await b.stopAll();
  }
});

test('an uncertain initial Discord POST is never replayed; stop during rate-pause edit awaits the write', async () => {
  const clock = timers();
  let sends = 0;
  const client = { pollingPolicy: () => ({ enabled: true }), selectServer: async () => snapshot() };
  const manager = createWatchManager({ ...clock, tracker: { observe: async s => s } });
  manager.start('uncertain', {
    client,
    channel: {
      send: async () => {
        sends++;
        throw Error('uncertain transport');
      },
    },
  });
  await clock.tick();
  assert.equal(sends, 1);
  assert.equal(clock.queue.length, 0);
  assert.equal(manager.status('uncertain'), null);
  const held = deferred();
  let paused = false;
  client.getServer = async () => {
    throw Object.assign(Error('rate limit'), { status: 429, retryAfterMs: 900000 });
  };
  manager.start('pause', {
    client,
    channel: {
      send: async () => ({
        edit: async () => {
          paused = true;
          await held.promise;
        },
      }),
    },
  });
  await clock.tick();
  const tick = clock.tick();
  await turn();
  assert.equal(paused, true);
  let stopped = false;
  const stopping = manager.stop('pause').then(() => {
    stopped = true;
  });
  await turn();
  assert.equal(stopped, false);
  held.resolve();
  await Promise.all([stopping, tick]);
  assert.equal(clock.queue.length, 0);
});

test('optional ratings 429 after base publication visibly pauses and later recovers on the same card', async t => {
  const clock = timers(),
    sent = [],
    edits = [];
  let time = 0,
    posts = 0,
    limited = true;
  const raw = setup().raw;
  const client = createSlipgateClient({
    env: experimental,
    now: () => time,
    sleep: async ms => {
      time += ms;
    },
    httpGet: async url => (url.endsWith('/matches') ? { data: { matches: [] } } : { data: raw }),
    httpPost: async (_url, b) => {
      posts++;
      if (limited)
        throw Object.assign(Error('quota'), {
          response: { status: 429, headers: { 'retry-after': '900' } },
        });
      return ratings(b, 2600);
    },
  });
  const manager = createWatchManager({ ...clock, tracker: { observe: async s => s } });
  t.after(() => manager.stopAll());
  manager.start('rating-pause', {
    client,
    filter: raw.addr,
    channel: {
      send: async p => {
        sent.push(p);
        return {
          edit: async v => {
            edits.push(v);
          },
        };
      },
    },
  });
  await clock.tick();
  assert.equal(sent.length, 1, 'base scoreboard precedes optional ratings');
  await manager._watches.get('rating-pause').maintenance;
  assert.equal(posts, 1);
  assert.equal(sent.length, 1);
  assert.equal(clock.queue[0].ms, 900000);
  assert.match(edits.at(-1).content, /paused.*rate limit/i);
  time += 900000;
  limited = false;
  await clock.tick();
  await manager._watches.get('rating-pause').maintenance;
  assert.equal(sent.length, 1);
  assert.equal(posts, 2);
  await clock.tick();
  assert.match(embedText(edits.at(-1).embeds[0].toJSON()), /2600\*/);
  assert.match(edits.at(-1).content, /Auto-refresh active/);
  await manager.stopAll();
});

test('compact ELO omits absent totals, unresolved ladders, warmup and private values; spectators remain names-only', () => {
  const base = {
    ...snapshot(),
    gameType: 'ca',
    ratingSet: 'B',
    players: [
      {
        name: 'Public',
        team: 1,
        score: 5,
        kills: 2,
        deaths: 1,
        rating: { display: 0, provisional: true },
      },
      { name: 'Secret', private: true, team: 2, rating: { display: 9999 } },
      { name: 'Watcher', team: 3, rating: { display: 8888 } },
    ],
  };
  const card = renderSlipgateCard(base).toJSON();
  assert.match(embedText(card), /CA B/);
  assert.match(embedText(card), /0\*/);
  assert.doesNotMatch(embedText(card), /9999|8888|Secret/);
  assert.match(embedText(card), /Spectators[\s\S]*```\nWatcher\n```/);
  for (const override of [
    { ratingSet: null },
    { gameType: 'duel' },
    { state: 'warmup' },
    { players: base.players.slice(1) },
  ])
    assert.doesNotMatch(renderSlipgateCard({ ...base, ...override }).toJSON().description, /ELO/);
});

test('real implicit command publishes before ratings then feeds cached ELO and successive edits without analysis', async t => {
  const { createRoundTracker } = require('../../src/services/quakeRoundTracker');
  const clock = timers(),
    sent = [],
    edits = [],
    replies = [];
  let time = 0,
    posts = 0,
    models = 0;
  const raw = setup().raw;
  raw.live.score_red = 1;
  const client = createSlipgateClient({
    env: experimental,
    now: () => time,
    sleep: async ms => {
      time += ms;
    },
    httpGet: async url => ({ data: url.endsWith('/matches') ? { matches: [] } : raw }),
    httpPost: async (_url, b) => {
      posts++;
      return ratings(b, 2600);
    },
  });
  const manager = createWatchManager({
    ...clock,
    tracker: createRoundTracker({ now: () => time }),
  });
  t.after(() => manager.stopAll());
  const command = createCommand({
    client,
    manager,
    rateLimit: async () => ({ limited: false }),
    analysis: async () => {
      models++;
    },
  });
  const message = {
    guild: {},
    guildId: 'g',
    channelId: 'c',
    member: { permissions: new PermissionsBitField(PermissionsBitField.Flags.ManageChannels) },
    channel: {
      send: async p => {
        sent.push(p);
        return {
          url: 'https://discord.com/channels/g/c/m',
          edit: async v => {
            edits.push(v);
          },
        };
      },
    },
    reply: async p => {
      replies.push(p);
    },
  };
  await command.execute(message, [raw.addr]);
  assert.equal(posts, 0);
  await clock.tick();
  assert.equal(sent.length, 1);
  assert.doesNotMatch(embedText(sent[0].embeds[0].toJSON()), /2600/);
  await manager._watches.values().next().value.maintenance;
  raw.live.score_red = 2;
  time += 60000;
  await clock.tick();
  assert.equal(sent.length, 1);
  assert.equal(posts, 1);
  assert.equal(models, 0);
  assert.match(embedText(edits.at(-1).embeds[0].toJSON()), /CA B[\s\S]*2600\*/);
  assert.match(embedText(edits.at(-1).embeds[0].toJSON()), /Red \(1\) · 2/);
  await command.execute(message, ['stop']);
  assert.match(edits.at(-1).content, /Auto-refresh stopped/);
  assert.match(replies.at(-1), /Stopped/);
  assert.equal(clock.queue.length, 0);
});

test('long cooldowns cannot overflow Node timers into fast polling; shutdown prevents new subscriptions', async () => {
  const clock = timers();
  let calls = 0;
  const client = {
    pollingPolicy: () => ({ enabled: true }),
    selectServer: async () => {
      calls++;
      throw Object.assign(Error('quota'), { status: 429, retryAfterMs: 2147483647 + 12345 });
    },
  };
  const manager = createWatchManager({ ...clock });
  const channel = { send: async () => assert.fail('No card before lookup') };
  manager.start('long', { channel, client });
  await clock.tick();
  assert.equal(clock.queue[0].ms, 2147483647);
  await clock.tick();
  assert.equal(clock.queue[0].ms, 12345);
  assert.equal(calls, 1);
  await manager.shutdown();
  assert.equal(clock.queue.length, 0);
  assert.equal(manager.start('new', { channel, client }).ok, false);
});

test('a short provider cooldown cannot speed up the last known warmup or empty cadence', async () => {
  for (const [s, expected] of [
    [{ ...snapshot(), state: 'warmup' }, 120000],
    [{ ...snapshot(), players: [] }, 300000],
  ]) {
    const clock = timers();
    const client = {
      pollingPolicy: () => ({ enabled: true }),
      selectServer: async () => s,
      getServer: async () => {
        throw Object.assign(Error('quota'), { status: 429, retryAfterMs: 1000 });
      },
    };
    const manager = createWatchManager({ ...clock, tracker: { observe: async v => v } });
    manager.start('state-floor', {
      client,
      channel: { send: async () => ({ edit: async () => {} }) },
    });
    await clock.tick();
    assert.equal(clock.queue[0].ms, expected);
    await clock.tick();
    assert.equal(clock.queue[0].ms, expected);
    await manager.stopAll();
  }
});

test('ratings persist for a match beyond HTTP TTL, cache misses, and rejoining roster members', async () => {
  const f = setup();
  await f.client.getServer('oce:27960');
  f.setTime(20 * 60 * 1000);
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  f.raw.live.players.push({ steam_id: '76561198000000004', name: 'Joined', team: 2 });
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.deepEqual(f.calls.filter(c => c.method === 'POST').at(-1).b.steam_ids, [
    '76561198000000004',
  ]);
  f.raw.live.players = f.raw.live.players.slice(0, 1);
  await f.client.getServer('oce:27960', { forceRefresh: true });
  f.raw.live.players.push({ steam_id: '76561198000000004', name: 'Joined', team: 2 });
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});

test('new match GUID bypasses bulk response cache even with same body and roster', async () => {
  const f = setup();
  f.raw.live.match_guid = 'first-match';
  await f.client.getServer('oce:27960');
  f.raw.live.match_guid = 'second-match';
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});

test('prediction card shows valid live chance and fair pre-match chance, suppresses invalid, stale, private data', async () => {
  const s = snapshot();
  s.prediction = {
    family: 'team',
    state: 'live',
    game_type: 'ca',
    rating_set: 'B',
    basis: 'set',
    calibrated: true,
    conditioned: true,
    roundlimit: 10,
    prior: { red: 0.497282425, blue: 0.502717575 },
    probs: { red: 0.694257125, blue: 0.305742875 },
    fairness: 0.99456485,
    red: [
      {
        steam_id: ids[0],
        name: 'Public',
        name_plain: 'Public',
        private: false,
        team: 1,
        display: 2000,
        share: null,
      },
    ],
    blue: [
      { steam_id: ids[1], name: 'Secret', private: true, team: 2, display: 2000, share: null },
    ],
  };
  s.gameType = 'ca';
  s.ratingSet = 'B';
  let text = renderSlipgateCard(s).toJSON().description;
  assert.match(text, /Live win chance.*Red 69%.*Blue 31%/);
  assert.match(text, /Pre-match.*Red 50%.*Blue 50%/);
  assert.match(text, /fairness/i);
  assert.doesNotMatch(text, /Secret|7656119|2000/);
  for (const bad of [
    { ...s.prediction, probs: { red: 1.2, blue: -0.2 } },
    { ...s.prediction, probs: { red: 0.4, blue: 0.4 } },
    { ...s.prediction, game_type: 'duel' },
  ])
    assert.doesNotMatch(
      renderSlipgateCard({ ...s, prediction: bad }).toJSON().description,
      /Win chance/
    );
  assert.doesNotMatch(renderSlipgateCard({ ...s, stale: true }).toJSON().description, /Win chance/);
});

test('prediction null ratings and duplicate roster entries are handled without fabricated ratings', async () => {
  const f = setup();
  f.raw.live.prediction = predictionFixture();
  f.raw.live.prediction.red[0].display = null;
  let s = await f.client.getServer('oce:27960', { includePrediction: true });
  assert.equal(s.players[0].rating, undefined);
  f.setTime(1800000);
  await f.client.getServer('oce:27960', { includePrediction: true, forceRefresh: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  f.raw.live.match_guid = 'new-dup-match';
  f.raw.live.state = 'warmup';
  await f.client.getServer('oce:27960', { forceRefresh: true });
  f.raw.live.state = 'live';
  f.raw.live.match_guid = 'another-dup-match';
  f.raw.live.prediction.red = [
    { ...predictionFixture().red[0], display: 9999 },
    { ...predictionFixture().red[0], display: 8888 },
  ];
  s = await f.client.getServer('oce:27960', { includePrediction: true, forceRefresh: true });
  assert.equal(s.players[0].rating.display, 0);
});
test('late old-match bulk results cannot replace new-match rating cache', async () => {
  const old = deferred();
  let calls = 0;
  const f = setup({
    httpPost: async (url, b) => {
      calls++;
      if (calls === 1) return old.promise;
      return ratings(b, 2222);
    },
  });
  f.raw.live.match_guid = 'old-async';
  const first = f.client.getServer('oce:27960');
  await turn();
  f.raw.live.match_guid = 'new-async';
  let s = await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(s.players[0].rating.display, 2222);
  old.resolve(ratings(body([ids[0]]), 1111));
  const obsolete = await first;
  assert.equal(obsolete.players[0].rating, undefined);
  s = await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(s.players[0].rating.display, 2222);
  assert.equal(calls, 2);
});

function predictionFixture() {
  return {
    family: 'team',
    state: 'live',
    game_type: 'ca',
    rating_set: 'B',
    basis: 'set',
    calibrated: true,
    conditioned: true,
    roundlimit: 10,
    prior: { red: 0.5, blue: 0.5 },
    probs: { red: 0.7, blue: 0.3 },
    fairness: 1,
    red: [{ steam_id: ids[0], team: 1, display: 2100, private: false }],
    blue: [],
  };
}
test('matching prediction supplies ratings once per match without redundant bulk; newcomers bulk only', async () => {
  const f = setup();
  f.raw.live.match_guid = 'prediction-match';
  f.raw.live.prediction = predictionFixture();
  let s = await f.client.getServer('oce:27960', { includePrediction: true });
  assert.equal(s.players[0].rating?.display, 2100);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  f.setTime(30 * 60 * 1000);
  f.raw.live.prediction.red[0].display = 2200;
  s = await f.client.getServer('oce:27960', { forceRefresh: true, includePrediction: true });
  assert.equal(s.players[0].rating?.display, 2100);
  f.raw.live.players.push({ steam_id: '76561198000000004', team: 2, name: 'New' });
  await f.client.getServer('oce:27960', { forceRefresh: true, includePrediction: true });
  assert.deepEqual(
    f.calls.filter(c => c.method === 'POST').map(c => c.b.steam_ids),
    [['76561198000000004']]
  );
  f.raw.live.match_guid = 'prediction-next-match';
  s = await f.client.getServer('oce:27960', { forceRefresh: true, includePrediction: true });
  assert.equal(s.players[0].rating?.display, 2200);
});
test('mismatched prediction team membership cannot supply an active player rating', async () => {
  const f = setup();
  f.raw.live.prediction = predictionFixture();
  f.raw.live.prediction.red[0].team = 2;
  const s = await f.client.getServer('oce:27960', { includePrediction: true });
  assert.equal(s.players[0].rating.display, 0);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('observed live-to-warmup resets ratings even when final poll is missed; next GUID promotes warmup cache', async () => {
  const f = setup();
  f.raw.live.match_guid = 'old';
  await f.client.getServer('oce:27960');
  f.raw.live.state = 'warmup';
  f.raw.live.match_guid = null;
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
  f.raw.live.state = 'live';
  f.raw.live.match_guid = 'new';
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});
test('GUID-less map changes reset rating session but stale snapshots do not', async () => {
  const f = setup();
  f.raw.live.map = 'campgrounds';
  await f.client.getServer('oce:27960');
  f.raw.live.map = 'trinity';
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});
test('renderer rejects malformed first-to target even when called directly', () => {
  const s = {
    ...snapshot(),
    gameType: 'ca',
    ratingSet: 'B',
    prediction: { ...predictionFixture(), roundlimit: '@everyone' },
  };
  assert.doesNotMatch(
    renderSlipgateCard(s).toJSON().description,
    /@everyone|Live win chance|first to/
  );
});

test('first live GUID promotes warmup session cache; final-to-warmup invalidates even with no GUID', async () => {
  const f = setup();
  f.raw.live.state = 'warmup';
  await f.client.getServer('oce:27960');
  f.raw.live.state = 'live';
  f.raw.live.match_guid = 'arrived-guid';
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  f.raw.live.state = 'final';
  await f.client.getServer('oce:27960', { forceRefresh: true });
  f.raw.live.match_guid = null;
  f.raw.live.state = 'warmup';
  await f.client.getServer('oce:27960', { forceRefresh: true });
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});

test('final-to-warmup with retained GUID resets once and does not churn on live promotion', async () => {
  const f = setup();
  f.raw.live.match_guid = 'same-guid';
  await f.client.getServer('oce:27960');
  f.raw.live.state = 'final';
  await f.client.getServer('oce:27960', { forceRefresh: true });
  f.raw.live.state = 'warmup';
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
  f.raw.live.state = 'live';
  await f.client.getServer('oce:27960', { forceRefresh: true });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});
