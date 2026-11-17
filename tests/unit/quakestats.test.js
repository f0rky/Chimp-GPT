'use strict';
const embedText = require('../helpers/embedText');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionsBitField } = require('discord.js');
const dispatcher = require('../../src/commands/commandHandler');
const { createCommand } = require('../../src/commands/modules/quakestats');
const { createSlipgateClient } = require('../../src/services/slipgateClient');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
const { createRoundTracker } = require('../../src/services/quakeRoundTracker');
const { analyze, _cache } = require('../../src/services/quakeMatchAnalysis');
const { snapshot, quota, timers, deferred, turn } = require('../helpers/slipgateFixtures');
function fixture() {
  let time = 0,
    modelCalls = 0;
  const http = [],
    replies = [],
    sent = [],
    edits = [];
  const clock = timers();
  const s = snapshot();
  s.players.push({ name: 'Blue', team: 2, alive: true });
  const client = createSlipgateClient({
    env: quota,
    now: () => time,
    sleep: async ms => {
      time += ms;
    },
    httpGet: async (url, opts) => {
      http.push([url, opts]);
      if (url.endsWith('/matches')) return { data: { ok: true, matches: [] } };
      if (url.includes('/matches/'))
        throw Object.assign(Error('pending'), { response: { status: 404 } });
      if (url.endsWith('/servers'))
        return {
          data: {
            ok: true,
            servers: [{ addr: s.address, name: 'Arena', region: 'OCE', players: 1 }],
          },
        };
      return {
        data: {
          ok: true,
          addr: s.address,
          name: s.name,
          live: {
            state: s.state,
            map: s.map,
            game_type: s.gameType,
            rating_set: s.ratingSet,
            match_guid: s.matchGuid,
            round: s.round,
            score_red: s.scoreRed,
            score_blue: s.scoreBlue,
            players: s.players.map(p => ({ ...p, damage_dealt: p.damage })),
          },
        },
      };
    },
  });
  const tracker = createRoundTracker({ now: () => time });
  const manager = createWatchManager({ ...clock, tracker });
  const provider = async () => {
    modelCalls++;
    return { focus: 'alive' };
  };
  const command = createCommand({
    client,
    tracker,
    manager,
    analysis: analyze,
    analysisOptions: { provider },
    rateLimit: async userId => ({
      limited: require('../helpers/messageEventHandlerLoader').control.rateLimitedUserIds.has(
        userId
      ),
    }),
  });
  const channel = {
    id: 'c',
    isDMBased: () => false,
    send: async p => {
      if (typeof p === 'string')
        return { id: 'feedback', edit: async () => {}, delete: async () => {} };
      sent.push(p);
      return {
        edit: async v => {
          edits.push(v);
        },
      };
    },
  };
  const bot = {
    user: { id: '123456789012345678' },
    on() {},
    isReady: () => true,
    token: 'fixture',
    rest: {},
  };
  const message = {
    content: '!quakestats',
    guildId: 'g',
    guild: { id: 'g' },
    channelId: 'c',
    channel,
    client: bot,
    author: { id: '222222222222222222', username: 'tester' },
    member: { permissions: new PermissionsBitField() },
    reply: async p => {
      replies.push(p);
    },
    attachments: [],
    react: async () => {},
  };
  return {
    command,
    client,
    manager,
    tracker,
    clock,
    channel,
    message,
    replies,
    sent,
    edits,
    http,
    s,
    bot,
    modelCalls: () => modelCalls,
    time: () => time,
    setTime: t => {
      time = t;
    },
  };
}
test('explicit snapshot prefix dispatch produces scoreboard and assessment; repeated snapshots coalesce HTTP and AI', async () => {
  _cache.clear();
  const f = fixture();
  f.message.content = '!quakestats snapshot';
  dispatcher.registerCommand(f.command);
  const results = await Promise.all([
    dispatcher.handleCommand(f.message, {}),
    dispatcher.handleCommand({ ...f.message }, {}),
  ]);
  assert.deepEqual(results, [true, true]);
  assert.equal(f.replies.length, 2);
  assert.equal(f.modelCalls(), 1);
  assert.equal(f.http.filter(([u]) => u.endsWith('/servers')).length, 1);
  assert.equal(f.http.filter(([u]) => u.includes('/servers/')).length, 1);
  const payload = f.replies[0];
  assert.equal(payload.embeds.length, 1);
  assert.match(payload.content, /Red 0/);
  assert.equal(payload.embeds[0].toJSON().url, 'https://slipgate.gg/servers/oce%3A27960');
  assert.match(payload.embeds[0].toJSON().description, /LIVE/);
  assert.doesNotMatch(
    JSON.stringify(payload.embeds[0].toJSON()),
    /guid-1|damage|ladder|archive404/
  );
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});
test('watch controls require real member permissions or configured owner; no flags on message can grant access', async () => {
  const f = fixture();
  dispatcher.registerCommand(f.command);
  f.message.content = '!quakestats watch';
  f.message.permissions = { has: () => true };
  await dispatcher.handleCommand(f.message, {});
  assert.match(f.replies.at(-1), /permission is required/);
  assert.equal(f.manager._watches.size, 0);
  f.message.member.permissions = new PermissionsBitField(PermissionsBitField.Flags.ManageChannels);
  await dispatcher.handleCommand(f.message, {});
  await dispatcher.handleCommand(f.message, {});
  assert.equal(f.manager._watches.size, 1);
  assert.match(f.replies.at(-1), /already active/);
  await f.clock.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.modelCalls(), 0);
  f.s.scoreRed = 1;
  await f.clock.tick();
  assert.equal(f.edits.length, 1);
  assert.equal(f.modelCalls(), 0);
  f.message.content = '!quakestats stop';
  f.message.member.permissions = new PermissionsBitField();
  await dispatcher.handleCommand(f.message, {});
  assert.equal(f.manager._watches.size, 1);
  await dispatcher.handleCommand(f.message, { OWNER_ID: f.message.author.id });
  assert.equal(f.manager._watches.size, 0);
  assert.match(f.replies.at(-1), /Stopped/);
});
test('actual implicit prefix commands reserve one loop before HTTP and duplicate commands never refresh or analyze', async () => {
  const f = fixture();
  dispatcher.registerCommand(f.command);
  f.message.member.permissions = new PermissionsBitField(PermissionsBitField.Flags.ManageChannels);
  await Promise.all([
    dispatcher.handleCommand(f.message, {}),
    dispatcher.handleCommand({ ...f.message }, {}),
  ]);
  assert.equal(f.clock.queue.length, 1);
  assert.equal(f.http.length, 0);
  assert.equal(f.modelCalls(), 0);
  assert.match(f.replies[1], /already polling/i);
  await f.clock.tick();
  await [...f.manager._watches.values()][0].maintenance;
  const count = f.http.length;
  await dispatcher.handleCommand({ ...f.message, content: '!quakestats other' }, {});
  assert.equal(f.http.length, count);
  assert.equal(f.modelCalls(), 0);
  assert.equal(f.sent.length, 1);
  assert.equal(f.clock.queue.length, 1);
  await f.manager.stopAll();
});
test('stop acknowledgment follows in-flight write completion', async () => {
  const f = fixture();
  f.message.member.permissions = new PermissionsBitField(PermissionsBitField.Flags.ManageGuild);
  const held = deferred();
  let writes = 0;
  f.channel.send = async () => {
    writes++;
    return held.promise;
  };
  await f.command.execute(f.message, ['watch']);
  const tick = f.clock.tick();
  await turn();
  assert.equal(writes, 1);
  const stop = f.command.execute(f.message, ['stop']);
  await turn();
  assert.equal(f.replies.length, 1);
  held.resolve({ edit: async () => {} });
  await Promise.all([stop, tick]);
  assert.equal(f.replies.length, 2);
  assert.match(f.replies[1], /Stopped/);
});
test('watch fails closed with unknown quota, previews still work; disabled AI uses factual fallback', async () => {
  const f = fixture();
  f.client.pollingPolicy = () => ({ enabled: false, reason: 'Polling disabled: quota unknown' });
  f.message.member.permissions = new PermissionsBitField(PermissionsBitField.Flags.ManageGuild);
  await f.command.execute(f.message, ['watch']);
  assert.match(f.replies[0], /disabled/);
  assert.equal(f.clock.queue.length, 0);
  const command = createCommand({
    client: f.client,
    manager: f.manager,
    tracker: f.tracker,
    analysisOptions: { env: {} },
  });
  await command.execute(f.message, []);
  assert.match(f.replies[1].content, /Live — Red 0/);
  assert.doesNotMatch(f.replies[1].content, /fallback|focus|damage|accuracy/i);
  assert.equal(f.modelCalls(), 0);
});
test('mentioned and unmentioned ordinary chat dispatches while watch is on and after stop; policy gates persist', async () => {
  const f = fixture();
  dispatcher.registerCommand(f.command);
  const { loadHandlerModules, control } = require('../helpers/messageEventHandlerLoader');
  const { MessageEventHandler } = loadHandlerModules({ commandHandler: dispatcher });
  const busy = new Set(),
    chat = [];
  const handler = new MessageEventHandler(
    f.bot,
    { IGNORE_MESSAGE_PREFIX: '?' },
    {
      openai: {
        chat: {
          completions: {
            create: async request => {
              chat.push(request);
              return { choices: [{ message: { content: 'fixture reply' } }] };
            },
          },
        },
      },
      allowedChannelIDs: ['c'],
      DISABLE_PLUGINS: true,
      inProgressOperations: busy,
      loadingEmoji: '…',
      statusManager: { trackConversation() {} },
      pfpManager: null,
    }
  );
  // Keep command/watch sends and ordinary chat feedback independently observable.
  const chatMessage = content => ({
    ...f.message,
    content,
    id: content,
    channel: {
      ...f.channel,
      send: async () => ({ id: 'feedback', edit: async () => {}, delete: async () => {} }),
    },
  });
  f.message.member.permissions = new PermissionsBitField(PermissionsBitField.Flags.ManageChannels);
  const watchMessage = { ...f.message, content: '!quakestats' };
  await handler.handleMessageCreate(watchMessage);
  assert.equal(f.manager._watches.size, 1);
  assert.equal(busy.size, 0);
  await f.clock.tick();
  assert.equal(f.sent.length, 1);
  for (const content of ['ordinary hello', '<@123456789012345678> ordinary hello'])
    await handler.handleMessageCreate(chatMessage(content));
  assert.equal(chat.length, 2);
  assert.equal(busy.size, 0);
  await handler.handleMessageCreate({ ...f.message, content: '!quakestats stop' });
  assert.equal(f.manager._watches.size, 0);
  for (const content of ['ordinary after stop', '<@123456789012345678> after stop'])
    await handler.handleMessageCreate(chatMessage(content));
  assert.equal(chat.length, 4);
  assert.equal(busy.size, 0);
  control.blockedUserIds.add(f.message.author.id);
  try {
    await handler.handleMessageCreate(chatMessage('blocked'));
    await handler.handleMessageCreate(watchMessage);
    assert.equal(f.manager._watches.size, 0);
  } finally {
    control.blockedUserIds.delete(f.message.author.id);
  }
  control.rateLimitedUserIds.add(f.message.author.id);
  try {
    await handler.handleMessageCreate(chatMessage('rate limited'));
    await handler.handleMessageCreate(watchMessage);
    assert.equal(f.manager._watches.size, 0);
  } finally {
    control.rateLimitedUserIds.delete(f.message.author.id);
  }
  await handler.handleMessageCreate({ ...chatMessage('wrong channel'), channelId: 'elsewhere' });
  await handler.handleMessageCreate({ ...watchMessage, channelId: 'elsewhere' });
  assert.equal(f.manager._watches.size, 0);
  assert.equal(chat.length, 4);
  assert.equal(f.modelCalls(), 0);
});

test('watch renders warmup to live to final using reported state, without model calls in timers', async () => {
  const f = fixture();
  f.s.state = 'warmup';
  f.s.scoreRed = 6;
  f.s.scoreBlue = 7;
  f.s.round = 13;
  f.s.players[0].kills = 15;
  f.s.players[0].deaths = 7;
  f.message.member.permissions = new PermissionsBitField(PermissionsBitField.Flags.ManageChannels);
  await f.command.execute(f.message, ['watch']);
  await f.clock.tick();
  let c = f.sent[0].embeds[0].toJSON();
  assert.match(embedText(c), /WARMUP/);
  assert.doesNotMatch(embedText(c), /K\/D|Round 13|· 6|· 7|alive/);
  assert.deepEqual(f.sent[0].allowedMentions, { parse: [] });
  f.s.state = 'live';
  await f.clock.tick();
  c = f.edits.at(-1).embeds[0].toJSON();
  assert.match(embedText(c), /LIVE/);
  assert.match(embedText(c), /Red \(1\) · 6/);
  assert.match(embedText(c), /Round 13/);
  assert.match(embedText(c), /15\/7/);
  f.s.state = 'final';
  await f.clock.tick();
  c = f.edits.at(-1).embeds[0].toJSON();
  assert.match(embedText(c), /FINAL/);
  assert.doesNotMatch(embedText(c), /alive|dead|Round 13/);
  assert.equal(f.modelCalls(), 0);
  await f.manager.stopAll();
  assert.equal(f.clock.queue.length, 0);
});
