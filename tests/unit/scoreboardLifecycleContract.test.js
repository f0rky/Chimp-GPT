'use strict';
const embedText = require('../helpers/embedText');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createScoreboardLifecycle,
  archiveFinal,
} = require('../../src/services/scoreboardLifecycle');
const { snapshot, deferred, turn, timers } = require('../helpers/slipgateFixtures');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
function fixture() {
  let time = 0,
    human = false;
  const cards = [],
    calls = [];
  const channel = {
    messages: { fetch: async () => (human ? [{ id: '999', author: { bot: false } }] : []) },
    send: async payload => {
      calls.push('send');
      const m = {
        id: String(cards.length + 1),
        url: 'card-' + (cards.length + 1),
        payload,
        edit: async p => {
          calls.push('edit-' + m.id);
          m.payload = p;
          return m;
        },
        delete: async () => {
          calls.push('delete-' + m.id);
          m.deleted = true;
        },
      };
      cards.push(m);
      return m;
    },
  };
  const client = {
    getMatch: async id => ({
      ok: true,
      match_guid: id,
      game_type: 'ca',
      rating_set: 'B',
      ended_at: '2026-11-14T10:00:00Z',
      server: { addr: 'oce:27960' },
      team_red_score: 10,
      team_blue_score: 0,
      duration_sec: 300,
      players: [
        {
          steam_id: '76561198000000001',
          nick: 'Old player',
          team: 1,
          kills: 7,
          deaths: 0,
          score: 33,
          display_after: 2100,
        },
      ],
      rounds: [],
    }),
  };
  const lc = createScoreboardLifecycle({
    channel,
    client,
    now: () => time,
    perform: async fn => fn(),
    active: () => true,
  });
  const s = {
    ...snapshot(),
    ratingSet: 'B',
    players: [{ steamId: '76561198000000001', name: 'Old', team: 1, score: 3, private: false }],
  };
  const payload = { content: 'live', embeds: [] };
  return {
    lc,
    s,
    payload,
    cards,
    calls,
    client,
    channel,
    setTime: t => {
      time = t;
    },
    human: v => {
      human = v;
    },
  };
}
test('real watch moves unchanged card only after human chat and retains finals across warmup/new GUID, stop never edits final', async () => {
  const f = fixture(),
    clock = timers();
  let s = f.s;
  f.client.pollingPolicy = () => ({ enabled: true });
  f.client.selectServer = async () => s;
  f.client.getServer = async () => s;
  const manager = createWatchManager({
    ...clock,
    now: () => 0,
    tracker: { observe: async v => v },
  });
  manager.start('lifecycle', { channel: f.channel, client: f.client });
  await clock.tick();
  assert.equal(f.cards.length, 1);
  await clock.tick();
  assert.equal(f.cards.length, 1);
  f.human(true);
  await clock.tick();
  assert.equal(f.cards.length, 2);
  assert.equal(f.cards[0].deleted, true);
  assert.equal(manager.status('lifecycle').url, 'card-2');
  f.human(false);
  s = { ...s, state: 'final' };
  await clock.tick();
  await manager._watches.get('lifecycle').maintenance;
  assert.match(f.cards[1].payload.content, /archived result confirmed/);
  const saved = JSON.stringify(f.cards[1].payload);
  s = { ...s, state: 'warmup', matchGuid: null };
  await clock.tick();
  assert.equal(f.cards.length, 3);
  s = { ...s, state: 'live', matchGuid: 'new-guid' };
  await clock.tick();
  assert.equal(f.cards.length, 3);
  assert.equal(JSON.stringify(f.cards[1].payload), saved);
  assert.equal(f.cards[1].deleted, undefined);
  s = { ...s, state: 'final' };
  await clock.tick();
  await manager._watches.get('lifecycle').maintenance;
  const final = JSON.stringify(f.cards[2].payload);
  await manager.stopAll();
  assert.equal(JSON.stringify(f.cards[2].payload), final);
});
test('stop during final edit waits but does not overwrite retained FINAL, and no late archive request starts', async () => {
  const f = fixture(),
    clock = timers(),
    blocked = deferred();
  let s = f.s,
    archives = 0;
  f.client.pollingPolicy = () => ({ enabled: true });
  f.client.selectServer = async () => s;
  f.client.getServer = async () => s;
  f.client.getMatch = async () => {
    archives++;
    throw Error('should not start after stop');
  };
  const manager = createWatchManager({ ...clock, tracker: { observe: async v => v } });
  manager.start('stop-final', { channel: f.channel, client: f.client });
  await clock.tick();
  const edit = f.cards[0].edit;
  f.cards[0].edit = async p => {
    await blocked.promise;
    return edit(p);
  };
  s = { ...s, state: 'final' };
  const tick = clock.tick();
  await turn();
  let stopped = false;
  const stop = manager.stopAll().then(() => {
    stopped = true;
  });
  await turn();
  assert.equal(stopped, false);
  blocked.resolve();
  await tick;
  await stop;
  assert.match(f.cards[0].payload.content, /FINAL/);
  assert.equal(archives, 0);
  assert.equal(clock.queue.length, 0);
});
test('private archive identities remain anonymous; warmup carrying old GUID promotes without an orphan', async () => {
  const f = fixture();
  f.s.players.push({ name: 'Private', private: true, team: 2 });
  const raw = await f.client.getMatch(f.s.matchGuid);
  raw.players.push({
    steam_id: '76561198000000002',
    nick: 'HIDDEN',
    team: 2,
    kills: 100,
    score: 100,
  });
  const mapped = archiveFinal(raw, f.s);
  assert.doesNotMatch(JSON.stringify(mapped), /HIDDEN|76561198000000002/);
  assert.equal(mapped.players.filter(p => p.private).length, 1);
  await f.lc.prepare(f.s);
  await f.lc.publish(f.payload);
  await f.lc.prepare({ ...f.s, state: 'warmup' });
  await f.lc.publish(f.payload);
  await f.lc.prepare({ ...f.s, state: 'live', matchGuid: 'new' });
  await f.lc.publish(f.payload);
  assert.equal(f.cards.length, 2);
});

test('archive ladder must be valid; known ladder conflicts are rejected, unknown live ladder resolves from exact archive', async () => {
  const f = fixture();
  const raw = await f.client.getMatch(f.s.matchGuid);
  assert.equal(archiveFinal({ ...raw, rating_set: 'A' }, f.s), null);
  assert.equal(archiveFinal({ ...raw, rating_set: null }, f.s), null);
  const unknown = { ...f.s, ratingSet: null };
  assert.equal(archiveFinal({ ...raw, rating_set: null }, unknown), null);
  assert.equal(archiveFinal({ ...raw, rating_set: 'bogus' }, unknown), null);
  assert.equal(archiveFinal(raw, unknown).ratingSet, 'B');
});

test('real watch never replays an uncertain reposition POST during its stop-status handling', async () => {
  const f = fixture(),
    clock = timers();
  f.client.pollingPolicy = () => ({ enabled: true });
  f.client.selectServer = async () => f.s;
  f.client.getServer = async () => f.s;
  const manager = createWatchManager({ ...clock, tracker: { observe: async v => v } });
  manager.start('uncertain-move', { channel: f.channel, client: f.client });
  await clock.tick();
  f.human(true);
  let attempts = 0;
  f.channel.send = async () => {
    attempts++;
    throw Error('response lost');
  };
  await clock.tick();
  assert.equal(attempts, 1);
  assert.equal(f.cards[0].deleted, undefined);
  assert.equal(manager.status('uncertain-move'), null);
  assert.equal(clock.queue.length, 0);
});

test('edits without human chat; sends then deletes only old live card when human chat is below, even unchanged data', async () => {
  const f = fixture();
  await f.lc.prepare(f.s);
  await f.lc.publish(f.payload);
  assert.equal(await f.lc.shouldMove(), false);
  await f.lc.publish(f.payload);
  f.human(true);
  assert.equal(await f.lc.shouldMove(), true);
  await f.lc.publish(f.payload, true);
  assert.deepEqual(f.calls, ['send', 'edit-1', 'send', 'delete-1']);
  assert.equal(f.lc.message.url, 'card-2');
});
test('FINAL uses exact archived old GUID, preserves zeros, remains retained; next warmup and LIVE use a separate card', async () => {
  const f = fixture();
  const ids = [];
  const get = f.client.getMatch;
  f.client.getMatch = async id => {
    ids.push(id);
    return get(id);
  };
  await f.lc.prepare(f.s);
  await f.lc.publish(f.payload);
  await f.lc.prepare({ ...f.s, state: 'final' });
  assert.equal(f.lc.retainedFinal, true);
  assert.deepEqual(ids, ['guid-1']);
  assert.match(embedText(f.cards[0].payload.embeds[0].toJSON()), /FINAL/);
  assert.match(embedText(f.cards[0].payload.embeds[0].toJSON()), /Red.*10/);
  assert.match(embedText(f.cards[0].payload.embeds[0].toJSON()), /Blue.*0/);
  await f.lc.prepare({ ...f.s, state: 'warmup', matchGuid: null });
  await f.lc.publish(f.payload);
  await f.lc.prepare({ ...f.s, matchGuid: 'guid-2' });
  await f.lc.publish(f.payload);
  assert.equal(f.cards.length, 2);
  assert.equal(f.cards[0].deleted, undefined);
  assert.equal(f.lc.message.id, '2');
});
test('missed FINAL/new GUID finalizes previous snapshot, never next roster', async () => {
  const f = fixture();
  await f.lc.prepare(f.s);
  await f.lc.publish(f.payload);
  await f.lc.prepare({ ...f.s, matchGuid: 'next', players: [{ name: 'NEW SECRET', team: 2 }] });
  await f.lc.publish(f.payload);
  const text = embedText(f.cards[0].payload.embeds[0].toJSON());
  assert.match(text, /Old player/);
  assert.doesNotMatch(text, /NEW SECRET/);
  assert.equal(f.cards.length, 2);
});
test('404 delayed publication retries on scheduled processing and never rewrites final as next warmup', async () => {
  const f = fixture();
  const get = f.client.getMatch;
  let n = 0;
  f.client.getMatch = async id => {
    if (++n === 1) throw Object.assign(Error(), { status: 404 });
    return get(id);
  };
  await f.lc.prepare(f.s);
  await f.lc.publish(f.payload);
  await f.lc.prepare({ ...f.s, state: 'warmup', matchGuid: null });
  await f.lc.publish(f.payload);
  assert.match(f.cards[0].payload.content, /awaiting/i);
  assert.equal(n, 1);
  f.setTime(120000);
  await f.lc.prepare({ ...f.s, state: 'warmup', matchGuid: null });
  assert.equal(n, 2);
  assert.match(f.cards[0].payload.content, /confirmed/i);
  assert.equal(f.cards.length, 2);
});
test('wrong identity and unfinished archive rejected; archive adapter uses documented score fields', () => {
  const f = fixture();
  const context = f.s;
  const m = {
    ok: true,
    match_guid: context.matchGuid,
    game_type: 'ca',
    rating_set: 'B',
    ended_at: '2026-11-14T10:00:00Z',
    server: { addr: context.address },
    team_red_score: 0,
    team_blue_score: 10,
    players: [],
    rounds: [],
  };
  assert.equal(archiveFinal(m, context).scoreRed, 0);
  for (const bad of [
    { ...m, match_guid: 'wrong' },
    { ...m, ended_at: null },
    { ...m, server: { addr: 'bad:1' } },
    { ...m, game_type: 'duel' },
  ])
    assert.equal(archiveFinal(bad, context), null);
});
test('uncertain reposition send never deletes existing card; deletion failure adopts new card once', async () => {
  const f = fixture();
  await f.lc.prepare(f.s);
  await f.lc.publish(f.payload);
  const send = f.channel.send;
  f.channel.send = async () => {
    throw Error('uncertain');
  };
  await assert.rejects(f.lc.publish(f.payload, true), e => e.uncertainSend === true);
  assert.equal(f.cards[0].deleted, undefined);
  assert.equal(f.lc.message.id, '1');
  f.channel.send = send;
  f.cards[0].delete = async () => {
    throw Error('denied');
  };
  await f.lc.publish(f.payload, true);
  assert.equal(f.lc.message.id, '2');
  await f.lc.publish(f.payload);
  assert.equal(f.cards.length, 2);
});
test('stale and unknown transitions do not end match; retries are bounded', async () => {
  const f = fixture();
  let n = 0;
  f.client.getMatch = async () => {
    n++;
    throw Error('missing');
  };
  await f.lc.prepare(f.s);
  await f.lc.publish(f.payload);
  await f.lc.prepare({ ...f.s, stale: true, state: 'warmup', matchGuid: null });
  assert.equal(f.lc.retainedFinal, false);
  await f.lc.prepare({ ...f.s, state: 'unknown', matchGuid: 'wrong' });
  assert.equal(f.lc.retainedFinal, false);
  await f.lc.prepare({ ...f.s, state: 'final' });
  for (let i = 1; i < 10; i++) {
    f.setTime(i * 120000);
    await f.lc.prepare({ ...f.s, state: 'final' });
  }
  assert.equal(n, 5);
  assert.equal(f.lc.pendingCount, 0);
  assert.match(f.cards[0].payload.content, /unconfirmed/i);
});
