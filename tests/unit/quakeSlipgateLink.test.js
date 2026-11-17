const assert = require('node:assert/strict');
const test = require('node:test');

const quakeLookup = require('../../src/services/quakeLookup');

test('Slipgate-backed server responses include the verified Slipgate server page link', () => {
  const response = quakeLookup._test.formatServerResponse(
    {
      serverName: 'Oceania Test',
      currentMap: 'campgrounds',
      gameType: 'Clan Arena',
      playerCount: '2/16',
      uptime: '2 minutes',
      teamScores: { red: 1, blue: 0 },
      players: [],
      source: 'slipgate',
      address: 'oce-high:27960',
      sourceUrl: 'https://invalid.example/ignored',
    },
    null
  );

  assert.match(
    response.formatted,
    /```\n\[View on Slipgate\]\(<https:\/\/slipgate\.gg\/servers\/oce-high%3A27960>\)$/
  );
});

test('preserves the canonical angle-wrapped Slipgate URL after output sanitization', () => {
  const output = quakeLookup._test.sanitizeQuakeOutput(
    '[View on Slipgate](<https://slipgate.gg/servers/thepurgery.com%3A27960>)'
  );

  assert.equal(output, '[View on Slipgate](<https://slipgate.gg/servers/thepurgery.com%3A27960>)');
});

test('provider text cannot close the stats fence or create an active Discord mention', () => {
  const serverStats = quakeLookup._test.extractServerStats({
    address: 'oce:27960',
    info: {
      serverName: '``` @everyone',
      map: 'map``` @here',
      players: '``` @everyone',
      maxPlayers: '@here',
      gameTypeShort: 'CA',
      gameType: 'Clan Arena',
    },
    rules: {
      g_levelStartTime: String(Math.floor(Date.now() / 1000)),
      g_redScore: '``` @everyone',
      g_blueScore: '@here',
      roundlimit: '``` @everyone',
    },
    players: [{ name: '```@everyone', score: '``` @here', team: 1 }],
  });
  const response = quakeLookup._test.formatServerResponse(serverStats, null).formatted;

  assert.equal((response.match(/```/g) || []).length, 2);
  assert.doesNotMatch(response, /@(everyone|here)/);
  assert.match(response, /@\u200beveryone/);
});

test('upstream source fields cannot make a Syncore fallback appear as Slipgate', () => {
  const stats = quakeLookup._test.extractServerStats(
    {
      address: 'syncore.example:27960',
      source: 'slipgate',
      info: { serverName: 'Fallback', map: 'campgrounds', players: 0, maxPlayers: 16 },
      rules: { g_levelStartTime: '0', g_redScore: 0, g_blueScore: 0 },
      players: [],
    },
    'syncore'
  );
  const response = quakeLookup._test.formatServerResponse(stats, null).formatted;

  assert.equal(stats.source, 'syncore');
  assert.doesNotMatch(response, /View on Slipgate/);
});

test('non-Slipgate fallback responses do not claim a Slipgate source link', () => {
  const response = quakeLookup._test.formatServerResponse(
    {
      serverName: 'Fallback Test',
      currentMap: 'campgrounds',
      gameType: 'Clan Arena',
      playerCount: '0/16',
      uptime: '0 seconds',
      teamScores: { red: 0, blue: 0 },
      players: [],
      sourceUrl: 'https://malicious.example/not-slipgate',
    },
    null
  );

  assert.doesNotMatch(response.formatted, /View on Slipgate/);
});
