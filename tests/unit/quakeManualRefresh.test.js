'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
const { snapshot, deferred, turn, timers } = require('../helpers/slipgateFixtures');

function fixture() {
  const clock = timers();
  const starts = [];
  const messages = [];
  let current = snapshot();
  let reactionFailure = null;
  const channel = {
    send: async payload => {
      const m = {
        id: String(messages.length + 1),
        payload,
        react: () => {
          if (reactionFailure === 'throw') throw Error('missing Add Reactions');
          if (reactionFailure === 'reject') return Promise.reject(Error('missing Add Reactions'));
        },
        edit: async p => {
          m.payload = p;
        },
        delete: async () => {},
      };
      messages.push(m);
      return m;
    },
  };
  const client = {
    pollingPolicy: () => ({ enabled: true, minIntervalMs: 60000 }),
    selectServer: async () => {
      starts.push('select');
      return current;
    },
    getServer: async () => {
      starts.push('get');
      return current;
    },
  };
  const manager = createWatchManager({
    ...clock,
    now: () => 0,
    tracker: { observe: async s => s },
  });
  manager.start('bot:guild:channel', { channel, client });
  return {
    ...clock,
    manager,
    starts,
    messages,
    channel,
    client,
    set: s => {
      current = s;
    },
    failReaction: mode => {
      reactionFailure = mode;
    },
  };
}

test('manual refresh shares watch path, binds current card, coalesces overlap, and leaves exactly one ordinary timer', async () => {
  const f = fixture();
  await f.tick();
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].payload.components[0].components[0].label, 'Refresh');
  const gate = deferred();
  f.client.getServer = async () => {
    f.starts.push('get');
    await gate.promise;
    return snapshot();
  };
  const before = f.starts.length;
  const one = f.manager.refresh('bot:guild:channel', '1');
  await turn();
  const two = f.manager.refresh('bot:guild:channel', '1');
  assert.equal((await two).coalesced, true);
  assert.equal(f.starts.length, before + 1);
  gate.resolve();
  assert.equal((await one).ok, true);
  assert.equal(f.queue.length, 1);
});

test('reaction-add permission failures degrade to the button and do not stop the watch', async () => {
  for (const mode of ['throw', 'reject']) {
    const f = fixture();
    f.failReaction(mode);
    await f.tick();
    assert.ok(f.manager.status('bot:guild:channel'));
    assert.equal(f.messages[0].payload.components[0].components[0].label, 'Refresh');
    assert.equal(f.queue.length, 1);
    await f.manager.stopAll();
  }
});

test('manual request overlapping a scheduled provider fetch coalesces with it', async () => {
  const f = fixture();
  await f.tick();
  const gate = deferred();
  f.client.getServer = async () => {
    f.starts.push('get');
    await gate.promise;
    return snapshot();
  };
  const before = f.starts.length;
  const scheduled = f.tick();
  await turn();
  const result = await f.manager.refresh('bot:guild:channel', '1');
  assert.equal(result.coalesced, true);
  assert.equal(f.starts.length, before + 1);
  gate.resolve();
  await scheduled;
  assert.equal(f.queue.length, 1);
});

test('manual 429 reports backoff truthfully and keeps one normal timer', async () => {
  const f = fixture();
  await f.tick();
  f.client.getServer = async () => {
    f.starts.push('get');
    throw Object.assign(Error('429'), { status: 429, retryAfterMs: 90000 });
  };
  const result = await f.manager.refresh('bot:guild:channel', '1');
  assert.equal(result.ok, true);
  assert.equal(result.backoff, true);
  assert.match(result.reason, /backoff/);
  assert.equal(f.queue.length, 1);
});

test('refresh rejects stale card ids, debounces completed clicks, and stop invalidates controls', async () => {
  const f = fixture();
  await f.tick();
  assert.equal((await f.manager.refresh('bot:guild:channel', 'old')).ok, false);
  assert.equal((await f.manager.refresh('bot:guild:channel', '1')).ok, true);
  const starts = f.starts.length;
  assert.equal((await f.manager.refresh('bot:guild:channel', '1')).ok, false);
  assert.equal(f.starts.length, starts);
  await f.manager.stop('bot:guild:channel');
  assert.equal(f.messages[0].payload.components.length, 0);
  assert.equal((await f.manager.refresh('bot:guild:channel', '1')).ok, false);
});
