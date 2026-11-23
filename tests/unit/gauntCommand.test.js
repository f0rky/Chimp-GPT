'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommand } = require('../../src/commands/modules/gaunt');
const report = require('../helpers/gauntFixtures');
const roster = report.players.map(({ steamId, name, team }) => ({ steamId, name, team }));
function setup() {
  const calls = [],
    replies = [];
  const message = {
    guild: {},
    guildId: 'g',
    channelId: 'c',
    client: { user: { id: 'bot' } },
    author: { id: 'u' },
    reply: x => {
      replies.push(x);
      return Promise.resolve(x);
    },
  };
  return {
    calls,
    replies,
    message,
    cmd: createCommand({
      service: {
        collect: async (s, o) => {
          calls.push(o);
          return report;
        },
      },
      watches: { snapshot: key => (key === 'bot:g:c' ? { players: roster } : null) },
      rateLimit: async () => ({ limited: false }),
    }),
  };
}
test('command alias metadata and report path', async () => {
  const x = setup();
  assert.equal(x.cmd.name, 'gaunt');
  assert.deepEqual(x.cmd.aliases, ['gaunts']);
  await x.cmd.execute(x.message, []);
  assert.equal(x.calls.length, 1);
  assert.equal(x.calls[0].pairIds, undefined); // Omitted means roster scope; [] is invalid upstream.
  assert.deepEqual(x.replies[0].allowedMentions, { parse: [] });
});
test('rejects malformed, absent and ambiguous IDs before service work', async () => {
  const x = setup();
  for (const a of [['123'], ['76561198000000009'], ['76561198000000001', '76561198000000001']])
    await x.cmd.execute(x.message, a);
  const c = createCommand({
    watches: {
      snapshot: () => ({
        players: [
          { steamId: roster[0].steamId, name: 'Same', team: 1 },
          { steamId: roster[1].steamId, name: 'Same', team: 2 },
        ],
      }),
    },
    service: {
      collect: async () => {
        throw Error('unexpected');
      },
    },
    rateLimit: async () => ({ limited: false }),
  });
  await c.execute(x.message, ['Same']);
  assert.equal(x.calls.length, 0);
});
test('prevents DMs, absent watches and rate-limited provider calls', async () => {
  const x = setup();
  x.message.guild = null;
  await x.cmd.execute(x.message, []);
  assert.equal(x.calls.length, 0);
  x.message.guild = {};
  await createCommand({
    watches: { snapshot: () => null },
    service: {
      collect: async () => {
        throw Error('unexpected');
      },
    },
  }).execute(x.message, []);
  await createCommand({
    watches: { snapshot: () => ({ players: roster }) },
    service: {
      collect: async () => {
        throw Error('unexpected');
      },
    },
    rateLimit: async () => ({ limited: true }),
  }).execute(x.message, []);
  assert.equal(x.calls.length, 0);
});
