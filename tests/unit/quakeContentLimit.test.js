const assert = require('node:assert/strict');
const test = require('node:test');

const { limitQuakeContent } = require('../../src/utils/quakeContentLimit');

test('repairs a short malformed Quake code fence', () => {
  const content = limitQuakeContent('```\nshort incomplete fence');

  assert.equal((content.match(/```/g) || []).length % 2, 0);
  assert.match(content, /short incomplete fence/);
});

test('bounds a Quake result without breaking a code fence', () => {
  const content = limitQuakeContent(`\`\`\`\n${'server row\n'.repeat(300)}\`\`\``);

  assert.ok(content.length <= 2000);
  assert.equal((content.match(/```/g) || []).length % 2, 0);
  assert.match(content, /stats omitted/i);
});
