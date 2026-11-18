const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');

const originalFs = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
};
const coordinator = require('../../src/utils/startupMessageCoordinator');

let state = {
  monitoringDate: '2000-01-01',
  messageId: 'stale-message',
  channelId: 'owner-dm',
};
fs.existsSync = () => true;
fs.readFileSync = () => JSON.stringify(state);
fs.writeFileSync = (_path, value) => {
  state = JSON.parse(value);
};
fs.mkdirSync = () => undefined;

test.after(() => {
  fs.existsSync = originalFs.existsSync;
  fs.readFileSync = originalFs.readFileSync;
  fs.writeFileSync = originalFs.writeFileSync;
  fs.mkdirSync = originalFs.mkdirSync;
  coordinator.reset();
});

test('concurrent monitoring creation sends exactly one private message', async () => {
  coordinator.reset();
  state = {};
  let sends = 0;
  const message = { id: 'concurrent-message', channel: { id: 'owner-dm' }, edit: async () => {} };
  const owner = {
    dmChannel: { messages: { fetch: async () => null } },
    send: async () => {
      sends++;
      await new Promise(resolve => setImmediate(resolve));
      return message;
    },
  };
  assert.deepEqual(
    await Promise.all([
      coordinator.ensureDailyMonitoringMessage(owner),
      coordinator.ensureDailyMonitoringMessage(owner),
    ]),
    [true, true]
  );
  assert.equal(sends, 1);
  state = { monitoringDate: '2000-01-01', messageId: 'stale-message', channelId: 'owner-dm' };
});

test('uses one private owner-DM monitoring message per Auckland day', async () => {
  coordinator.reset();
  const edits = [];
  const sent = [];
  const message = {
    id: 'daily-message',
    channel: { id: 'owner-dm' },
    edit: payload => {
      edits.push(payload);
      return Promise.resolve();
    },
  };
  const dmChannel = {
    id: 'owner-dm',
    messages: { fetch: id => Promise.resolve(id === 'daily-message' ? message : null) },
  };
  const owner = {
    dmChannel,
    createDM: () => Promise.resolve(dmChannel),
    send: payload => {
      sent.push(payload);
      return Promise.resolve(message);
    },
  };

  assert.equal(await coordinator.sendStartupMessage(owner), true);
  assert.equal(sent.length, 1, 'the first daily report is sent privately to the owner');
  assert.equal(state.channelId, 'owner-dm');
  assert.equal(state.monitoringDate, coordinator.getMonitoringDate());

  assert.equal(await coordinator.updateHealthReport('healthy'), true);
  assert.equal(edits.length, 1, 'health updates edit the owner-DM message');

  coordinator.reset();
  assert.equal(await coordinator.sendStartupMessage(owner), true);
  assert.equal(sent.length, 1, 'a same-day restart reuses the owner-DM message');
  assert.equal(edits.length, 2, 'the existing daily message is edited on restart');
});
