'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommand } = require('../../src/commands/modules/quakestats');
test('watch start confirmation is brief and retains a stop instruction without internal quota prose', async () => {
  const replies = [];
  let starts = 0;
  const command = createCommand({
    client: {
      pollingPolicy: () => ({
        enabled: true,
        budgetLabel: 'experimental local budget; provider quota unconfirmed',
      }),
    },
    manager: {
      status: () => null,
      start: () => {
        starts++;
        return { ok: true };
      },
    },
    rateLimit: async () => ({ limited: false }),
  });
  await command.execute(
    {
      guild: {},
      guildId: 'guild',
      channelId: 'channel',
      channel: {},
      member: { permissions: { has: () => true } },
      author: { id: '123' },
      reply: async text => replies.push(text),
    },
    ['purgery']
  );
  assert.equal(starts, 1);
  assert.deepEqual(replies, ['👀 Watch started — fetching scoreboard. Stop: !quakestats stop.']);
  assert.ok(replies[0].length < 100);
});
