'use strict';
const { validSlipgateAddress } = require('./slipgateClient');
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RECONCILE_MS = 120000;
const validGuid = g => typeof g === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(g);
const numeric = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function createRoundTracker({ now = Date.now } = {}) {
  const results = new Map(),
    servers = new Map(),
    pending = new Map();
  function prune() {
    for (const [k, r] of results) if (now() - r.retainedAt >= RETENTION_MS) results.delete(k);
    for (const [k, s] of servers) if (now() - s.lastSeen >= RETENTION_MS) servers.delete(k);
    while (results.size > 2048) results.delete(results.keys().next().value);
    while (servers.size > 64) servers.delete(servers.keys().next().value);
  }
  function retained(address) {
    prune();
    return [...results.values()]
      .filter(r => r.address === address)
      .slice(-64)
      .map(r => ({ ...r }));
  }
  async function observe(snapshot, client) {
    prune();
    const address = snapshot.address;
    if (!validSlipgateAddress(address))
      return {
        ...snapshot,
        results: [],
        archiveStatus: 'Invalid server address; no archive lookup.',
      };
    let state = servers.get(address);
    if (!state) {
      state = {
        guid: null,
        phase: null,
        lastSeen: now(),
        next: 0,
        guids: new Map(),
        status: 'Archive not yet checked.',
      };
      servers.set(address, state);
    }
    state.lastSeen = now();
    if (snapshot.stale || snapshot.quality?.a2sOnly)
      return {
        ...snapshot,
        results: retained(address),
        archiveStatus: 'Archive reconciliation paused: stale or A2S-only snapshot.',
      };
    const guid = validGuid(snapshot.matchGuid) ? snapshot.matchGuid : null;
    const changed = guid && guid !== state.guid;
    const final = /^(finished|final|postgame|intermission|ended)$/i.test(snapshot.state || '');
    const finalEdge = final && state.phase !== snapshot.state;
    if (guid) {
      state.guids.set(guid, state.guids.get(guid) || { next: 0, done: false });
      while (state.guids.size > 16) state.guids.delete(state.guids.keys().next().value);
      if (Number.isInteger(snapshot.round) && snapshot.round >= 0) {
        const key = `${address}|${guid}|${snapshot.round}`;
        if (!results.has(key))
          results.set(key, {
            address,
            guid,
            round: snapshot.round,
            authoritative: false,
            winner: null,
            redScore: null,
            blueScore: null,
            observed: true,
            retainedAt: now(),
          });
        else results.get(key).observed = true;
      }
    }
    state.guid = guid;
    state.phase = snapshot.state;
    if (pending.has(address)) await pending.get(address);
    if (now() >= state.next || changed || finalEdge) {
      const work = (async () => {
        // Bound archive traffic: one list and at most two details per cadence/edge.
        state.next = now() + RECONCILE_MS;
        try {
          const listed = await client.listMatches(address);
          const candidates = new Set([...state.guids.keys()].reverse());
          for (const match of listed.slice(0, 50))
            if (validGuid(match.match_guid) && (!match.server || match.server === address))
              candidates.add(match.match_guid);
          let attempts = 0;
          for (const id of candidates) {
            const memo = state.guids.get(id) || { next: 0, done: false };
            if (memo.done || now() < memo.next || attempts >= 2) continue;
            attempts++;
            memo.next = now() + RECONCILE_MS;
            state.guids.set(id, memo);
            try {
              const match = await client.getMatch(id);
              if ((match.match_guid && match.match_guid !== id) || !Array.isArray(match.rounds))
                throw new Error('Archive mismatch');
              const rounds = match.rounds.slice(0, 128);
              for (const [i, round] of rounds.entries()) {
                const n = Number.isInteger(round.round) ? round.round : i + 1;
                const key = `${address}|${id}|${n}`;
                const winner = [1, 'red'].includes(round.team_won)
                  ? 'Red'
                  : [2, 'blue'].includes(round.team_won)
                    ? 'Blue'
                    : null;
                results.set(key, {
                  address,
                  guid: id,
                  round: n,
                  authoritative: true,
                  winner,
                  redScore: numeric(round.red_score),
                  blueScore: numeric(round.blue_score),
                  observed: results.get(key)?.observed || false,
                  rated: typeof match.rated === 'boolean' ? match.rated : null,
                  aborted: typeof match.aborted === 'boolean' ? match.aborted : null,
                  retainedAt: results.get(key)?.retainedAt ?? now(),
                });
              }
              // An archive for a currently live GUID may still be incomplete.
              memo.done = id !== guid && rounds.length > 0;
              state.status =
                'Archive reconciled; winners use team_won only. Coverage is partial; memory only.';
            } catch (error) {
              state.status =
                error.status === 404
                  ? 'Archive publication pending (404); retry on a later cadence.'
                  : 'Archive unavailable; observations remain provisional.';
            }
          }
          while (state.guids.size > 16) state.guids.delete(state.guids.keys().next().value);
        } catch (_) {
          state.status = 'Archive unavailable; observations remain provisional.';
        }
      })();
      pending.set(address, work);
      try {
        await work;
      } finally {
        pending.delete(address);
      }
    }
    prune();
    return {
      ...snapshot,
      results: retained(address),
      archiveStatus: guid
        ? state.status
        : 'No live GUID; no round identity inferred. Archive coverage is partial.',
    };
  }
  return { observe, retained, _results: results, _servers: servers };
}
const defaultTracker = createRoundTracker();
module.exports = { createRoundTracker, defaultTracker, RETENTION_MS, RECONCILE_MS };
