'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createScoreboardLifecycle } = require('../../src/services/scoreboardLifecycle');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
const { snapshot, timers } = require('../helpers/slipgateFixtures');

function setup(messages) {
  const previous = {
    id: '10',
    author: { id: 'bot-1', bot: true },
    embeds: [{ title: 'The Purgery#1', footer: { text: 'Slipgate · 12:00' } }],
    delete: async function () {
      this.deleted = true;
    },
  };
  const sent = [];
  const channel = {
    id: 'channel-1',
    client: { user: { id: 'bot-1' } },
    messages: { fetch: async () => new Map(messages.map((m, i) => [String(i), m])) },
    send: async payload => {
      const m = {
        id: String(sent.length + 11),
        payload,
        delete: async function () {
          this.deleted = true;
        },
      };
      sent.push(m);
      return m;
    },
  };
  const lc = createScoreboardLifecycle({
    channel,
    client: {},
    perform: fn => fn(),
    active: () => true,
  });
  return { lc, channel, previous, sent };
}

test('repositions after ordinary message from same bot, but not its own live/final scoreboard', async () => {
  const ownCard = {
    author: { id: 'bot-1', bot: true },
    embeds: [{ title: 'The Purgery#1', footer: { text: 'Slipgate · 12:00' } }],
  };
  const f = setup([ownCard, { author: { id: 'bot-1', bot: true }, content: 'status' }]);
  await f.lc.prepare({ state: 'live', players: [] });
  await f.lc.publish({ content: 'updated' });
  assert.equal(await f.lc.shouldMove(), true);
  const onlyOwn = setup([ownCard]);
  await onlyOwn.lc.prepare({ state: 'live', players: [] });
  await onlyOwn.lc.publish({ content: 'updated' });
  assert.equal(await onlyOwn.lc.shouldMove(), false);
});

test('real watch sends fresh card then deletes only its old card below same-bot status', async () => {
  const f = setup([{ author: { id: 'bot-1', bot: true }, content: 'ordinary status' }]);
  const clock = timers();
  const client = {
    pollingPolicy: () => ({ enabled: true, minIntervalMs: 60000 }),
    selectServer: async () => snapshot(),
    getServer: async () => snapshot(),
  };
  const manager = createWatchManager({ ...clock, tracker: { observe: async s => s } });
  manager.start('bot:guild:channel', { channel: f.channel, client });
  await clock.tick();
  assert.equal(f.sent.length, 1);
  await clock.tick();
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].deleted, true);
  assert.equal(f.sent[1].deleted, undefined);
  await manager.stopAll();
});

test('A2S-only scheduled fresh snapshot can reposition using channel order without match identity', async () => {
  const f = setup([{ author: { id: 'bot-2', bot: true }, content: 'status' }]);
  await f.lc.prepare({ state: 'unknown', quality: { a2sOnly: true }, players: [] });
  await f.lc.publish({ content: 'updated' });
  assert.equal(await f.lc.shouldMove(), true);
});
