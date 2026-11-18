const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');

function runRunner(args, status = 0) {
  const calls = [];
  const fakeProcess = { argv: ['node', 'runner', ...args], execPath: 'node', exitCode: 0 };
  const stubs = {
    'node:fs': {
      readdirSync: () => ['sample.test.js', 'mocha.test.js'],
      readFileSync: file => (file.includes('sample') ? "require('node:test')" : ''),
      mkdtempSync: () => '/fixture-cwd',
      rmSync() {},
    },
    'node:os': { tmpdir: () => '/fixture-temp' },
    'node:path': path,
    'node:child_process': {
      spawnSync: (...call) => {
        calls.push(call);
        return { status };
      },
    },
  };
  const fakeRequire = name => {
    assert.ok(Object.hasOwn(stubs, name), `unexpected dependency: ${name}`);
    return stubs[name];
  };
  fakeRequire.resolve = () => '/fixture/mocha.js';
  vm.runInNewContext(fs.readFileSync(path.join(root, 'tests/regressionRunner.js'), 'utf8'), {
    require: fakeRequire,
    __dirname: path.join(root, 'tests'),
    process: fakeProcess,
    console: { log() {}, error() {} },
  });
  return { calls, process: fakeProcess };
}

test('coverage mode instruments node-test suites without passing Node flags to Mocha', () => {
  const { calls } = runRunner(['--coverage']);
  assert.equal(calls.length, 2);
  assert.ok(calls[0][1].includes('--experimental-test-coverage'));
  assert.ok(!calls[1][1].includes('--experimental-test-coverage'));
  assert.equal(runRunner([]).calls[0][1].includes('--experimental-test-coverage'), false);
});

test('coverage mode retains failed child exit status', () => {
  assert.equal(runRunner(['--coverage'], 1).process.exitCode, 1);
});

test('legacy comprehensive report labels declared inventory as unmeasured', () => {
  const source = fs.readFileSync(path.join(root, 'tests/comprehensiveTestRunner.js'), 'utf8');
  const definition = source.match(/class CoverageTracker \{[\s\S]*?\n\}/)[0];
  const tracker = vm.runInNewContext(`${definition}; new CoverageTracker()`);
  tracker.totalFiles = 10;
  tracker.addCoveredFile('src/fixture.js');
  const report = tracker.generateCoverageReport();
  assert.equal(report.measured, false);
  assert.equal(report.measurement, 'declared-file-inventory');
  assert.equal(report.coveragePercentage, undefined);
  assert.equal(report.declaredFilePercentage, '10.0');
  assert.ok(!source.includes('Coverage meets 70% target'));
});
