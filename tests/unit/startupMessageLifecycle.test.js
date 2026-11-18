const assert = require('node:assert/strict');
const test = require('node:test');

const startupCoordinator = require('../../src/utils/startupMessageCoordinator');
const { _test } = startupCoordinator;

test.after(() => startupCoordinator.reset());

test('startup restart counter begins at one and increments persisted values safely', () => {
  assert.equal(_test.nextRestartCount({}), 1);
  assert.equal(_test.nextRestartCount({ restartCount: 11 }), 12);
  assert.equal(_test.nextRestartCount({ restartCount: '3' }), 4);
  assert.equal(_test.nextRestartCount({ restartCount: -1 }), 1);
  assert.equal(_test.nextRestartCount({ restartCount: 'invalid' }), 1);
});

test('only a new process session increments the restart count and changes its start time', () => {
  startupCoordinator.reset();
  const startedAt = new Date('2026-09-13T00:55:24.000Z');
  const first = _test.initializeSession({ restartCount: 11 }, startedAt);
  const later = _test.initializeSession({ restartCount: 99 }, new Date('2026-09-14T00:00:00.000Z'));

  assert.equal(first.restartCount, 12);
  assert.equal(first.sessionStartTime.toISOString(), '2026-09-13T00:55:24.000Z');
  assert.equal(later.restartCount, 12);
  assert.equal(later.sessionStartTime.toISOString(), '2026-09-13T00:55:24.000Z');
});

test('startup lifecycle fields expose started time and restart number', () => {
  startupCoordinator.reset();
  _test.initializeSession({}, new Date('2026-09-13T00:55:24.000Z'));
  const fields = _test.lifecycleFields({ includeLastChecked: true });
  assert.deepEqual(
    fields.map(field => field.name),
    ['Started at', 'Restart number', 'Last checked']
  );
  assert.match(fields[0].value, /\d/);
  assert.equal(fields[1].value, '1');
  assert.match(fields[2].value, /\d/);
});
