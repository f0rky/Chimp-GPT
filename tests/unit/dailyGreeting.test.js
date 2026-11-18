const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');

const originalFs = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
};
const { getAnnouncementDate, sendChannelGreeting } = require('../../src/utils/greetingManager');

test.after(() => {
  fs.existsSync = originalFs.existsSync;
  fs.readFileSync = originalFs.readFileSync;
  fs.writeFileSync = originalFs.writeFileSync;
  fs.mkdirSync = originalFs.mkdirSync;
});

test('concurrent greeting creation sends exactly one channel message', async () => {
  let state = JSON.stringify({ channels: {} });
  fs.existsSync = () => true;
  fs.readFileSync = () => state;
  fs.writeFileSync = (_path, value) => {
    state = value;
  };
  fs.mkdirSync = () => undefined;
  let sends = 0;
  const message = { id: 'race-greeting', edit: async () => {} };
  const channel = {
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => false }),
    messages: { fetch: async () => message },
    send: async () => {
      sends++;
      await new Promise(resolve => setImmediate(resolve));
      return message;
    },
  };
  message.channel = channel;
  const client = {
    user: { id: 'solvis' },
    isReady: () => true,
    channels: { fetch: async () => channel },
  };
  await Promise.all([
    sendChannelGreeting(client, ['race-channel']),
    sendChannelGreeting(client, ['race-channel']),
  ]);
  assert.equal(sends, 1);
});

test('channel reconciliation stays sequential, persists each send and continues past failures', async () => {
  let state = JSON.stringify({ channels: {} });
  const events = [];
  fs.existsSync = () => true;
  fs.readFileSync = () => state;
  fs.writeFileSync = (_path, value) => {
    state = value;
    events.push('save');
  };
  fs.mkdirSync = () => undefined;
  let activeSends = 0;
  let maxActiveSends = 0;
  const client = {
    user: { id: 'solvis' },
    isReady: () => true,
    channels: {
      fetch: async id => {
        events.push(`fetch:${id}`);
        if (id === 'unavailable') throw new Error('fixture channel unavailable');
        if (id === 'voice') return { isTextBased: () => false };
        const channel = {
          name: id,
          isTextBased: () => true,
          permissionsFor: () => ({ has: () => false }),
          send: async () => {
            activeSends++;
            maxActiveSends = Math.max(maxActiveSends, activeSends);
            events.push(`send:${id}`);
            await new Promise(resolve => setImmediate(resolve));
            activeSends--;
            return { id: `message-${id}`, channel };
          },
        };
        return channel;
      },
    },
  };
  await sendChannelGreeting(client, ['first', 'unavailable', 'voice', 'last']);
  assert.equal(maxActiveSends, 1);
  assert.deepEqual(events, [
    'fetch:first',
    'send:first',
    'save',
    'fetch:unavailable',
    'fetch:voice',
    'fetch:last',
    'send:last',
    'save',
  ]);
  assert.deepEqual(Object.keys(JSON.parse(state).channels), ['first', 'last']);
});

test('reuses the current Auckland-day greeting instead of sending another', async () => {
  const today = getAnnouncementDate();
  let savedState = JSON.stringify({
    channels: { 'announcement-channel': { date: today, messageId: 'daily-message' } },
  });
  fs.existsSync = () => true;
  fs.readFileSync = () => savedState;
  fs.writeFileSync = (_path, content) => {
    savedState = content;
  };
  fs.mkdirSync = () => undefined;

  const edits = [];
  const collectors = [];
  const collector = { on: () => collector };
  const channel = {
    id: 'announcement-channel',
    name: 'announcements',
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    messages: {
      fetch: id =>
        Promise.resolve({
          id,
          channel,
          reactions: { removeAll: () => Promise.resolve() },
          react: () => Promise.resolve(),
          createReactionCollector: options => {
            collectors.push(options);
            return collector;
          },
          edit: payload => {
            edits.push(payload);
            return Promise.resolve();
          },
        }),
    },
    send: () => assert.fail('same-day greeting must be edited, not sent again'),
  };
  const client = {
    user: { id: 'solvis' },
    isReady: () => true,
    channels: { fetch: () => Promise.resolve(channel) },
  };

  await sendChannelGreeting(client, ['announcement-channel']);

  assert.equal(edits.length, 1);
  assert.equal(collectors.length, 1);
  const ownerId = require('../../src/core/configValidator').OWNER_ID;
  assert.equal(collectors[0].filter({ emoji: { name: '🗑️' } }, { id: ownerId }), true);
  assert.equal(collectors[0].filter({ emoji: { name: '📌' } }, { id: ownerId }), true);
  assert.equal(collectors[0].filter({ emoji: { name: '🗑️' } }, { id: 'non-owner' }), false);
  assert.equal(
    collectors[0].filter({ emoji: { name: '🧹' } }, { id: '000000000000000001' }),
    false
  );
  assert.ok(
    edits[0].embeds[0].data.fields[1].value.includes(require('../../package.json').version),
    'greeting reports the current package version'
  );
  assert.equal(JSON.parse(savedState).channels['announcement-channel'].messageId, 'daily-message');
});
