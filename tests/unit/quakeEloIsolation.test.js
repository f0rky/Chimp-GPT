const assert = require('node:assert/strict');
const test = require('node:test');

const { getEloMode, runWithEloMode } = require('../../src/utils/quakeEloContext');

test('keeps parallel ELO settings request-local and defaults missing mode', async () => {
  const [off, values] = await Promise.all([
    runWithEloMode(0, async () => {
      await new Promise(resolve => setImmediate(resolve));
      return getEloMode();
    }),
    runWithEloMode(2, async () => {
      await new Promise(resolve => setImmediate(resolve));
      return getEloMode();
    }),
  ]);

  assert.equal(off, 0);
  assert.equal(values, 2);
  assert.equal(getEloMode(), 1);
});
