'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommand } = require('../../src/commands/modules/gaunt');
const { createRivalryService } = require('../../src/services/quakeRivalryService');
const A = '76561198000000001',
  B = '76561198000000002';
function setup() {
  const replies = [],
    requests = [];
  const snapshot = {
    address: 'example:27960',
    matchGuid: 'fixture-guid',
    state: 'warmup',
    map: 'campgrounds',
    gameType: 'ca',
    ratingSet: 'A',
    players: [
      { steamId: A, name: 'Alpha', team: 1 },
      { steamId: B, name: 'Beta', team: 2 },
    ],
  };
  let current = snapshot;
  const service = createRivalryService({
    now: () => 1800000000000,
    community: {
      getPlayers: async ids => {
        requests.push(ids);
        return { players: ids.map(steam_id => ({ steam_id, pummels: { total: 4, victims: [] } })) };
      },
    },
    slipgate: {
      request: async () => ({
        data: {
          steam_id_a: A,
          steam_id_b: B,
          shared: 3,
          as_teammates: 0,
          as_opponents: 3,
          by_game_type: [{ game_type: 'ca', wins_a: 2, wins_b: 1, decided: 3 }],
        },
      }),
    },
  });
  const watches = { snapshot: () => current };
  const message = {
    guild: { id: 'guild' },
    guildId: 'guild',
    channelId: 'channel',
    client: { user: { id: 'bot' } },
    author: { id: 'user' },
    reply: async payload => {
      replies.push(payload);
      return payload;
    },
  };
  return {
    snapshot,
    watches,
    service,
    message,
    replies,
    requests,
    set: s => {
      current = s;
    },
  };
}
test('production command and collector interoperate for no-argument roster and numeric opposing teams', async () => {
  const f = setup();
  const command = createCommand({
    watches: f.watches,
    service: f.service,
    rateLimit: async () => ({ allowed: true }),
  });
  await command.execute(f.message, []);
  assert.equal(f.requests.length, 1);
  assert.ok(f.replies[0].embeds, 'no-argument roster reaches actual renderer');
  await command.execute(f.message, [A, B]);
  assert.ok(f.replies[1].embeds, 'numeric Red/Blue comparison reaches actual renderer');
  assert.match(JSON.stringify(f.replies[1].embeds[0].toJSON()), /Head.to.head/);
});
test('default command loads the actual watch module snapshot export lazily', async t => {
  const f = setup();
  const exported = require('../../src/services/quakeLiveWatch');
  const original = exported.snapshot;
  exported.snapshot = () => f.snapshot;
  t.after(() => {
    if (original) exported.snapshot = original;
    else delete exported.snapshot;
  });
  const command = createCommand({ service: f.service, rateLimit: async () => ({ allowed: true }) });
  await command.execute(f.message, [A]);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0], [A]);
  assert.ok(f.replies[0].embeds);
});
test('a watch replaced during admission cannot query providers or publish stale evidence', async () => {
  const f = setup();
  const command = createCommand({
    watches: f.watches,
    service: f.service,
    rateLimit: async () => {
      f.set(null);
      return { allowed: true };
    },
  });
  await command.execute(f.message, [A]);
  assert.equal(f.requests.length, 0);
  assert.match(f.replies[0].content, /changed|stopped|active/i);
});
test('roster collection excludes spectator and private IDs at the actual provider boundary', async () => {
  const f = setup();
  f.snapshot.players.push({ steamId: '76561198000000003', name: 'Spectator', team: 3 });
  f.snapshot.players.push({
    steamId: '76561198000000004',
    name: 'Private',
    team: 1,
    private: true,
  });
  const command = createCommand({
    watches: f.watches,
    service: f.service,
    rateLimit: async () => ({ allowed: true }),
  });
  await command.execute(f.message, []);
  assert.deepEqual(f.requests, [[A, B]]);
});
test('actual allowed=false rate contract refuses before providers', async () => {
  const f = setup();
  const command = createCommand({
    watches: f.watches,
    service: f.service,
    rateLimit: async () => ({ allowed: false }),
  });
  await command.execute(f.message, []);
  assert.equal(f.requests.length, 0);
  assert.match(f.replies[0].content, /rate limit/i);
});
