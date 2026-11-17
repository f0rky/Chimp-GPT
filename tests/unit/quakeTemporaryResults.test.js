const assert = require('node:assert/strict');
const test = require('node:test');

const serverstats = require('../../src/commands/modules/serverstats');
const { handleQuakeStats } = require('../../src/handlers/quakeStatsHandler');
const FunctionExecutorNode = require('../../src/conversation/flow/nodes/FunctionExecutorNode');
const {
  QUAKE_RESULT_REFRESH_MS,
  QUAKE_RESULT_TTL_MS,
  scheduleQuakeResultLifecycle,
  scheduleMessageDeletion,
} = require('../../src/utils/temporaryMessage');

test('temporary message scheduler uses a five-minute unrefed timer and deletes', async () => {
  let callback;
  let delay;
  let unrefed = false;
  let deleted = false;
  const message = { delete: () => Promise.resolve((deleted = true)) };

  scheduleMessageDeletion(message, undefined, {
    setTimer: (fn, ms) => {
      callback = fn;
      delay = ms;
      return { unref: () => (unrefed = true) };
    },
  });

  assert.equal(delay, QUAKE_RESULT_TTL_MS);
  assert.equal(delay, 300_000);
  assert.equal(unrefed, true);
  callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deleted, true);
});

test('Quake result lifecycle refreshes each minute and stops before deleting after five minutes', async () => {
  let intervalCallback;
  let expiryCallback;
  let intervalDelay;
  let expiryDelay;
  let clearedInterval;
  let refreshes = 0;
  let deleted = false;
  const unrefed = [];
  const message = { id: 'result', delete: () => Promise.resolve((deleted = true)) };

  scheduleQuakeResultLifecycle(message, () => Promise.resolve(refreshes++), {
    pollingPolicy: () => ({ enabled: true }),
    setInterval: (callback, delay) => {
      intervalCallback = callback;
      intervalDelay = delay;
      return { unref: () => unrefed.push('interval') };
    },
    setTimeout: (callback, delay) => {
      expiryCallback = callback;
      expiryDelay = delay;
      return { unref: () => unrefed.push('expiry') };
    },
    clearInterval: timer => (clearedInterval = timer),
  });

  assert.equal(intervalDelay, QUAKE_RESULT_REFRESH_MS);
  assert.equal(intervalDelay, 60_000);
  assert.equal(expiryDelay, QUAKE_RESULT_TTL_MS);
  assert.equal(expiryDelay, 300_000);
  assert.deepEqual(unrefed, ['interval', 'expiry']);

  intervalCallback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 1);

  expiryCallback();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(clearedInterval);
  assert.equal(deleted, true);
  intervalCallback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 1);
});

test('Quake result lifecycle does not overlap a slow refresh', async () => {
  let intervalCallback;
  let completeRefresh;
  let refreshes = 0;
  scheduleQuakeResultLifecycle(
    { id: 'result', delete: () => Promise.resolve() },
    () => {
      refreshes += 1;
      return new Promise(resolve => (completeRefresh = resolve));
    },
    {
      pollingPolicy: () => ({ enabled: true }),
      setInterval: callback => {
        intervalCallback = callback;
        return { unref: () => undefined };
      },
      setTimeout: () => ({ unref: () => undefined }),
      clearInterval: () => undefined,
    }
  );

  intervalCallback();
  intervalCallback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 1);
  completeRefresh();
  await new Promise(resolve => setImmediate(resolve));
  intervalCallback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 2);
});

test('temporary message scheduler tolerates an already-deleted Discord message', async () => {
  let callback;
  let warnings = 0;
  scheduleMessageDeletion(
    { delete: () => Promise.reject(Object.assign(new Error('Unknown Message'), { code: 10008 })) },
    1,
    {
      setTimer: fn => {
        callback = fn;
        return { unref: () => undefined };
      },
      log: { warn: () => warnings++ },
    }
  );
  callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(warnings, 0);
});

test('text serverstats replies with checking, edits that reply, and schedules it', async () => {
  const edits = [];
  const resultMessage = {
    edit: content => Promise.resolve(edits.push(content)),
    delete: () => undefined,
  };
  const replies = [];
  let scheduled;
  const message = {
    author: { id: 'user', username: 'Tester' },
    reply: content => {
      replies.push(content);
      return Promise.resolve(resultMessage);
    },
  };

  await serverstats.execute(message, [], {
    lookup: () => Promise.resolve('# 🎯 Quake Live Server Status\n\nserver result'),
    scheduleDeletion: messageToDelete => (scheduled = messageToDelete),
    trackApiCall: () => undefined,
  });

  assert.deepEqual(replies, ['🔍 Checking server stats...']);
  assert.deepEqual(edits, ['# 🎯 Quake Live Server Status\n\nserver result']);
  assert.equal(scheduled, resultMessage);
});

test('text serverstats refresh lifecycle re-runs the lookup with a forced Slipgate snapshot', async () => {
  const edits = [];
  let refresh;
  const resultMessage = {
    edit: content => Promise.resolve(edits.push(content)),
    delete: () => undefined,
  };
  const lookupCalls = [];

  await serverstats.execute(
    {
      author: { id: 'user', username: 'Tester' },
      reply: () => Promise.resolve(resultMessage),
    },
    [],
    {
      lookup: (...args) => {
        lookupCalls.push(args);
        return Promise.resolve(`stats ${lookupCalls.length}`);
      },
      scheduleLifecycle: (_message, callback) => (refresh = callback),
      trackApiCall: () => undefined,
    }
  );

  await refresh(resultMessage);
  assert.deepEqual(lookupCalls, [
    [null, null],
    [null, null, { forceRefresh: true }],
  ]);
  assert.deepEqual(edits, ['stats 1', 'stats 2']);
});

test('slash serverstats defers visibly, edits with result, and schedules that message', async () => {
  const calls = [];
  const resultMessage = { delete: () => undefined };
  let scheduled;
  const interaction = {
    user: { id: 'user', username: 'Tester' },
    options: {
      getString: () => null,
      getInteger: () => null,
    },
    deferReply: options => Promise.resolve(calls.push(['defer', options])),
    editReply: content => {
      calls.push(['edit', content]);
      return Promise.resolve(resultMessage);
    },
  };

  await serverstats.interactionExecute(interaction, {
    lookup: () => Promise.resolve('visible stats'),
    scheduleDeletion: messageToDelete => (scheduled = messageToDelete),
    trackApiCall: () => undefined,
  });

  assert.deepEqual(calls, [
    ['defer', undefined],
    ['edit', 'visible stats'],
  ]);
  assert.equal(scheduled, resultMessage);
});

test('function-call Quake edits and schedules the actual feedback result message', async () => {
  const edits = [];
  const feedbackMessage = {
    edit: content => {
      edits.push(content);
      return Promise.resolve(feedbackMessage);
    },
    delete: () => undefined,
  };
  let scheduled;

  const success = await handleQuakeStats(feedbackMessage, '🔍', null, {
    lookup: () => Promise.resolve('function-call stats'),
    scheduleDeletion: messageToDelete => (scheduled = messageToDelete),
  });

  assert.equal(success, true);
  assert.deepEqual(edits, ['🔍 Checking server stats...', 'function-call stats']);
  assert.equal(scheduled, feedbackMessage);
});

test('PocketFlow returns Quake tool output as a temporary Quake result', async () => {
  const result = await FunctionExecutorNode.prototype.executeFunction.call(
    {
      detectImageRequest: () => false,
      callOpenAI: () =>
        Promise.resolve({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: { tool_calls: [{ function: { name: 'quakeLookup', arguments: '{}' } }] },
            },
          ],
        }),
      executeFunctionCall: () =>
        Promise.resolve({
          success: true,
          result: { success: true, formatted: 'raw quake stats' },
        }),
      generateNaturalResponse: () => assert.fail('Quake tool output must not be rephrased'),
    },
    null,
    { context: [], message: { content: 'quake stats' } }
  );

  assert.equal(result.type, 'quake');
  assert.equal(result.response, 'raw quake stats');
});

test('automatic temporary refresh fails closed when quota policy is disabled', async () => {
  let tick,
    refreshes = 0;
  scheduleQuakeResultLifecycle(
    { id: 'result', delete: async () => {} },
    async () => {
      refreshes++;
    },
    {
      pollingPolicy: () => ({ enabled: false }),
      setInterval: fn => {
        tick = fn;
        return { unref() {} };
      },
      setTimeout: () => ({ unref() {} }),
      clearInterval() {},
    }
  );
  tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 0);
});
