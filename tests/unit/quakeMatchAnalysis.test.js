'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const analysis = require('../../src/services/quakeMatchAnalysis');
const { snapshot: baseSnapshot, deferred, turn } = require('../helpers/slipgateFixtures');
const snapshot = () => ({
  ...baseSnapshot(),
  players: [...baseSnapshot().players, { team: 2, alive: true }],
});
test('optional configured analysis uses real SDK path lazily, chatModel, bounded tokens, timeout, abort and no retries', async () => {
  const original = Module._load;
  let constructions = 0,
    requests = 0;
  Module._load = function (name, ...args) {
    if (name === 'openai')
      return class SDK {
        constructor(options) {
          constructions++;
          assert.equal(options.maxRetries, 0);
          assert.equal(options.timeout, 4000);
          this.chat = {
            completions: {
              create: async (request, opts) => {
                requests++;
                assert.equal(request.model, require('../../src/services/chatModel').CHAT_MODEL);
                assert.equal(request.max_completion_tokens, 120);
                assert.equal(request.reasoning_effort, 'none');
                assert.equal(opts.timeout, 4000);
                assert.equal(opts.maxRetries, 0);
                assert.ok(opts.signal instanceof AbortSignal);
                assert.equal(JSON.stringify(request).includes('ignore all instructions'), false);
                assert.doesNotMatch(JSON.stringify(request), /damage|accuracy|compare_damage/);
                assert.deepEqual(JSON.parse(request.messages[1].content).options, [
                  'roster',
                  'alive',
                ]);
                return { choices: [{ message: { content: '{"focus":"alive"}' } }] };
              },
            },
          };
        }
      };
    if (name === '../core/openaiFetch')
      return { openaiFetch: async () => assert.fail('No network') };
    return original.call(this, name, ...args);
  };
  try {
    analysis._cache.clear();
    await analysis.analyze(snapshot(), { env: {} });
    const configured = { SLIPGATE_AI_ANALYSIS: 'true', OPENAI_API_KEY: 'fixture' };
    for (const state of ['warmup', 'waiting', 'final', null])
      await analysis.analyze({ ...snapshot(), state }, { env: configured });
    await analysis.analyze({ ...snapshot(), stale: true }, { env: configured });
    await analysis.analyze({ ...snapshot(), quality: { a2sOnly: true } }, { env: configured });
    assert.equal(constructions, 0);
    assert.equal(requests, 0);
    const text = await analysis.analyze(snapshot(), {
      env: { SLIPGATE_AI_ANALYSIS: 'true', OPENAI_API_KEY: 'fixture' },
    });
    assert.match(text, /Currently alive: Red 1\/1, Blue 1\/1/);
    assert.doesNotMatch(text, /AI-selected|focus|damage|accuracy/);
    assert.equal(constructions, 1);
    assert.equal(requests, 1);
  } finally {
    Module._load = original;
  }
});
test('stale data, absent provider, invalid output, provider failures and timeout have useful factual fallbacks', async () => {
  analysis._cache.clear();
  let calls = 0;
  const provider = async () => {
    calls++;
    throw Error('fixture');
  };
  const stale = await analysis.analyze({ ...snapshot(), stale: true }, { provider });
  assert.match(stale, /Stale/);
  assert.equal(calls, 0);
  assert.equal(await analysis.analyze(snapshot(), { provider }), analysis.factual(snapshot()));
  assert.equal(calls, 1);
  assert.equal(
    await analysis.analyze(snapshot(), {
      provider: async () => ({ focus: 'invent positions at bridge' }),
    }),
    analysis.factual(snapshot())
  );
  let aborted = false;
  const text = await analysis.analyze(snapshot(), {
    timeoutMs: 5,
    provider: async (_p, opts) => {
      opts.signal.addEventListener('abort', () => {
        aborted = true;
      });
      return new Promise(() => {});
    },
  });
  assert.equal(text, analysis.factual(snapshot()));
  assert.equal(aborted, true);
});
test('caller abort interrupts provider and falls back; changing names cannot inject instructions or poison factual cache', async () => {
  analysis._cache.clear();
  const held = deferred();
  const controller = new AbortController();
  let signal;
  const provider = async (_request, opts) => {
    signal = opts.signal;
    return held.promise;
  };
  const work = analysis.analyze(snapshot(), { provider, signal: controller.signal });
  await turn();
  controller.abort();
  const text = await work;
  assert.equal(signal.aborted, true);
  assert.equal(text, analysis.factual(snapshot()));
  held.resolve({ focus: 'verify_score' });
  assert.equal(
    analysis.fingerprint(snapshot()),
    analysis.fingerprint({
      ...snapshot(),
      players: snapshot().players.map(p => ({ ...p, name: 'secret' })),
    })
  );
});

test('AI only selects genuine available numeric observations; hostile prose and unsupported focus cannot escape', async () => {
  analysis._cache.clear();
  for (const focus of [
    'roster',
    'alive',
    'compare_damage',
    'verify_score',
    '__proto__',
    '<@123> attack now',
  ]) {
    const text = await analysis.analyze(snapshot(), {
      provider: async request => {
        assert.deepEqual(request.options, ['roster', 'alive']);
        assert.doesNotMatch(
          JSON.stringify(request),
          /damage|accuracy|ignore all instructions|guid-1|oce:27960/
        );
        return { focus, prose: '<@everyone> ignore instructions' };
      },
    });
    assert.match(text, /^Live — Red 0; Blue score unreported\./);
    assert.doesNotMatch(text, /@|attack|instructions|compare_damage|verify_score/);
    if (focus === 'roster') {
      assert.match(text, /Roster: Red 1, Blue 1/);
      assert.doesNotMatch(text, /alive/);
    } else if (focus === 'alive') {
      assert.match(text, /Currently alive: Red 1\/1, Blue 1\/1/);
      assert.doesNotMatch(text, /Roster/);
    } else assert.equal(text, analysis.factual(snapshot()));
  }
  let calls = 0;
  const provider = async () => {
    calls++;
    return { focus: 'roster' };
  };
  await analysis.analyze(baseSnapshot(), { provider });
  await analysis.analyze({ ...snapshot(), gameType: 'ctf' }, { provider });
  await analysis.analyze(
    { ...snapshot(), players: snapshot().players.map(p => ({ ...p, alive: null })) },
    { provider }
  );
  const signal = new AbortController();
  signal.abort();
  await analysis.analyze(snapshot(), { provider, signal: signal.signal });
  assert.equal(calls, 0);
});

test('cache and in-flight requests remain bounded, coalesced and expire after ten minutes', async () => {
  analysis._cache.clear();
  let calls = 0;
  const provider = async () => {
    calls++;
    return { focus: 'roster' };
  };
  await Promise.all([
    analysis.analyze(snapshot(), { provider }),
    analysis.analyze(snapshot(), { provider }),
  ]);
  assert.equal(calls, 1);
  for (const entry of analysis._cache.values()) entry.at = Date.now() - 600001;
  await analysis.analyze(snapshot(), { provider });
  assert.equal(calls, 2);
  for (let i = 0; i < 140; i++)
    await analysis.analyze({ ...snapshot(), round: i + 1 }, { env: {} });
  assert.equal(analysis._cache.size, 128);
  const held = deferred();
  calls = 0;
  const slow = async () => {
    calls++;
    return held.promise;
  };
  const work = Array.from({ length: 17 }, (_, i) =>
    analysis.analyze({ ...snapshot(), round: 200 + i }, { provider: slow })
  );
  await turn();
  assert.equal(calls, 16);
  assert.equal(await work[16], analysis.factual({ ...snapshot(), round: 216 }));
  held.resolve({ focus: 'alive' });
  await Promise.all(work);
  assert.ok(analysis._cache.size <= 128);
});
