'use strict';
const { validSteamId } = require('./purgeryClient');
const n = value => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const clean = value => (typeof value === 'string' ? value.slice(0, 120) : '');
function buildEvidence({
  snapshot = {},
  communityProfiles = [],
  headToHeads = [],
  archive = null,
  expectedPairIds = null,
} = {}) {
  const source = Array.isArray(snapshot.players) ? snapshot.players : [];
  const seenIds = new Set();
  const eligible = source.filter(p => {
    const id = p?.steamId ?? p?.steam_id;
    if (
      !p ||
      p.private ||
      p.team === 3 ||
      p.spectator === true ||
      !validSteamId(id) ||
      seenIds.has(id)
    )
      return false;
    seenIds.add(id);
    return true;
  });
  const profileRows = Array.isArray(communityProfiles) ? communityProfiles : [];
  const profileMap = new Map();
  for (const row of profileRows) {
    if (!validSteamId(row?.steam_id) || !seenIds.has(row.steam_id) || profileMap.has(row.steam_id))
      continue;
    if (row.private === true) continue;
    profileMap.set(row.steam_id, row);
  }
  const archiveValid =
    !!archive &&
    typeof snapshot.matchGuid === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      snapshot.matchGuid
    ) &&
    String(snapshot.state).toUpperCase() === 'FINAL' &&
    typeof snapshot.address === 'string' &&
    snapshot.address.length > 0 &&
    typeof snapshot.gameType === 'string' &&
    typeof snapshot.ratingSet === 'string' &&
    archive.match_guid === snapshot.matchGuid &&
    archive.server?.addr === snapshot.address &&
    archive.game_type === snapshot.gameType &&
    archive.rating_set === snapshot.ratingSet &&
    archive.aborted === false &&
    typeof archive.ended_at === 'string' &&
    Number.isFinite(Date.parse(archive.ended_at)) &&
    Array.isArray(archive.players);
  const players = eligible.map(p => {
    const id = p.steamId ?? p.steam_id;
    const matchingArchives = archiveValid
      ? archive.players.filter(
          row => row?.steam_id === id && row.private !== true && row.team === p.team
        )
      : [];
    const medalRows =
      matchingArchives.length === 1 && Array.isArray(matchingArchives[0].medals)
        ? matchingArchives[0].medals.filter(m => m?.medal === 'gauntlet')
        : [];
    const medal = medalRows.length === 1 ? n(medalRows[0].count) : null;
    return {
      steamId: id,
      name: clean(p.name),
      team: Number.isInteger(p.team) ? p.team : null,
      lifetimePummels: n(profileMap.get(id)?.pummels?.total),
      recentGaunts: null,
      matchGaunts: medal,
      rating: Number.isSafeInteger(p.rating?.display) ? p.rating.display : null,
    };
  });
  const ids = new Set(players.map(p => p.steamId));
  const rivalries = [],
    seenPairs = new Set();
  const rawHeads = Array.isArray(headToHeads) ? headToHeads : [];
  const pairCounts = new Map();
  for (const item of rawHeads) {
    const key = [item?.steam_id_a, item?.steam_id_b].sort().join(':');
    if (item?.steam_id_a && item?.steam_id_b) pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  for (const item of rawHeads) {
    const a = item?.steam_id_a,
      b = item?.steam_id_b,
      pairKey = [a, b].sort().join(':');
    if (
      !ids.has(a) ||
      !ids.has(b) ||
      a === b ||
      seenPairs.has(pairKey) ||
      pairCounts.get(pairKey) !== 1
    )
      continue;
    if (
      Array.isArray(expectedPairIds) &&
      expectedPairIds.length === 2 &&
      (a !== expectedPairIds[0] || b !== expectedPairIds[1])
    )
      continue;
    const modeRows = Array.isArray(item.by_game_type)
      ? item.by_game_type.filter(
          m => String(m?.game_type).toLowerCase() === String(snapshot.gameType || '').toLowerCase()
        )
      : [];
    if (modeRows.length !== 1) continue;
    const mode = modeRows[0];
    if (
      !Number.isSafeInteger(mode.wins_a) ||
      !Number.isSafeInteger(mode.wins_b) ||
      mode.wins_a < 0 ||
      mode.wins_b < 0
    )
      continue;
    const sum = mode.wins_a + mode.wins_b;
    if (!Number.isSafeInteger(sum) || (mode.decided != null && mode.decided !== sum)) continue;
    seenPairs.add(pairKey);
    const pa = profileMap.get(a),
      pb = profileMap.get(b);
    const victim = (profile, id) => {
      const rows = Array.isArray(profile?.pummels?.victims)
        ? profile.pummels.victims.filter(v => v?.steam_id === id)
        : [];
      return rows.length === 1 ? n(rows[0].count) : null;
    };
    rivalries.push({
      a,
      b,
      winsA: mode.wins_a,
      winsB: mode.wins_b,
      decided: sum,
      shared: n(item.shared),
      sharedScope: 'all_modes',
      teammates: n(item.as_teammates),
      opponents: n(item.as_opponents),
      teammateOpponentScope: 'all_modes',
      pummelsAtoB: victim(pa, b),
      pummelsBtoA: victim(pb, a),
      gameType: mode.game_type,
    });
  }
  const ranked = players.filter(p => p.lifetimePummels !== null);
  const max = ranked.length ? Math.max(...ranked.map(p => p.lifetimePummels)) : null;
  const leaders = max === null ? [] : ranked.filter(p => p.lifetimePummels === max);
  const leader =
    leaders.length === 1
      ? {
          steamId: leaders[0].steamId,
          metric: 'lifetimePummels',
          value: max,
          population: ranked.length,
        }
      : null;
  const facts = [];
  for (const r of rivalries)
    if (r.decided > 0) {
      const winner =
        r.winsA === r.winsB
          ? 'The decided'
          : r.winsA > r.winsB
            ? players.find(p => p.steamId === r.a)?.name || 'Player'
            : players.find(p => p.steamId === r.b)?.name || 'Player';
      facts.push(
        r.winsA === r.winsB
          ? `The decided ${String(r.gameType).toUpperCase()} matchup is tied ${r.winsA}–${r.winsB} (${r.decided} matches).`
          : `${winner} leads the decided ${String(r.gameType).toUpperCase()} matchup ${Math.max(r.winsA, r.winsB)}–${Math.min(r.winsA, r.winsB)} (${r.decided} matches).`
      );
    }
  const pummelPopulation = players.filter(p => p.lifetimePummels !== null);
  if (pummelPopulation.length >= 3) {
    const values = pummelPopulation.map(p => p.lifetimePummels).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    for (const p of pummelPopulation)
      if (p.lifetimePummels >= 3 && p.lifetimePummels >= Math.max(2, median * 2))
        facts.push(
          `${p.name || 'A player'} has ${p.lifetimePummels} recorded lifetime pummels, at least twice the matched roster median (${median}; n=${pummelPopulation.length}).`
        );
  }
  const warnings = [];
  if (
    players.length <
    (Array.isArray(snapshot.players)
      ? snapshot.players.filter(p => p && !p.private && validSteamId(p.steamId ?? p.steam_id))
          .length
      : 0)
  )
    warnings.push('Duplicate or invalid roster identities were excluded.');
  if (archive && !archiveValid)
    warnings.push('Archive evidence did not match the exact snapshot identity.');
  if (archiveValid && players.some(p => p.matchGaunts === null))
    warnings.push(
      'Exact-match medal coverage is incomplete or ambiguous; unavailable gaunt counts remain unknown.'
    );
  return {
    version: 1,
    scope: {
      server: snapshot.address ?? null,
      matchGuid: snapshot.matchGuid ?? null,
      phase: snapshot.state ?? null,
      gameType: snapshot.gameType ?? null,
      ratingSet: snapshot.ratingSet ?? null,
      map: snapshot.map ?? null,
      window: Number.isSafeInteger(snapshot.window) ? snapshot.window : 20,
      checkedAt: Number.isFinite(snapshot.checkedAt) ? snapshot.checkedAt : null,
    },
    coverage: {
      eligible: eligible.length,
      matched: players.filter(p => profileMap.has(p.steamId)).length,
      missing: Math.max(0, eligible.length - players.filter(p => profileMap.has(p.steamId)).length),
    },
    players,
    rivalries,
    leader,
    leaders: leaders.map(p => p.steamId),
    facts,
    warnings,
    commentary: null,
  };
}
module.exports = { buildEvidence, validSteamId };
