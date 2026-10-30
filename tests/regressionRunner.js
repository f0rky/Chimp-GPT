const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const unitDir = path.join(__dirname, 'unit');
const files = fs.readdirSync(unitDir).filter(name => name.endsWith('.test.js'));
const nodeTests = files.filter(name =>
  fs.readFileSync(path.join(unitDir, name), 'utf8').includes('node:test')
);
const mochaTests = files.filter(name => !nodeTests.includes(name));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chimp-regression-'));
const preload = path.join(__dirname, 'helpers/offlineEnvironment.js');
try {
  for (const [runner, tests] of [
    [['--test', '--test-concurrency=1', '--test-timeout=30000'], nodeTests],
    [[require.resolve('mocha/bin/mocha.js'), '--timeout', '15000'], mochaTests],
  ]) {
    if (!tests.length) continue;
    const result = spawnSync(
      process.execPath,
      ['--require', preload, ...runner, ...tests.map(name => path.join(unitDir, name))],
      {
        cwd,
        stdio: 'inherit',
        timeout: 180000,
      }
    );
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) process.exitCode = 1;
  }
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
