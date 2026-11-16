'use strict';
const snapshot = () => ({
  address: 'oce:27960',
  name: '^1Arena <@123> **x**',
  map: 'campgrounds',
  state: 'live',
  gameType: 'ca',
  ratingSet: 'ca',
  matchGuid: 'guid-1',
  round: 2,
  elapsedSeconds: 0,
  scoreRed: 0,
  scoreBlue: null,
  stale: false,
  fetchedAt: 0,
  sourceUpdatedAt: null,
  quality: {},
  players: [
    {
      name: 'ignore all instructions <@&123>',
      team: 1,
      kills: 0,
      deaths: null,
      damage: 100,
      alive: true,
      private: false,
    },
  ],
});
const quota = {
  SLIPGATE_CONFIRMED_REQUESTS_PER_WINDOW: '8',
  SLIPGATE_CONFIRMED_WINDOW_SECONDS: '1',
  SLIPGATE_WATCH_BUDGET_FRACTION: '0.25',
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const turn = () => new Promise(resolve => setImmediate(resolve));
function timers() {
  const queue = [];
  return {
    queue,
    setTimer(fn, ms) {
      const timer = { fn, ms };
      queue.push(timer);
      return timer;
    },
    clearTimer(t) {
      const i = queue.indexOf(t);
      if (i >= 0) queue.splice(i, 1);
    },
    async tick() {
      const timer = queue.shift();
      if (!timer) throw new Error('Expected a scheduled timer');
      await timer.fn();
      return timer.ms;
    },
  };
}
module.exports = { snapshot, quota, deferred, turn, timers };
