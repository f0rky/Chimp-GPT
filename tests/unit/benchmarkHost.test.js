const assert = require('node:assert/strict');
const test = require('node:test');
const { parsePort, main } = require('../../scripts/benchmarkHost');

test('host benchmark accepts only valid numeric loopback ports', () => {
  assert.equal(parsePort(), 3007);
  assert.equal(parsePort('65535'), 65535);
  for (const value of ['0', '65536', '-1', '3007/path', 'http://example.com', '3007.5', '3007\n']) {
    assert.throws(() => parsePort(value), /local port/);
  }
});

test('host benchmark rejects a destination path instead of writing arbitrary files', async () => {
  await assert.rejects(main(['3007', '/tmp/report.json']), /Usage:/);
});
