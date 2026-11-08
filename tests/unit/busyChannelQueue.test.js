'use strict';
// Busy-channel FIFO: ordinary messages that arrive while a channel's turn is in flight are
// queued (bounded), dispatched in arrival order, and re-run through the unchanged policy checks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadHandlerModules, control } = require('../helpers/messageEventHandlerLoader');

const { MessageEventHandler } = loadHandlerModules();

const QUEUE_LIMIT = 3;
const response = content => ({ choices: [{ message: { content } }] });

// Provider fixture: every chat completion is held until the test settles it, so the channel
// stays busy deterministically and the dispatch order can be asserted.
function makeHandler() {
  const client = { on() {}, isReady: () => true, token: 'fixture', rest: {} };
  const busy = new Set();
  const dispatched = [];
  const held = new Map();
  const openai = {
    chat: {
      completions: {
        create: async request => {
          const last = String(request.messages.at(-1).content);
          const tag = dispatched.length;
          dispatched.push(last);
          return new Promise((resolve, reject) => held.set(tag, { last, resolve, reject }));
        },
      },
    },
  };
  const handler = new MessageEventHandler(
    client,
    { IGNORE_MESSAGE_PREFIX: '?' },
    {
      openai,
      allowedChannelIDs: ['c'],
      DISABLE_PLUGINS: true,
      inProgressOperations: busy,
      loadingEmoji: '…',
      statusManager: { trackConversation() {} },
      pfpManager: null,
    }
  );
  handler.pocketFlow.clearConversation = async () => true;
  return { handler, client, busy, dispatched, held };
}

function msg(content, { user = 'u1', bot = false, dm = false } = {}) {
  const m = {
    id: `${content}-${user}`,
    content,
    channelId: 'c',
    guildId: 'g',
    author: { id: user, username: user, bot },
    channel: {
      id: 'c',
      isDMBased: () => dm,
      send: async () => ({ id: 'thinking', edit: async () => {}, delete: async () => {} }),
    },
    attachments: [],
    replies: [],
    reactions: [],
  };
  m.reply = async text => m.replies.push(text);
  m.react = async emoji => m.reactions.push(emoji);
  return m;
}

async function until(predicate, label) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

const settle = (fixture, tag) => {
  const entry = [...fixture.held.values()].find(h => h.last.includes(tag));
  assert.ok(entry, `expected an in-flight provider call containing ${tag}`);
  entry.resolve(response(`${tag} reply`));
};

test('busy-channel messages are queued and dispatched in arrival order, once each', async () => {
  const f = makeHandler();
  const first = f.handler.handleMessageCreate(msg('alpha'));
  await until(() => f.dispatched.some(x => x.includes('alpha')), 'alpha dispatch');

  const second = msg('bravo');
  const third = msg('charlie');
  await f.handler.handleMessageCreate(second);
  await f.handler.handleMessageCreate(third);
  assert.deepEqual(f.dispatched.map(x => x.includes('bravo')).filter(Boolean), []);
  assert.deepEqual(second.reactions, ['⏳'], 'queued acceptance is visible to the user');

  settle(f, 'alpha');
  await until(() => f.dispatched.some(x => x.includes('bravo')), 'bravo dispatch');
  assert.equal(f.busy.has('c'), true, 'channel stays reserved while the queue drains');
  settle(f, 'bravo');
  await until(() => f.dispatched.some(x => x.includes('charlie')), 'charlie dispatch');
  settle(f, 'charlie');
  await first;
  await until(() => !f.busy.has('c'), 'channel release');

  const providerTurns = f.dispatched.map(x => x.match(/alpha|bravo|charlie/)[0]);
  assert.deepEqual(providerTurns, ['alpha', 'bravo', 'charlie']);
});

test('overflow beyond the bounded per-channel queue gets feedback and no provider dispatch', async () => {
  const f = makeHandler();
  const first = f.handler.handleMessageCreate(msg('alpha'));
  await until(() => f.dispatched.length === 1, 'alpha dispatch');

  const queued = ['bravo', 'charlie', 'delta'].map(t => msg(t));
  for (const m of queued) await f.handler.handleMessageCreate(m);
  const overflow = msg('echo');
  await f.handler.handleMessageCreate(overflow);

  assert.equal(queued.length, QUEUE_LIMIT);
  assert.equal(overflow.reactions.length, 0);
  assert.equal(overflow.replies.length, 1, 'overflow is reported to the sender');
  assert.match(overflow.replies[0], /not queued/i);

  const order = ['alpha', 'bravo', 'charlie', 'delta'];
  for (const [index, tag] of order.entries()) {
    settle(f, tag);
    if (index < order.length - 1)
      await until(() => f.dispatched.length === index + 2, `${tag} drain`);
  }
  await first;
  await until(() => !f.busy.has('c'), 'channel release');
  assert.equal(
    f.dispatched.some(x => x.includes('echo')),
    false,
    'overflow never reaches the provider'
  );
  assert.equal(f.dispatched.length, 4);
});

test('a reset by one person drops only that person’s queued messages', async () => {
  const f = makeHandler();
  const first = f.handler.handleMessageCreate(msg('alpha', { user: 'u1' }));
  await until(() => f.dispatched.length === 1, 'alpha dispatch');

  await f.handler.handleMessageCreate(msg('bravo-u1', { user: 'u1' }));
  await f.handler.handleMessageCreate(msg('charlie-u2', { user: 'u2' }));
  const reset = msg('!clear', { user: 'u1' });
  await f.handler.handleMessageCreate(reset);

  settle(f, 'alpha');
  await until(() => f.dispatched.some(x => x.includes('charlie-u2')), 'other person dispatch');
  settle(f, 'charlie-u2');
  await first;
  await until(() => !f.busy.has('c'), 'channel release');
  assert.equal(
    f.dispatched.some(x => x.includes('bravo-u1')),
    false,
    'reset removed queued turn'
  );
  assert.equal(f.dispatched.length, 2);
});

test('a failed in-flight turn releases the channel and still processes the queue once', async () => {
  const f = makeHandler();
  const first = f.handler.handleMessageCreate(msg('alpha'));
  await until(() => f.dispatched.length === 1, 'alpha dispatch');
  await f.handler.handleMessageCreate(msg('bravo'));

  const failing = [...f.held.values()].find(h => h.last.includes('alpha'));
  failing.reject(new Error('fixture provider failure'));
  await first;

  await until(() => f.dispatched.some(x => x.includes('bravo')), 'bravo dispatch after failure');
  settle(f, 'bravo');
  await until(() => !f.busy.has('c'), 'channel release');
  assert.equal(f.dispatched.filter(x => x.includes('bravo')).length, 1);
});

test('bot, DM and ignore-prefix messages are never queued while busy', async () => {
  const f = makeHandler();
  const first = f.handler.handleMessageCreate(msg('alpha'));
  await until(() => f.dispatched.length === 1, 'alpha dispatch');

  const bot = msg('bot chatter', { bot: true });
  const dm = msg('direct', { dm: true });
  const prefixed = msg('?ignored');
  for (const m of [bot, dm, prefixed]) await f.handler.handleMessageCreate(m);
  assert.deepEqual([bot.reactions, dm.reactions, prefixed.reactions], [[], [], []]);

  const ordinary = msg('echo');
  await f.handler.handleMessageCreate(ordinary);
  assert.deepEqual(
    ordinary.reactions,
    ['⏳'],
    'an ordinary message is still queued in the same window'
  );
  settle(f, 'alpha');
  await until(() => f.dispatched.some(x => x.includes('echo')), 'ordinary queued turn dispatch');
  settle(f, 'echo');
  await first;
  await until(() => !f.busy.has('c'), 'channel release');
  assert.equal(f.dispatched.length, 2);
  assert.equal(
    f.dispatched.some(x => /bot chatter|direct|\?ignored/.test(x)),
    false
  );
});

test('a queued message from a user blocked after queueing never reaches the provider', async () => {
  const f = makeHandler();
  const first = f.handler.handleMessageCreate(msg('alpha', { user: 'u1' }));
  await until(() => f.dispatched.length === 1, 'alpha dispatch');
  await f.handler.handleMessageCreate(msg('bravo-blocked', { user: 'u2' }));
  await f.handler.handleMessageCreate(msg('delta-allowed', { user: 'u4' }));
  control.blockedUserIds.add('u2');
  try {
    settle(f, 'alpha');
    await until(
      () => f.dispatched.some(x => x.includes('delta-allowed')),
      'allowed turn behind blocked one'
    );
    settle(f, 'delta-allowed');
    await first;
    await until(() => !f.busy.has('c'), 'channel release');
  } finally {
    control.blockedUserIds.delete('u2');
  }
  assert.equal(
    f.dispatched.some(x => x.includes('bravo-blocked')),
    false,
    'blocked queued turn is re-checked and not dispatched'
  );
  assert.equal(f.dispatched.length, 2, 'the queue still drains past the blocked turn');
});

test('a queued message from a rate-limited user never reaches the provider', async () => {
  const f = makeHandler();
  const first = f.handler.handleMessageCreate(msg('alpha', { user: 'u1' }));
  await until(() => f.dispatched.length === 1, 'alpha dispatch');
  await f.handler.handleMessageCreate(msg('charlie-limited', { user: 'u3' }));
  await f.handler.handleMessageCreate(msg('delta-allowed', { user: 'u4' }));
  control.rateLimitedUserIds.add('u3');
  try {
    settle(f, 'alpha');
    await until(
      () => f.dispatched.some(x => x.includes('delta-allowed')),
      'allowed turn behind limited one'
    );
    settle(f, 'delta-allowed');
    await first;
    await until(() => !f.busy.has('c'), 'channel release');
  } finally {
    control.rateLimitedUserIds.delete('u3');
  }
  assert.equal(
    f.dispatched.some(x => x.includes('charlie-limited')),
    false,
    'rate-limited queued turn is re-checked and not dispatched'
  );
  assert.equal(f.dispatched.length, 2, 'the queue still drains past the limited turn');
});
