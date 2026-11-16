'use strict';
const { matchState, number } = require('./quakeScoreboardPresentation');
const { renderSlipgateCard } = require('../handlers/slipgateCardRenderer');
const validGuid = g => typeof g === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(g);
// Ratings are match-scoped and joined by public identity, never by display name.
function finalRating(player, old, cached) {
  if (old.gameType !== 'ca') return undefined;
  if (Number.isSafeInteger(player.display_after)) {
    const delta = Number.isSafeInteger(player.display_before)
      ? player.display_after - player.display_before
      : null;
    return {
      display: player.display_after,
      source: 'archive_after',
      ...(Number.isSafeInteger(delta) ? { delta } : {}),
    };
  }
  if (Number.isSafeInteger(player.display_before))
    return { display: player.display_before, source: 'archive_before' };
  const previous = cached.get(player.steam_id);
  if (!previous || !Number.isSafeInteger(previous.rating?.display)) return undefined;
  return {
    display: previous.rating.display,
    source: 'match_cache',
    ...(previous.rating.provisional === true ? { provisional: true } : {}),
  };
}
// Convert only a completed, exactly identified archive. Never use a later live roster.
function archiveFinal(match, old, checkedAt = Date.now()) {
  if (
    !match ||
    match.ok !== true ||
    !validGuid(old.matchGuid) ||
    match.match_guid !== old.matchGuid ||
    match.server?.addr !== old.address ||
    match.game_type !== old.gameType ||
    !['A', 'B'].includes(match.rating_set) ||
    (['A', 'B'].includes(old.ratingSet) && match.rating_set !== old.ratingSet) ||
    typeof match.ended_at !== 'string' ||
    !Number.isFinite(Date.parse(match.ended_at)) ||
    !Array.isArray(match.players) ||
    match.players.length > 128 ||
    ![match.team_red_score, match.team_blue_score].every(v => v === null || Number.isSafeInteger(v))
  )
    return null;
  const publicIds = new Set(
    (old.players || []).filter(p => !p.private && p.steamId).map(p => p.steamId)
  );
  const hadPrivate = (old.players || []).some(p => p.private);
  const cached = new Map();
  if (old.gameType === 'ca' && old.ratingSet === match.rating_set) {
    for (const p of old.players || []) {
      if (p.private || typeof p.steamId !== 'string' || !/^765\d{14}$/.test(p.steamId)) continue;
      // Ambiguous identities cannot supply a cached rating.
      cached.set(p.steamId, cached.has(p.steamId) ? null : p);
    }
  }
  const players = match.players
    .filter(p => p && !p.private && (!hadPrivate || publicIds.has(p.steam_id)))
    .map(p => ({
      name: typeof p.nick === 'string' ? p.nick : 'Unknown player',
      steamId: null,
      team: number(p.team),
      kills: number(p.kills),
      deaths: number(p.deaths),
      score: number(p.score),
      alive: null,
      private: false,
      ...(finalRating(p, old, cached) ? { rating: finalRating(p, old, cached) } : {}),
    }));
  if (hadPrivate)
    players.push(
      ...old.players
        .filter(p => p.private)
        .map(p => ({ ...p, name: 'Anonymous', steamId: null, alive: null, rating: undefined }))
    );
  return {
    ...old,
    state: 'final',
    finalConfirmed: true,
    finalCheckedAt: number(checkedAt),
    finalAborted: match.aborted === true,
    finalRated: typeof match.rated === 'boolean' ? match.rated : null,
    map: typeof match.map === 'string' && match.map ? match.map : old.map,
    ratingSet: match.rating_set,
    stale: false,
    staleReason: null,
    prediction: null,
    scoreRed: match.team_red_score,
    scoreBlue: match.team_blue_score,
    elapsedSeconds: number(match.duration_sec),
    players,
    sourceUpdatedAt: match.ended_at,
    finalNotice:
      match.aborted === true ? 'Aborted match · archived result' : 'Archived result confirmed',
  };
}
function createScoreboardLifecycle({
  channel,
  client,
  perform,
  active,
  now = Date.now,
  deferReconciliation = false,
}) {
  let message = null,
    retainedFinal = false,
    last = null,
    phase = null;
  const pending = [];
  const payload = (s, content) => ({
    content,
    embeds: [renderSlipgateCard(s)],
    allowedMentions: { parse: [] },
  });
  async function edit(target, body) {
    if (!active()) return;
    await perform(() => target.edit(body));
  }
  async function send(body) {
    if (!active()) return null;
    try {
      return await perform(() => channel.send(body));
    } catch (error) {
      error.uncertainSend = true;
      throw error;
    }
  }
  async function finalize(s) {
    if (!active() || retainedFinal) return;
    const old = structuredClone(s);
    const unconfirmed = {
      ...old,
      state: 'final',
      prediction: null,
      finalNotice: 'Final result pending · last observed statistics, not confirmed final scores',
      players: (old.players || []).map(p => ({ ...p, alive: null })),
    };
    const body = payload(
      unconfirmed,
      validGuid(old.matchGuid)
        ? 'FINAL · awaiting Slipgate archive confirmation; statistics below were last observed.'
        : 'FINAL · unconfirmed: match ID unavailable; statistics below were last observed.'
    );
    // Freeze ownership before starting the edit so a concurrent stop cannot rewrite a result.
    retainedFinal = true;
    try {
      if (message) await edit(message, body);
      else message = await send(body);
    } catch (error) {
      if (active()) retainedFinal = false;
      throw error;
    }
    if (!active()) return;
    if (message && validGuid(old.matchGuid)) {
      if (pending.length >= 8) {
        const dropped = pending.shift();
        try {
          await edit(
            dropped.message,
            payload(
              dropped.snapshot,
              'FINAL · unconfirmed: archive retry limit reached. Last observed statistics retained.'
            )
          );
        } catch (_) {
          /* A historical result may have been manually deleted. */
        }
      }
      pending.push({ message, old, snapshot: unconfirmed, attempts: 0, next: 0 });
    }
  }
  async function reconcile() {
    if (!active()) return;
    // One pending archive per scheduled tick; no independent retry timer or unbounded fanout.
    const job = pending.find(j => now() >= j.next);
    if (!job || (client.pollingPolicy?.().cooldownMs || 0) > 0) return;
    job.attempts++;
    job.next = now() + 120000;
    let final = null;
    try {
      final = archiveFinal(await client.getMatch(job.old.matchGuid), job.old, now());
    } catch (_) {
      /* Delayed 404 and other optional archive failures remain explicitly unconfirmed. */
    }
    if (!active()) return;
    if (final || job.attempts >= 5) {
      try {
        await edit(
          job.message,
          final
            ? payload(final, 'FINAL · Slipgate archived result confirmed.')
            : payload(
                job.snapshot,
                'FINAL · unconfirmed: Slipgate archive unavailable after bounded checks. Last observed statistics retained.'
              )
        );
      } catch (_) {
        // A deleted/inaccessible historical result must not stop the current live watch.
      }
      pending.splice(pending.indexOf(job), 1);
    }
  }
  async function prepare(s) {
    if (!active()) return;
    const nextPhase = matchState(s);
    if (!s.stale && !s.quality?.a2sOnly && nextPhase !== 'UNKNOWN') {
      const guid = validGuid(s.matchGuid) ? s.matchGuid : null;
      const oldGuid = last?.matchGuid;
      const changed = guid && oldGuid && guid !== oldGuid;
      const warmupEdge = nextPhase === 'WARMUP' && ['LIVE', 'FINAL'].includes(phase);
      const resumedAfterFinal = phase === 'FINAL' && nextPhase === 'LIVE';
      if (last && (changed || warmupEdge || resumedAfterFinal)) {
        if (!retainedFinal && phase !== 'WARMUP') await finalize(last);
        if (!active()) return;
        // Retained finals are never reused or deleted. A warmup's first GUID promotes its card.
        message = null;
        retainedFinal = false;
        last = null;
      }
      const promotedGuid = nextPhase === 'WARMUP' ? null : guid || last?.matchGuid || null;
      if (!retainedFinal) last = structuredClone({ ...s, matchGuid: promotedGuid });
      phase = nextPhase;
      if (nextPhase === 'FINAL' && !retainedFinal) await finalize(last);
    }
    if (!deferReconciliation) await reconcile();
  }
  async function shouldMove() {
    if (!message?.id || retainedFinal || !channel.messages?.fetch || !active()) return false;
    try {
      const found = await channel.messages.fetch({ after: message.id, limit: 100, cache: false });
      if (!active()) return false;
      const rows = typeof found.values === 'function' ? [...found.values()] : [];
      return rows.some(m => m?.author?.bot === false && m.author.system !== true && !m.webhookId);
    } catch (_) {
      return false;
    } // No delete/repost on uncertain channel-history reads.
  }
  async function publish(body, move = false) {
    if (!active() || retainedFinal) return;
    const previous = message;
    if (!previous || move) {
      const written = await send(body);
      if (written) message = written;
      if (previous && written && active()) {
        // Only a message returned by this watch's own channel.send is ever eligible.
        try {
          await perform(() => previous.delete());
        } catch (_) {
          /* Adopt new ownership; never replay send or delete other cards. */
        }
      }
    } else await edit(previous, body);
  }
  return {
    prepare,
    reconcile,
    publish,
    shouldMove,
    get message() {
      return message;
    },
    get retainedFinal() {
      return retainedFinal;
    },
    get pendingCount() {
      return pending.length;
    },
  };
}
module.exports = { archiveFinal, createScoreboardLifecycle, validGuid };
