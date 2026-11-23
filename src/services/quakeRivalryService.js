'use strict';
const { buildEvidence } = require('./gauntAnalysis');
const { validSteamId } = require('./purgeryClient');
const clone = value => JSON.parse(JSON.stringify(value));
function createRivalryService({ slipgate, community, now = Date.now } = {}) {
  const cache = new Map(),
    flights = new Map();
  async function collect(
    snapshot,
    { pairIds, archive = null, window = 20, signal, isActive = () => true } = {}
  ) {
    if (!Number.isSafeInteger(window) || window < 1 || window > 200)
      throw new TypeError('window must be 1..200');
    if (
      pairIds !== undefined &&
      (!Array.isArray(pairIds) ||
        pairIds.length < 1 ||
        pairIds.length > 2 ||
        pairIds.some(id => !validSteamId(id)))
    )
      throw new TypeError('pairIds must contain one or two valid Steam IDs');
    const original = Array.isArray(snapshot?.players) ? snapshot.players : [];
    const identitySeen = new Map(),
      roster = [];
    for (const p of original) {
      const id = p?.steamId ?? p?.steam_id;
      if (!p || p.private === true || p.team === 3 || p.spectator === true || !validSteamId(id))
        continue;
      if (identitySeen.has(id)) {
        const previous = identitySeen.get(id);
        if ((previous.name ?? '') !== (p.name ?? '') || previous.team !== p.team)
          throw new Error('Conflicting duplicate public roster identity');
        continue;
      }
      identitySeen.set(id, p);
      roster.push(p);
    }
    if (roster.length > 50) throw new TypeError('Roster exceeds provider batch limit');
    let selected = roster;
    if (pairIds) {
      if (pairIds.some(id => !roster.some(p => (p.steamId ?? p.steam_id) === id)))
        throw new TypeError('Requested player is not in the public roster');
      if (pairIds.length === 2 && pairIds[0] === pairIds[1])
        throw new TypeError('Comparison requires distinct IDs');
      if (pairIds.length === 2) {
        const p = roster.find(x => (x.steamId ?? x.steam_id) === pairIds[0]),
          q = roster.find(x => (x.steamId ?? x.steam_id) === pairIds[1]);
        const neutralOpponents =
          ['duel', 'ffa'].includes(snapshot.gameType) && p.team === 0 && q.team === 0;
        const teamOpponents =
          [1, 2].includes(p.team) && [1, 2].includes(q.team) && p.team !== q.team;
        if (!neutralOpponents && !teamOpponents)
          throw new TypeError('Comparison requires opponents');
      }
      selected = roster.filter(p => pairIds.includes(p.steamId ?? p.steam_id));
    }
    const ids = selected.map(p => p.steamId ?? p.steam_id);
    const key = JSON.stringify([
      snapshot?.address,
      snapshot?.matchGuid,
      snapshot?.state,
      snapshot?.phase,
      snapshot?.map,
      snapshot?.gameType,
      snapshot?.ratingSet,
      window,
      ids,
      selected.map(p => [p.team, p.private === true, p.spectator === true]),
      archive
        ? [
            archive.match_guid,
            archive.server?.addr,
            archive.game_type,
            archive.rating_set,
            archive.ended_at,
            archive.players?.length,
          ]
        : null,
    ]);
    const saved = cache.get(key);
    if (saved && saved.until > now()) {
      cache.delete(key);
      cache.set(key, saved);
      return clone(saved.value);
    }
    if (flights.has(key)) return clone(await flights.get(key));
    if (flights.size >= 32) throw new Error('Rivalry work queue is full');
    const active = () => !signal?.aborted && isActive() !== false;
    const promise = (async () => {
      let profiles = { players: [] };
      if (ids.length && community?.getPlayers && active())
        try {
          profiles = await community.getPlayers(ids);
        } catch (_) {}
      const profileRows = Array.isArray(profiles?.players) ? profiles.players : [];
      if (
        profileRows.some(p => !validSteamId(p?.steam_id) || !ids.includes(p.steam_id)) ||
        new Set(profileRows.map(p => p.steam_id)).size !== profileRows.length
      )
        profiles = { players: [] };
      let pairs = [];
      if (pairIds?.length === 2) pairs = [[pairIds[0], pairIds[1]]];
      else if (!pairIds) {
        const red = roster.filter(p => Number(p.team) === 1).map(p => p.steamId ?? p.steam_id);
        const blue = roster.filter(p => Number(p.team) === 2).map(p => p.steamId ?? p.steam_id);
        if (red.length && blue.length)
          pairs = [
            [red[0], blue[0]],
            ...(red.length > 1 && blue.length > 1 ? [[red[1], blue[1]]] : []),
          ];
      }
      const heads = [];
      for (const [a, b] of pairs) {
        if (!active()) break;
        try {
          const result = await slipgate.request(
            `/players/${encodeURIComponent(a)}/head-to-head/${encodeURIComponent(b)}`
          );
          const row = result?.data;
          if (row?.steam_id_a === a && row?.steam_id_b === b) heads.push(row);
        } catch (_) {}
      }
      const report = buildEvidence({
        snapshot: { ...snapshot, players: selected, window, checkedAt: now() },
        communityProfiles: profiles.players,
        headToHeads: heads,
        archive,
        expectedPairIds: pairIds?.length === 2 ? pairIds : null,
      });
      cache.set(key, { until: now() + 60000, value: clone(report) });
      while (cache.size > 128) cache.delete(cache.keys().next().value);
      return report;
    })().finally(() => flights.delete(key));
    flights.set(key, promise);
    return clone(await promise);
  }
  return { collect };
}
const defaultService = createRivalryService({
  slipgate: require('./slipgateClient').defaultClient,
  community: require('./purgeryClient').defaultClient,
});
module.exports = { createRivalryService, defaultService };
