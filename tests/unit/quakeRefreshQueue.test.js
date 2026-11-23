'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Handler = require('../../src/core/eventHandlers/interactionEventHandler');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
const { snapshot, deferred, timers, turn } = require('../helpers/slipgateFixtures');

test('button acknowledges without a thinking reply and returns while queued provider work is pending', async () => {
  const client = new EventEmitter();
  client.user = { id: 'bot' };
  const events = [];
  const provider = deferred();
  const handler = new Handler(
    client,
    { CHANNEL_ID: ['chan'] },
    {
      blocked: { isUserBlocked: () => false },
      watches: {
        enqueueRefresh: (key, id) => {
          assert.equal(key, 'bot:guild:chan');
          assert.equal(id, 'card');
          events.push('queue');
          return { ok: true, queued: true, reason: 'Refresh queued.', promise: provider.promise };
        },
      },
    }
  );
  const interaction = {
    customId: 'quake_refresh:bot%3Aguild%3Achan',
    guildId: 'guild',
    channelId: 'chan',
    channel: { id: 'chan', guildId: 'guild', isDMBased: () => false },
    message: { id: 'card' },
    user: { id: 'person' },
    isButton: () => true,
    isChatInputCommand: () => false,
    deferUpdate: async () => events.push('ack'),
    deferReply: async () => events.push('thinking'),
    editReply: async () => events.push('edit-reply'),
    followUp: async payload => {
      assert.equal(payload.flags, 64);
      events.push(payload.content);
    },
    reply: async () => events.push('error-reply'),
  };
  await handler.handleInteractionCreate(interaction);
  assert.deepEqual(events, ['ack', 'queue', 'Refresh queued.']);
  assert.equal(client.listenerCount('messageReactionAdd'), 0);
  assert.equal(client.listenerCount('messageReactionRemove'), 0);
  provider.resolve();
});

test('queue admission is synchronous, coalesces clicks, publishes before completion and adds no reaction', async t => {
  const clock = timers();
  const provider = deferred();
  let gets = 0,
    reactions = 0,
    edits = 0;
  const message = {
    id: 'card',
    react: async () => {
      reactions++;
    },
    edit: async () => {
      edits++;
    },
  };
  const api = {
    pollingPolicy: () => ({ enabled: true, minIntervalMs: 60000 }),
    selectServer: async () => snapshot(),
    getServer: async () => {
      gets++;
      return provider.promise;
    },
  };
  const manager = createWatchManager({
    ...clock,
    now: () => 0,
    tracker: { observe: async s => s },
  });
  t.after(() => manager.stopAll());
  manager.start('bot:guild:chan', { channel: { send: async () => message }, client: api });
  await clock.tick();
  assert.equal(reactions, 0);
  assert.equal(typeof manager.enqueueRefresh, 'function');
  const one = manager.enqueueRefresh('bot:guild:chan', 'card');
  assert.equal(one.ok, true);
  assert.equal(one.queued, true);
  assert.equal(typeof one.then, 'undefined');
  const two = manager.enqueueRefresh('bot:guild:chan', 'card');
  assert.equal(two.coalesced, true);
  assert.equal(gets, 1);
  assert.equal(manager.enqueueRefresh('bot:guild:chan', 'obsolete').ok, false);
  assert.equal(edits, 0);
  provider.resolve(snapshot());
  await one.promise;
  await turn();
  assert.equal(edits, 1);
  assert.equal(clock.queue.length, 1);
  assert.equal(reactions, 0);
});

test('base scoreboard and timer precede optional ratings; late ratings do not overwrite a newer poll', async t => {
  const clock = timers(),
    ratingGate = deferred();
  let ratings = 0,
    gets = 0;
  const cards = [];
  const api = {
    pollingPolicy: () => ({ enabled: true, minIntervalMs: 60000 }),
    selectServer: async (_filter, options) => {
      assert.equal(options.deferRatings, true);
      return snapshot();
    },
    getServer: async (_address, options) => {
      assert.equal(options.deferRatings, true);
      gets++;
      return { ...snapshot(), scoreRed: 7 };
    },
    enrichRatings: async s => {
      ratings++;
      await ratingGate.promise;
      return s;
    },
  };
  const manager = createWatchManager({ ...clock, tracker: { observe: async s => s } });
  t.after(() => manager.stopAll());
  manager.start('ratings-test', {
    client: api,
    channel: {
      send: async payload => {
        const card = {
          id: 'card',
          payload,
          edit: async p => {
            card.payload = p;
          },
        };
        cards.push(card);
        return card;
      },
    },
  });
  await clock.tick();
  await turn();
  assert.equal(cards.length, 1);
  assert.equal(clock.queue.length, 1);
  assert.equal(ratings, 1);
  await clock.tick();
  assert.equal(gets, 1);
  assert.equal(ratings, 1, 'optional work remains singleflight');
  const checked = manager.snapshot('ratings-test');
  assert.equal(checked.scoreRed, 7);
  ratingGate.resolve();
  await turn();
  assert.equal(manager.snapshot('ratings-test').scoreRed, 7);
  assert.equal(clock.queue.length, 1);
});
