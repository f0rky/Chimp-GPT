const assert = require('node:assert/strict');
const test = require('node:test');

const { cleanStaleBotMessages } = require('../../src/utils/greetingSweep');

function makeMessage(id, authorId, { pinned = false, deleteError = null } = {}) {
  let deleted = false;
  return {
    id,
    author: { id: authorId },
    pinned,
    delete: () => {
      if (deleteError) return Promise.reject(deleteError);
      deleted = true;
      return Promise.resolve();
    },
    get deleted() {
      return deleted;
    },
  };
}

test('sweep removes only older unpinned bot-authored messages and leaves member and pinned messages intact', async () => {
  const staleBot = makeMessage('bot-old', 'solvis');
  const memberMessage = makeMessage('member-old', 'member');
  const pinnedBot = makeMessage('bot-pinned', 'solvis', { pinned: true });
  let fetchOptions;
  const channel = {
    messages: {
      fetch: options => {
        fetchOptions = options;
        return Promise.resolve(
          new Map([
            [staleBot.id, staleBot],
            [memberMessage.id, memberMessage],
            [pinnedBot.id, pinnedBot],
          ])
        );
      },
    },
  };

  const result = await cleanStaleBotMessages(channel, 'solvis', 'startup-message', {
    targetMessageIds: [staleBot.id],
  });

  assert.deepEqual(fetchOptions, { before: 'startup-message', limit: 100 });
  assert.equal(result.deleted, 1);
  assert.equal(staleBot.deleted, true);
  assert.equal(memberMessage.deleted, false);
  assert.equal(pinnedBot.deleted, false);
});

test('sweep fails closed without explicit targets and preserves unselected bot replies and finals', async () => {
  const greeting = makeMessage('greeting-old', 'solvis');
  const reply = makeMessage('chat-old', 'solvis');
  const final = makeMessage('final-old', 'solvis');
  const pinned = makeMessage('pinned-old', 'solvis', { pinned: true });
  const member = makeMessage('human-old', 'member');
  const trigger = makeMessage('startup-message', 'solvis');
  let fetches = 0;
  const channel = {
    messages: {
      fetch: async () => {
        fetches++;
        return new Map([greeting, reply, final, pinned, member, trigger].map(m => [m.id, m]));
      },
    },
  };
  assert.deepEqual(await cleanStaleBotMessages(channel, 'solvis', trigger.id), {
    deleted: 0,
    failed: 0,
  });
  assert.equal(fetches, 0);
  await cleanStaleBotMessages(channel, 'solvis', trigger.id, {
    targetMessageIds: [greeting.id, pinned.id, member.id, trigger.id],
  });
  assert.equal(greeting.deleted, true);
  for (const message of [reply, final, pinned, member, trigger]) {
    assert.equal(message.deleted, false, `must retain ${message.id}`);
  }
});

test('sweep continues when one stale bot message cannot be deleted', async () => {
  const failedBot = makeMessage('failed', 'solvis', { deleteError: new Error('Unknown Message') });
  const staleBot = makeMessage('deleted', 'solvis');
  const channel = {
    messages: {
      fetch: () =>
        Promise.resolve(
          new Map([
            [failedBot.id, failedBot],
            [staleBot.id, staleBot],
          ])
        ),
    },
  };

  const result = await cleanStaleBotMessages(channel, 'solvis', 'startup-message', {
    targetMessageIds: [failedBot.id, staleBot.id],
    log: { warn: () => undefined },
  });

  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 1);
  assert.equal(staleBot.deleted, true);
});
