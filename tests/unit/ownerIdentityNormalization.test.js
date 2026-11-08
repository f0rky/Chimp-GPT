/**
 * maliciousUserManager.isOwner normalization tests.
 *
 * Loads the actual module source with explicit stubs for every dependency and an
 * in-memory fixture env; `fs` is stubbed to throw so no data file can be touched.
 *
 * Usage: node tests/unit/ownerIdentityNormalization.test.js [--selftest]
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE_PATH = path.resolve(__dirname, '../../src/utils/maliciousUserManager.js');
const OWNER_ID = '111111111111111111';

function forbidden(name) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`Hermetic test: ${name}.${String(prop)} must not be used`);
      },
    }
  );
}

function loadManager(env) {
  const noop = () => undefined;
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop };
  class StubError extends Error {}
  const stubs = {
    fs: { promises: forbidden('fs.promises') },
    path,
    '../core/logger': { createLogger: () => logger },
    './humanCircuitBreaker': forbidden('humanCircuitBreaker'),
    './contextExtractionService': { contextExtractionService: forbidden('contextExtraction') },
    '../core/errors': { AuthorizationError: StubError, NotFoundError: StubError },
    './inputValidator': { validateStatusUpdateData: forbidden('inputValidator') },
  };
  const hermeticRequire = spec => {
    if (!Object.prototype.hasOwnProperty.call(stubs, spec)) {
      throw new Error(`Hermetic test: unstubbed require "${spec}"`);
    }
    return stubs[spec];
  };
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname, process) {${source}\n})`,
    { filename: MODULE_PATH }
  );
  const mod = { exports: {} };
  wrapper.call(
    mod.exports,
    mod.exports,
    hermeticRequire,
    mod,
    MODULE_PATH,
    path.dirname(MODULE_PATH),
    { env }
  );
  return mod.exports;
}

test('isOwner never authorizes undefined/empty callers when OWNER_ID is unset or blank', () => {
  for (const env of [{}, { OWNER_ID: '' }, { OWNER_ID: '   ' }]) {
    const manager = loadManager(env);
    for (const caller of [undefined, null, '', '   ', 'undefined']) {
      assert.equal(
        manager.isOwner(caller),
        false,
        `isOwner(${JSON.stringify(caller)}) with env ${JSON.stringify(env)}`
      );
    }
  }
});

test('isOwner trims both sides and matches only the configured owner', () => {
  const manager = loadManager({ OWNER_ID: `  ${OWNER_ID}\n` });
  assert.equal(manager.isOwner(OWNER_ID), true);
  assert.equal(manager.isOwner(` ${OWNER_ID} `), true);
  assert.equal(manager.isOwner('222222222222222222'), false);
  assert.equal(manager.isOwner(undefined), false);
  assert.equal(manager.isOwner(''), false);
});

if (process.argv.includes('--selftest')) {
  process.on('exit', code => {
    if (code === 0) {
      console.log('SELFTEST PASS: isOwner trims IDs and rejects missing owner configuration');
    } else {
      console.error(`SELFTEST FAIL: owner identity normalization tests failed (exit ${code})`);
    }
  });
}
