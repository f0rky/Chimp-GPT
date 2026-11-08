const test = require('node:test');
const assert = require('node:assert/strict');

const commandHandler = require('../../src/commands/commandHandler');
const clearCommand = require('../../src/commands/modules/clear');
const ACTIVE_FLOW = Symbol.for('chimp-gpt.activeConversationFlow');

function fixture() {
  const calls = [];
  const flow = {
    async clearConversation(scope) {
      calls.push(scope);
      return true;
    },
  };
  const client = { [ACTIVE_FLOW]: flow };
  const replies = [];
  const message = {
    content: '!clear',
    author: { id: 'user-1', username: 'tester' },
    channelId: 'channel-1',
    guildId: 'guild-1',
    guild: { id: 'guild-1' },
    channel: { id: 'channel-1', isDMBased: () => false },
    client,
    reply: async text => replies.push(text),
  };
  return { calls, flow, client, replies, message };
}

test('prefix clear and reset dispatch through the registered command to the client active flow', async () => {
  const f = fixture();
  commandHandler.registerCommand(clearCommand);
  for (const content of ['!clear', '!reset']) {
    f.message.content = content;
    assert.equal(await commandHandler.handleCommand(f.message, {}), true);
  }
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0], { userId: 'user-1', channelId: 'channel-1', guildId: 'guild-1' });
  assert.equal(f.replies.length, 2);
});

test('slash dispatcher invokes the clear interaction adapter against interaction.client flow', async () => {
  const f = fixture();
  commandHandler.registerCommand(clearCommand);
  const replies = [];
  const interaction = {
    commandName: 'clear',
    user: { id: 'user-2', username: 'tester' },
    channelId: 'channel-2',
    guildId: 'guild-2',
    channel: { isDMBased: () => false },
    client: f.client,
    deferReply: async payload => replies.push({ deferred: true, ...payload }),
    editReply: async content => replies.push({ content }),
    reply: async payload => replies.push(payload),
  };
  await commandHandler.handleSlashCommand(interaction, {});
  assert.deepEqual(f.calls[0], { userId: 'user-2', channelId: 'channel-2', guildId: 'guild-2' });
  assert.equal(replies[0].ephemeral, true);
  assert.equal(replies[0].deferred, true);
});

test('slash reset acknowledges before waiting for an in-flight conversation', async () => {
  const f = fixture();
  const events = [];
  let release;
  f.flow.clearConversation = () =>
    new Promise(resolve => {
      release = resolve;
      events.push('waiting');
    });
  const pending = clearCommand.interactionExecute({
    user: { id: 'user-1' },
    channelId: 'channel-1',
    guildId: 'guild-1',
    client: f.client,
    deferReply: async () => {
      events.push('deferred');
    },
    editReply: async () => {
      events.push('finished');
    },
    reply: async () => {
      events.push('late-reply');
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  const observed = [...events];
  release(true);
  await pending;
  assert.deepEqual(observed, ['deferred', 'waiting']);
  assert.deepEqual(events, ['deferred', 'waiting', 'finished']);
});

test('without an active flow the command truthfully reports no reset and does not claim success', async () => {
  const f = fixture();
  delete f.client[ACTIVE_FLOW];
  await clearCommand.execute(f.message, [], {});
  assert.match(f.replies[0], /history was not cleared/);
});

test('force is compatibility-only and cannot reload disk or widen reset scope', async () => {
  const f = fixture();
  await clearCommand.execute(f.message, ['--force'], {});
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], { userId: 'user-1', channelId: 'channel-1', guildId: 'guild-1' });
  assert.doesNotMatch(f.replies[0], /reload/i);
});
