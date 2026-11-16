'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../../src/services', name), 'utf8');
test('Slipgate session namespaces use collision-resistant tokens rather than Math.random', () => {
  const s = source('slipgateClient.js');
  assert.doesNotMatch(s, /Math\.random\(/);
  assert.match(s, /require\('node:crypto'\)/);
  assert.equal((s.match(/randomUUID\(\)/g) || []).length, 2);
});
test('Slipgate canonical string keys and Steam IDs use explicit string comparison', () => {
  const s = source('slipgateClient.js');
  assert.doesNotMatch(s, /\.sort\(\)/);
  assert.match(s, /localeCompare/);
});
test('watch shutdown signal handles its non-awaited promise rejection', () => {
  assert.match(source('quakeLiveWatch.js'), /manager\.shutdown\(\)\.catch/);
});
test('actual shutdown listener consumes rejection without exposing exception details', async () => {
  const vm = require('node:vm');
  const handlers = new Map(),
    errors = [];
  const mocks = {
    crypto: require('node:crypto'),
    './slipgateClient': { budgetPolicy: () => ({}), defaultClient: {} },
    './quakeRoundTracker': { defaultTracker: {} },
    '../handlers/slipgateCardRenderer': { renderSlipgateCard: () => {} },
    './scoreboardLifecycle': { createScoreboardLifecycle: () => {} },
  };
  const sandbox = {
    require: name => {
      assert.ok(Object.hasOwn(mocks, name), name);
      return mocks[name];
    },
    module: { exports: {} },
    process: { prependOnceListener: (signal, callback) => handlers.set(signal, callback) },
    console: { error: message => errors.push(message) },
    setTimeout: () => {
      throw new Error('unexpected timer');
    },
    clearTimeout: () => {
      throw new Error('unexpected timer cleanup');
    },
  };
  vm.runInNewContext(
    source('quakeLiveWatch.js') + '\nmodule.exports.testManager = manager;',
    sandbox
  );
  assert.equal(handlers.size, 4);
  let calls = 0;
  sandbox.module.exports.testManager.shutdown = async () => {
    calls++;
    throw new Error('SECRET-FIXTURE-DETAIL');
  };
  handlers.get('SIGTERM')();
  assert.equal(calls, 1);
  await Promise.resolve();
  assert.deepEqual(errors, ['Quake watch shutdown did not complete.']);
});
