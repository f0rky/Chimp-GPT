const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');

function runHook({ lintExit = 0, formatExit = 0 } = {}) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'chimp-hook-fixture-'));
  try {
    const hookDir = path.join(fixture, '.husky');
    const bin = path.join(fixture, 'bin');
    fs.mkdirSync(path.join(hookDir, '_'), { recursive: true });
    fs.mkdirSync(bin);
    fs.copyFileSync(path.join(root, '.husky/pre-commit'), path.join(hookDir, 'pre-commit'));
    // Exercise the installed Husky bootstrap, not a reimplementation of its exit behavior.
    fs.copyFileSync(
      path.join(root, 'node_modules/husky/husky.sh'),
      path.join(hookDir, '_/husky.sh')
    );
    fs.writeFileSync(
      path.join(bin, 'npm'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOOK_CALL_LOG"\n' +
        'case "$*" in\n"run lint") exit "$LINT_EXIT" ;;\n' +
        '"run format:check") exit "$FORMAT_EXIT" ;;\n*) exit 99 ;;\nesac\n',
      { mode: 0o755 }
    );
    // The old hook must fail locally, never fall through to a real package download.
    fs.writeFileSync(path.join(bin, 'npx'), '#!/bin/sh\nexit 98\n', { mode: 0o755 });
    const log = path.join(fixture, 'calls.log');
    const result = spawnSync('/bin/sh', [path.join(hookDir, 'pre-commit')], {
      cwd: fixture,
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: fixture,
        HUSKY: '1',
        HOOK_CALL_LOG: log,
        LINT_EXIT: String(lintExit),
        FORMAT_EXIT: String(formatExit),
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.error, undefined);
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
    return { status: result.status, calls };
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

test('pre-commit runs non-mutating lint and formatting checks in order', () => {
  assert.deepEqual(runHook(), { status: 0, calls: ['run lint', 'run format:check'] });
});

test('pre-commit stops and rejects the commit on lint failure', () => {
  assert.deepEqual(runHook({ lintExit: 7 }), { status: 7, calls: ['run lint'] });
});

test('pre-commit rejects the commit on formatting failure', () => {
  assert.deepEqual(runHook({ formatExit: 9 }), {
    status: 9,
    calls: ['run lint', 'run format:check'],
  });
});

test('manifest and lockfile contain neither lint-staged nor picomatch', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.devDependencies['lint-staged'], undefined);
  assert.equal(pkg['lint-staged'], undefined);
  for (const name of Object.keys(lock.packages)) {
    assert.ok(!/(?:^|\/)(?:lint-staged|picomatch)$/.test(name), `unexpected dependency: ${name}`);
  }
});
