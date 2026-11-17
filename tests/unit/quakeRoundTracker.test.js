'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRoundTracker,
  RETENTION_MS,
  RECONCILE_MS,
} = require('../../src/services/quakeRoundTracker');
const { snapshot } = require('../helpers/slipgateFixtures');
test('round jumps are provisional, deduplicated; archive team_won overrides nullable cumulative score', async () => {
  let time = 0,
    lists = 0,
    details = 0,
    published = false;
  const tracker = createRoundTracker({ now: () => time });
  const client = {
    listMatches: async () => {
      lists++;
      return [{ match_guid: 'guid-1' }];
    },
    getMatch: async () => {
      details++;
      if (!published) throw Object.assign(new Error('Delayed publication'), { status: 404 });
      return {
        match_guid: 'guid-1',
        rated: false,
        aborted: true,
        rounds: [
          { team_won: 2, red_score: null, blue_score: null },
          { team_won: 1, red_score: null, blue_score: null },
        ],
      };
    },
  };
  let s = await tracker.observe(snapshot(), client);
  assert.equal(s.results.length, 1);
  assert.equal(s.results[0].authoritative, false);
  assert.match(s.archiveStatus, /pending/);
  s = await tracker.observe({ ...snapshot(), round: 5 }, client);
  assert.deepEqual(
    s.results.map(r => r.round),
    [2, 5]
  );
  assert.equal(lists, 1);
  assert.equal(details, 1);
  published = true;
  time += RECONCILE_MS;
  s = await tracker.observe({ ...snapshot(), state: 'finished', round: 5 }, client);
  const round = s.results.find(r => r.round === 2);
  assert.equal(round.authoritative, true);
  assert.equal(round.winner, 'Red');
  assert.equal(round.redScore, null);
  assert.equal(round.rated, false);
  assert.equal(round.aborted, true);
  assert.equal(s.results.find(r => r.round === 1).winner, 'Blue');
  await tracker.observe({ ...snapshot(), state: 'finished', round: 5 }, client);
  assert.equal(lists, 2);
  assert.equal(details, 2);
  time += RETENTION_MS;
  assert.equal(tracker.retained(snapshot().address).length, 0);
});
test('GUID change reconciles old GUID; missing GUID, A2S and outage never fabricate winners', async () => {
  let time = 0,
    lists = 0;
  const ids = [];
  const tracker = createRoundTracker({ now: () => time });
  const client = {
    listMatches: async () => {
      lists++;
      return [];
    },
    getMatch: async id => {
      ids.push(id);
      return { match_guid: id, rounds: [{ team_won: null, red_score: 10, blue_score: 2 }] };
    },
  };
  await tracker.observe(snapshot(), client);
  time += RECONCILE_MS;
  const s = await tracker.observe({ ...snapshot(), matchGuid: 'guid-2' }, client);
  assert.deepEqual(ids, ['guid-1', 'guid-2', 'guid-1']);
  assert.equal(
    s.results.filter(r => r.authoritative).every(r => r.winner === null),
    true
  );
  assert.match(
    (await tracker.observe({ ...snapshot(), matchGuid: null }, client)).archiveStatus,
    /No live GUID/
  );
  const n = lists;
  await tracker.observe({ ...snapshot(), quality: { a2sOnly: true } }, client);
  assert.equal(lists, n);
  time += RECONCILE_MS;
  const outage = await tracker.observe(snapshot(), {
    listMatches: async () => {
      throw Error('offline');
    },
  });
  assert.match(outage.archiveStatus, /unavailable/);
});
