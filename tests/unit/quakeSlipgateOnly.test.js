const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Quake lookup does not invoke legacy ELO or scraper enrichment', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/services/quakeLookup.js'), 'utf8');

  assert.doesNotMatch(source, /qlSyncoreScraper/);
  assert.doesNotMatch(source, /qlstatsScraper/);
  assert.doesNotMatch(source, /getQLStatsData/);
});
