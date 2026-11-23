'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Handler = require('../../src/core/eventHandlers/interactionEventHandler');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
const { snapshot, deferred, timers, turn } = require('../helpers/slipgateFixtures');

test('real interaction handler wires button plus reaction add/remove to same bound refresh seam', async () => {
  const client = new EventEmitter();
  client.user = { id: 'bot' };
  const calls = [];
  const watches = {
    refresh: async (key, id) => {
      calls.push([key, id]);
      return { ok: true };
    },
  };
  const handler = new Handler(
    client,
    { CHANNEL_ID: ['chan'] },
    { watches, blocked: { isUserBlocked: () => false } }
  );
  const message = { id: 'card', channel: { id: 'chan', guildId: 'guild' } };
  await handler.handleInteractionCreate({
    customId: 'quake_refresh:bot%3Aguild%3Achan',
    guildId: 'guild',
    channelId: 'chan',
    channel: { ...message.channel, isDMBased: () => false },
    message,
    user: { id: 'person' },
    isButton: () => true,
    isChatInputCommand: () => false,
    reply: async () => {},
    deferReply: async () => {},
    editReply: async () => {},
  });
  const reaction = { emoji: { name: '🔄' }, message };
  await client.listeners('messageReactionAdd')[0](reaction, { id: 'person', bot: false });
  await client.listeners('messageReactionRemove')[0](reaction, { id: 'person', bot: false });
  assert.deepEqual(calls, [
    ['bot:guild:chan', 'card'],
    ['bot:guild:chan', 'card'],
    ['bot:guild:chan', 'card'],
  ]);
  assert.ok(client.listenerCount('messageReactionAdd') > 0);
  assert.ok(client.listenerCount('messageReactionRemove') > 0);
});

test('reaction add/remove storm on actual manager produces one fetch admission', async () => {
  const client = new EventEmitter();
  client.user = { id: 'bot' };
  const clock = timers();
  const gate = deferred();
  let starts = 0;
  const channel = {
    id: 'chan',
    guildId: 'guild',
    send: async () => ({
      id: 'card',
      react: async () => {},
      edit: async () => {},
      delete: async () => {},
    }),
  };
  const api = {
    pollingPolicy: () => ({ enabled: true, minIntervalMs: 60000 }),
    selectServer: async () => snapshot(),
    getServer: async () => {
      starts++;
      await gate.promise;
      return snapshot();
    },
  };
  const manager = createWatchManager({
    ...clock,
    now: () => 0,
    tracker: { observe: async s => s },
  });
  manager.start('bot:guild:chan', { channel, client: api });
  await clock.tick();
  const handler = new Handler(
    client,
    { CHANNEL_ID: ['chan'] },
    { watches: manager, blocked: { isUserBlocked: () => false } }
  );
  const reaction = { emoji: { name: '🔄' }, message: { id: 'card', channel } };
  const first = handler.handleWatchReaction(reaction, { id: 'human', bot: false });
  await turn();
  const second = handler.handleWatchReaction(reaction, { id: 'human', bot: false });
  assert.equal(starts, 1);
  gate.resolve();
  await Promise.all([first, second]);
  await manager.stopAll();
});

test('blocked, bot, wrong emoji, DM/wrong channel, malformed partial reactions do no provider work', async () => {
  const client = new EventEmitter();
  client.user = { id: 'bot' };
  let calls = 0;
  const handler = new Handler(
    client,
    { CHANNEL_ID: ['chan'] },
    {
      watches: {
        refresh: async () => {
          calls++;
          return { ok: true };
        },
      },
      blocked: { isUserBlocked: id => id === 'blocked' },
    }
  );
  const message = { id: 'card', channel: { id: 'chan', guildId: 'guild' } };
  const reaction = { emoji: { name: '🔄' }, message };
  for (const user of [
    { id: 'bot', bot: true },
    { id: 'blocked', bot: false },
  ])
    await handler.handleWatchReaction(reaction, user);
  await handler.handleWatchReaction({ ...reaction, emoji: { name: '👍' } }, { id: 'person' });
  await handler.handleWatchReaction(
    {
      ...reaction,
      message: {
        ...message,
        partial: true,
        fetch: async () => {
          throw Error('partial unavailable');
        },
      },
    },
    { id: 'person' }
  );
  await handler.handleWatchReaction(
    { ...reaction, message: { ...message, channel: { id: 'wrong', guildId: 'guild' } } },
    { id: 'person' }
  );
  let denied = 0;
  await handler.handleInteractionCreate({
    customId: 'quake_refresh:bot%3Aguild%3Achan',
    guildId: 'guild',
    channelId: 'chan',
    channel: { ...message.channel, isDMBased: () => false },
    message,
    user: { id: 'blocked' },
    isButton: () => true,
    isChatInputCommand: () => false,
    reply: async () => {
      denied++;
    },
    deferReply: async () => {},
    editReply: async () => {},
  });
  assert.equal(denied, 1);
  assert.equal(calls, 0);
});
