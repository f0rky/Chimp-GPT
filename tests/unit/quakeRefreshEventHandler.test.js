'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Handler = require('../../src/core/eventHandlers/interactionEventHandler');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
const { snapshot, deferred, timers } = require('../helpers/slipgateFixtures');

function interaction(overrides = {}) {
  return {
    customId: 'quake_refresh:bot%3Aguild%3Achan',
    guildId: 'guild',
    channelId: 'chan',
    channel: { id: 'chan', guildId: 'guild', isDMBased: () => false },
    message: { id: 'card' },
    user: { id: 'person' },
    isButton: () => true,
    isChatInputCommand: () => false,
    reply: async () => {},
    deferUpdate: async () => {},
    followUp: async () => {},
    ...overrides,
  };
}
function setup(watches) {
  const client = new EventEmitter();
  client.user = { id: 'bot' };
  const handler = new Handler(
    client,
    { CHANNEL_ID: ['chan'] },
    {
      watches,
      blocked: { isUserBlocked: id => id === 'blocked' },
    }
  );
  return { client, handler };
}

test('real registered handler uses button-only admission and installs no reaction refresh listeners', async () => {
  const calls = [];
  const { client } = setup({
    enqueueRefresh: (key, id) => {
      calls.push([key, id]);
      return { ok: true, reason: 'Queued.' };
    },
  });
  await client.listeners('interactionCreate')[0](interaction());
  client.emit('messageReactionAdd', { emoji: { name: '🔄' } }, { id: 'person' });
  client.emit('messageReactionRemove', { emoji: { name: '🔄' } }, { id: 'person' });
  assert.deepEqual(calls, [['bot:guild:chan', 'card']]);
  assert.equal(client.listenerCount('messageReactionAdd'), 0);
  assert.equal(client.listenerCount('messageReactionRemove'), 0);
});

test('actual handler plus manager accepts repeated buttons promptly but produces one provider fetch', async t => {
  const clock = timers(),
    provider = deferred();
  let starts = 0;
  const manager = createWatchManager({
    ...clock,
    now: () => 0,
    tracker: { observe: async s => s },
  });
  t.after(() => manager.stopAll());
  manager.start('bot:guild:chan', {
    channel: { send: async () => ({ id: 'card', edit: async () => {} }) },
    client: {
      pollingPolicy: () => ({ enabled: true, minIntervalMs: 60000 }),
      selectServer: async () => snapshot(),
      getServer: async () => {
        starts++;
        return provider.promise;
      },
    },
  });
  await clock.tick();
  const { handler } = setup(manager);
  await Promise.all(
    Array.from({ length: 10 }, () => handler.handleInteractionCreate(interaction()))
  );
  assert.equal(starts, 1);
  provider.resolve(snapshot());
  await manager._watches.get('bot:guild:chan').refreshPromise;
  assert.equal(clock.queue.length, 1);
});

test('blocked, wrong-channel and malformed button identities do no provider work', async () => {
  let calls = 0,
    denied = 0;
  const { handler } = setup({
    enqueueRefresh: () => {
      calls++;
      return { ok: true, reason: 'Queued.' };
    },
  });
  for (const invalid of [
    { user: { id: 'blocked' } },
    { channelId: 'wrong' },
    { guildId: null },
    { customId: 'quake_refresh:%invalid' },
    { customId: 'quake_refresh:other%3Aguild%3Achan' },
  ]) {
    await handler.handleInteractionCreate(
      interaction({
        ...invalid,
        reply: async () => {
          denied++;
        },
      })
    );
  }
  assert.equal(denied, 5);
  assert.equal(calls, 0);
});

test('failed queue acknowledgement never edits the original scoreboard or retries admission', async () => {
  let admits = 0,
    edits = 0;
  const { handler } = setup({
    enqueueRefresh: () => {
      admits++;
      return { ok: true, reason: 'Refresh queued.' };
    },
  });
  await handler.handleInteractionCreate(
    interaction({
      followUp: async () => {
        throw Error('Discord unavailable');
      },
      editReply: async () => {
        edits++;
      },
    })
  );
  assert.equal(admits, 1);
  assert.equal(edits, 0);
});
