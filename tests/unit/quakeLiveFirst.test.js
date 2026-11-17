'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWatchManager } = require('../../src/services/quakeLiveWatch');
const { createRoundTracker } = require('../../src/services/quakeRoundTracker');
const { snapshot, timers, deferred, turn } = require('../helpers/slipgateFixtures');
function fixture(tracker) {
  const clock = timers(),
    cards = [],
    edits = [];
  let s = { ...snapshot(), ratingSet: 'B', matchGuid: 'old', map: 'old-map' };
  let reads = 0,
    archives = 0,
    lists = 0;
  const client = {
    pollingPolicy: () => ({ enabled: true, minIntervalMs: 20000 }),
    selectServer: async () => {
      reads++;
      return s;
    },
    getServer: async () => {
      reads++;
      return s;
    },
    listMatches: async () => {
      lists++;
      return [];
    },
    getMatch: async () => {
      archives++;
      return archive();
    },
  };
  const channel = {
    send: async body => {
      const c = {
        body,
        edit: async b => {
          c.body = b;
          edits.push({ card: c, body: b });
        },
        delete: async () => {},
      };
      cards.push(c);
      return c;
    },
  };
  const manager = createWatchManager({ ...clock, tracker });
  return {
    clock,
    cards,
    edits,
    client,
    channel,
    manager,
    set: v => {
      s = { ...s, ...v };
    },
    reads: () => reads,
    archives: () => archives,
    lists: () => lists,
    start: () => manager.start('test', { channel, client }),
  };
}
function archive() {
  return {
    ok: true,
    match_guid: 'old',
    game_type: 'ca',
    rating_set: 'B',
    server: { addr: 'oce:27960' },
    ended_at: '2026-11-15T00:46:11Z',
    players: [],
    team_red_score: 10,
    team_blue_score: 7,
    rounds: [],
  };
}
const text = card => card.body.embeds[0].toJSON().description;
const flush = async () => {
  await turn();
  await turn();
};
test('fresh card and next timer are delivered before deferred round history completes', async () => {
  const gate = deferred();
  let entered = 0;
  const f = fixture(createRoundTracker({ now: () => 0 }));
  f.client.listMatches = async () => {
    entered++;
    await gate.promise;
    return [];
  };
  f.start();
  const tick = f.clock.tick();
  try {
    await flush();
    assert.equal(f.cards.length, 1, 'archive history must not block the first card');
    assert.match(text(f.cards[0]), /LIVE/);
    assert.equal(entered, 1);
    assert.equal(f.clock.queue.length, 1, 'next live timer must not wait for history');
    assert.equal(f.clock.queue[0].ms, 60000);
  } finally {
    gate.resolve();
    await tick;
    await flush();
    await f.manager.stopAll();
  }
});
test('pending old archive never blocks warmup promotion or overwrites the new match', async () => {
  const gate = deferred();
  let entered = 0;
  const f = fixture({ observe: async s => s });
  f.start();
  await f.clock.tick();
  await flush();
  f.client.getMatch = async () => {
    entered++;
    return gate.promise;
  };
  f.set({ state: 'warmup', matchGuid: null });
  const boundary = f.clock.tick();
  try {
    await flush();
    assert.equal(f.cards.length, 2, 'new warmup card must precede old archive completion');
    assert.match(text(f.cards[0]), /FINAL/);
    assert.match(text(f.cards[1]), /WARMUP/);
    assert.equal(entered, 1);
    f.set({ state: 'live', matchGuid: 'new', map: 'new-map', scoreRed: 1, scoreBlue: 3 });
    await f.clock.tick();
    assert.equal(f.cards.length, 2);
    assert.match(text(f.cards[1]), /LIVE[\s\S]*new-map/);
    gate.resolve(archive());
    await boundary;
    await flush();
    assert.match(text(f.cards[0]), /Archived result confirmed/);
    assert.match(text(f.cards[1]), /LIVE[\s\S]*new-map/);
  } finally {
    gate.resolve(archive());
    await boundary;
    await flush();
    await f.manager.stopAll();
  }
});
test('maintenance stays single-flight while fresh polls continue', async () => {
  const gate = deferred();
  let calls = 0;
  const f = fixture({
    observe: async s => {
      calls++;
      await gate.promise;
      return s;
    },
  });
  f.start();
  const first = f.clock.tick();
  try {
    await flush();
    assert.equal(f.clock.queue.length, 1);
    for (const score of [1, 2, 3]) {
      f.set({ scoreRed: score });
      await f.clock.tick();
    }
    assert.equal(f.reads(), 4);
    assert.equal(calls, 1);
    assert.match(f.cards[0].body.embeds[0].toJSON().fields[0].name, /· 3/);
  } finally {
    gate.resolve();
    await first;
    await flush();
    await f.manager.stopAll();
  }
});
test('optional history failures never consume the live transport failure budget', async () => {
  const f = fixture({
    observe: async () => {
      throw Error('optional history outage');
    },
  });
  f.start();
  try {
    for (const score of [1, 2, 3, 4]) {
      f.set({ scoreRed: score });
      await f.clock.tick();
      await flush();
    }
    assert.equal(f.reads(), 4);
    assert.ok(f.manager.status('test'));
    assert.equal(f.manager._watches.get('test').failures, 0);
  } finally {
    await f.manager.stopAll();
  }
});
test('archive and live Discord writes serialize instead of overlapping', async () => {
  const archiveGate = deferred(),
    liveGate = deferred();
  const f = fixture({ observe: async s => s });
  let busy = 0,
    peak = 0,
    archiveWrites = 0;
  f.start();
  await f.clock.tick();
  await flush();
  f.client.getMatch = async () => archiveGate.promise;
  f.set({ state: 'warmup', matchGuid: null });
  await f.clock.tick();
  await flush();
  const oldEdit = f.cards[0].edit,
    currentEdit = f.cards[1].edit;
  f.cards[0].edit = async body => {
    busy++;
    peak = Math.max(peak, busy);
    archiveWrites++;
    try {
      return await oldEdit(body);
    } finally {
      busy--;
    }
  };
  f.cards[1].edit = async body => {
    busy++;
    peak = Math.max(peak, busy);
    try {
      await liveGate.promise;
      return await currentEdit(body);
    } finally {
      busy--;
    }
  };
  f.set({ state: 'live', matchGuid: 'new', map: 'new-map' });
  const tick = f.clock.tick();
  try {
    await flush();
    assert.equal(busy, 1);
    archiveGate.resolve(archive());
    await flush();
    assert.equal(archiveWrites, 0, 'historical edit must wait behind active live write');
    liveGate.resolve();
    await tick;
    await flush();
    assert.equal(archiveWrites, 1);
    assert.equal(peak, 1);
    assert.match(text(f.cards[1]), /new-map/);
  } finally {
    archiveGate.resolve(archive());
    liveGate.resolve();
    await tick;
    await flush();
    await f.manager.stopAll();
  }
});
test('stopping a pending real round-history lookup prevents further detail requests', async () => {
  const gate = deferred();
  const f = fixture(createRoundTracker({ now: () => 0 }));
  f.client.listMatches = async () => gate.promise;
  f.start();
  const tick = f.clock.tick();
  try {
    await flush();
    assert.equal(f.cards.length, 1);
    await f.manager.stop('test');
    gate.resolve([]);
    await tick;
    await flush();
    assert.equal(f.archives(), 0);
    assert.equal(f.clock.queue.length, 0);
  } finally {
    gate.resolve([]);
    await tick;
    await flush();
    await f.manager.stopAll();
  }
});
test('stop prevents late optional archive writes and subsequent history work', async () => {
  const gate = deferred();
  let tracked = 0;
  const f = fixture({
    observe: async s => {
      tracked++;
      return s;
    },
  });
  f.start();
  await f.clock.tick();
  await flush();
  f.client.getMatch = async () => gate.promise;
  f.set({ state: 'warmup', matchGuid: null });
  const boundary = f.clock.tick();
  try {
    await flush();
    assert.equal(f.cards.length, 2);
    await f.manager.stop('test');
    const edits = f.edits.length,
      beforeTracked = tracked;
    gate.resolve(archive());
    await boundary;
    await flush();
    assert.equal(f.edits.length, edits);
    assert.equal(tracked, beforeTracked);
    assert.equal(f.clock.queue.length, 0);
    assert.equal(f.cards.length, 2);
  } finally {
    gate.resolve(archive());
    await boundary;
    await flush();
    await f.manager.stopAll();
  }
});
