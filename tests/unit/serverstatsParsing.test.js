const assert = require('node:assert/strict');
const test = require('node:test');

const { parseTextArguments } = require('../../src/commands/modules/serverstats');
const { validateServerInput } = require('../../src/utils/inputValidator');

test('parses a multiword server filter followed by ELO mode', () => {
  assert.deepEqual(parseTextArguments(['My', 'Server', '2']), {
    serverFilter: 'My Server',
    eloMode: 2,
  });
  assert.equal(validateServerInput('My Server').isValid, true);
});

test('preserves one-word server behavior', () => {
  assert.deepEqual(parseTextArguments(['duel']), { serverFilter: 'duel', eloMode: null });
});
