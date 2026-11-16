'use strict';
const { EmbedBuilder } = require('discord.js');
const {
  number,
  matchState,
  liveRound,
  elapsedClock,
  modeLabel,
  freshnessWarning,
} = require('../services/quakeScoreboardPresentation');
const TEAM = { 1: 'Red', 2: 'Blue', 3: 'Spectators', 0: 'Unassigned' };
const TEAM_ICON = { 1: '🔴', 2: '🔵', 3: '👀', 0: '👤' };
// Names appear both in Markdown and inside our own fences. Strip formatting rather than
// escaping it (backslash escapes do not work inside Discord code blocks).
const clean = (value, limit = 200) =>
  [
    ...String(value ?? '')
      .replace(/\^./gu, '')
      .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, '')
      .replace(/[`\\*_~|[\]()]/g, '')
      .replace(/</g, '‹')
      .replace(/>/g, '›')
      .replace(/@/g, '＠'),
  ]
    .slice(0, limit)
    .join('') || '—';
const width = char =>
  /[\p{Extended_Pictographic}\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff01-\uff60]/u.test(
    char
  )
    ? 2
    : /\p{M}/u.test(char)
      ? 0
      : 1;
function cell(value, columns, right = false) {
  let text = '',
    used = 0;
  for (const char of String(value)) {
    const size = width(char);
    if (used + size > columns) break;
    text += char;
    used += size;
  }
  return right ? ' '.repeat(columns - used) + text : text + ' '.repeat(columns - used);
}
function numeric(value) {
  if (number(value) === null) return '—';
  const text = String(value);
  return text.length <= 7 ? text : value.toExponential(0);
}
function ratingText(p, final) {
  if (p.private || !Number.isSafeInteger(p.rating?.display)) return '—';
  const origin = final
    ? p.rating.source === 'archive_before'
      ? '†'
      : p.rating.source === 'match_cache'
        ? '‡'
        : ''
    : '';
  return `${p.rating.display}${p.rating.provisional ? '*' : ''}${origin}`;
}
function verifiedDelta(p) {
  return !p.private && p.rating?.source === 'archive_after' && Number.isSafeInteger(p.rating.delta);
}
const deltaText = p =>
  verifiedDelta(p) ? `${p.rating.delta > 0 ? '+' : ''}${p.rating.delta}` : '—';
function finalSummary(s, players) {
  if (!s.finalConfirmed) return [];
  const red = number(s.scoreRed),
    blue = number(s.scoreBlue);
  const scoreKnown = red !== null && blue !== null;
  const winner = s.finalAborted
    ? '⚠️ Aborted match · no winner declared'
    : !scoreKnown
      ? 'Final score unavailable'
      : red === blue
        ? '🤝 **Draw**'
        : `🏆 **${red > blue ? 'Red' : 'Blue'} wins**`;
  const duration = elapsedClock(s.elapsedSeconds);
  const end = typeof s.sourceUpdatedAt === 'string' ? Date.parse(s.sourceUpdatedAt) : NaN;
  const leaders = players.filter(
    p => !p.private && [1, 2].includes(p.team) && number(p.score) !== null
  );
  const best = leaders.length ? Math.max(...leaders.map(p => p.score)) : null;
  const tied = leaders.filter(p => p.score === best);
  return [
    winner,
    scoreKnown ? `🔴 Red **${numeric(red)}** — **${numeric(blue)}** Blue 🔵` : null,
    duration ? `⏱ Duration: **${duration}**` : null,
    Number.isFinite(end) ? `🕒 Ended: **${new Date(end).toISOString().slice(11, 16)} UTC**` : null,
    s.finalRated === true ? 'Rated match' : s.finalRated === false ? 'Unrated match' : null,
    !s.finalAborted && tied.length
      ? `⭐ Highest reported score: **${clean(tied[0].name, 24)}**${tied.length > 1 ? ` (+${tied.length - 1} tied)` : ''} · **${numeric(best)}**`
      : null,
  ].filter(Boolean);
}
function footer(s, now) {
  const updated = typeof s.sourceUpdatedAt === 'string' ? Date.parse(s.sourceUpdatedAt) : NaN;
  const confirmed = s.finalConfirmed === true && matchState(s) === 'FINAL';
  const reportedFetch = number(confirmed ? s.finalCheckedAt : s.fetchedAt);
  const fetched = reportedFetch ?? number(now);
  const time = Number.isFinite(updated)
    ? `source ${new Date(updated).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : 'source time unavailable';
  const checked =
    fetched !== null && Math.abs(fetched) <= 8640000000000000
      ? ` · ${confirmed ? 'confirmed' : reportedFetch === null ? 'checked' : 'fetched'} ${new Date(fetched).toISOString().slice(11, 16)} UTC`
      : '';
  const warning = freshnessWarning(s);
  return `${warning ? `${warning} · ` : ''}Slipgate · ${time}${checked}`;
}
function renderSlipgateCard(s, now = Date.now()) {
  const phase = matchState(s);
  const final = phase === 'FINAL';
  const confirmed = final && s.finalConfirmed === true;
  const competitive = !s.quality?.a2sOnly && (phase === 'LIVE' || phase === 'FINAL');
  const activeRound = liveRound(s);
  const players = Array.isArray(s.players) ? s.players : [];
  const rated = p => !p.private && Number.isSafeInteger(p.rating?.display);
  const hasRatings =
    competitive &&
    s.gameType === 'ca' &&
    ['A', 'B'].includes(s.ratingSet) &&
    players.some(p => p.team !== 3 && rated(p));
  const groups = [1, 2, 0, 3]
    .map(team => ({
      team,
      players: players.filter(p => (team === 0 ? ![1, 2, 3].includes(p.team) : p.team === team)),
    }))
    .filter(
      g =>
        g.players.length ||
        (competitive &&
          [1, 2].includes(g.team) &&
          number(g.team === 1 ? s.scoreRed : s.scoreBlue) !== null)
    );
  const status = s.stale
    ? `**STALE · last reported ${phase}**`
    : final
      ? '**FINAL** · 🏁 **MATCH RESULTS**'
      : `**${phase}**`;
  const context = [
    s.map ? clean(s.map, 64) : null,
    modeLabel(s.gameType) || (s.gameType ? clean(s.gameType, 32) : null),
  ]
    .filter(Boolean)
    .join(' · ');
  const clock = competitive ? elapsedClock(s.elapsedSeconds) : null;
  const progress = final
    ? !confirmed && clock
      ? `Last observed time: ${clock}`
      : null
    : [activeRound ? `Round ${s.round}` : null, clock].filter(Boolean).join(' · ');
  const prediction = s.prediction;
  const predictionAllowed =
    !s.stale &&
    phase === 'LIVE' &&
    !s.quality?.a2sOnly &&
    prediction?.family === 'team' &&
    typeof prediction.conditioned === 'boolean' &&
    ['A', 'B'].includes(prediction.rating_set) &&
    prediction.state === 'live' &&
    prediction.game_type === 'ca' &&
    s.gameType === 'ca' &&
    prediction.rating_set === s.ratingSet &&
    prediction?.basis === 'set' &&
    prediction.calibrated === true &&
    Number.isSafeInteger(prediction.roundlimit) &&
    prediction.roundlimit >= 1 &&
    prediction.roundlimit <= 100 &&
    [prediction.probs, prediction.prior].every(
      pair =>
        pair &&
        Number.isFinite(pair.red) &&
        Number.isFinite(pair.blue) &&
        pair.red >= 0 &&
        pair.red <= 1 &&
        pair.blue >= 0 &&
        pair.blue <= 1 &&
        Math.abs(pair.red + pair.blue - 1) <= 0.002
    ) &&
    Number.isFinite(prediction.fairness) &&
    prediction.fairness >= 0 &&
    prediction.fairness <= 1;
  const pct = v => `${Math.round(v * 100)}%`;
  const predictionLines = predictionAllowed
    ? [
        `🏁 First to ${prediction.roundlimit} · CA ${prediction.rating_set === 'B' ? 'Modified' : 'Standard'} (${prediction.rating_set})`,
        `🎯 Live win chance${prediction.conditioned ? ' (score-conditioned)' : ' (ratings only)'} · Red ${pct(prediction.probs.red)} / Blue ${pct(prediction.probs.blue)}`,
        `⚖️ Pre-match · Red ${pct(prediction.prior.red)} / Blue ${pct(prediction.prior.blue)} · provider fairness ${pct(prediction.fairness)}`,
      ]
    : [];
  const intro = [
    status,
    final && s.finalNotice ? clean(s.finalNotice, 120) : null,
    ...(final ? finalSummary(s, players) : []),
    ...predictionLines,
    phase === 'WARMUP'
      ? 'Warmup — match has not started.'
      : phase === 'UNKNOWN'
        ? 'Match state unavailable.'
        : null,
    s.quality?.a2sOnly && phase !== 'WARMUP' && phase !== 'UNKNOWN'
      ? 'Scoreboard detail unavailable.'
      : null,
    context,
    progress,
    hasRatings
      ? `ELO · CA ${s.ratingSet}${players.some(p => rated(p) && p.rating.provisional) ? ' · * provisional' : ''}`
      : final && s.gameType === 'ca' && ['A', 'B'].includes(s.ratingSet)
        ? 'ELO not reported for this result.'
        : null,
    final && hasRatings && players.some(p => !p.private && p.rating?.source === 'archive_before')
      ? '† pre-match ELO'
      : null,
    final && hasRatings && players.some(p => !p.private && p.rating?.source === 'match_cache')
      ? '‡ last-observed match ELO'
      : null,
    confirmed && players.some(verifiedDelta) ? 'Δ verified archive rating change' : null,
  ]
    .filter(Boolean)
    .join('\n');
  const redBlue = groups.filter(g => [1, 2].includes(g.team));
  const metricPlayers = players.filter(p => p.team !== 3);
  const teamPlayers = redBlue.flatMap(g => g.players);
  const teamScore = competitive && teamPlayers.some(p => number(p.score) !== null);
  const teamKD =
    competitive && teamPlayers.some(p => number(p.kills) !== null || number(p.deaths) !== null);
  const teamElo = hasRatings && teamPlayers.some(rated);
  const scoreWidth = Math.max(3, ...metricPlayers.map(p => numeric(p.score).length));
  const kdWidth = Math.max(
    5,
    ...metricPlayers.map(p => `${numeric(p.kills)}/${numeric(p.deaths)}`.length)
  );
  const eloWidth = Math.max(4, ...metricPlayers.map(p => ratingText(p, final).length));
  const teamDelta = confirmed && teamPlayers.some(verifiedDelta);
  const deltaWidth = Math.max(2, ...metricPlayers.map(p => deltaText(p).length));
  const budget = 1024;
  const sections = groups.map(group => {
    const namesOnly = !competitive || group.team === 3;
    const ordered = group.players.map(p => ({
      ...p,
      display: p.private ? 'Anonymous' : clean(p.name, 80),
    }));
    ordered.sort((a, b) => {
      if (!namesOnly) {
        const av = number(a.score),
          bv = number(b.score);
        if (av !== bv) return av === null ? 1 : bv === null ? -1 : bv - av;
      }
      return a.display.localeCompare(b.display, 'en');
    });
    const pairedTeam = [1, 2].includes(group.team);
    const hasScore =
      !namesOnly && (pairedTeam ? teamScore : ordered.some(p => number(p.score) !== null));
    const hasKD =
      !namesOnly &&
      (pairedTeam
        ? teamKD
        : ordered.some(p => number(p.kills) !== null || number(p.deaths) !== null));
    const markers =
      !namesOnly &&
      activeRound &&
      (pairedTeam ? teamPlayers : ordered).some(p => typeof p.alive === 'boolean');
    const hasElo = !namesOnly && (pairedTeam ? teamElo : hasRatings && ordered.some(rated));
    const hasDelta = hasElo && confirmed && (pairedTeam ? teamDelta : ordered.some(verifiedDelta));
    const nameWidth = hasElo ? 12 : hasScore || hasKD ? 16 : 32;
    const headingScore =
      competitive && [1, 2].includes(group.team)
        ? number(group.team === 1 ? s.scoreRed : s.scoreBlue)
        : null;
    const heading = `${TEAM_ICON[group.team]} **${TEAM[group.team]} (${group.players.length})${headingScore !== null ? ` · ${numeric(headingScore)}` : ''}**`;
    const header =
      namesOnly || (!hasScore && !hasKD && !hasElo)
        ? ''
        : `${markers ? '   ' : ''}${cell('Name', nameWidth)}${hasScore ? ` ${cell(scoreWidth < 5 ? 'S' : 'Score', scoreWidth, true)}` : ''}${hasKD ? ` ${cell('K/D', kdWidth, true)}` : ''}${hasElo ? ` ${cell('ELO', eloWidth, true)}` : ''}${hasDelta ? ` ${cell('Δ', deltaWidth, true)}` : ''}`;
    const lines = [];
    let used = header.length + 65;
    for (const p of ordered) {
      const line = namesOnly
        ? cell(p.display, 32).trimEnd()
        : `${markers ? (p.alive === true ? '🟢 ' : p.alive === false ? '💀 ' : '   ') : ''}${cell(p.display, nameWidth)}${hasScore ? ` ${cell(numeric(p.score), scoreWidth, true)}` : ''}${hasKD ? ` ${cell(`${numeric(p.kills)}/${numeric(p.deaths)}`, kdWidth, true)}` : ''}${hasElo ? ` ${cell(ratingText(p, final), eloWidth, true)}` : ''}${hasDelta ? ` ${cell(deltaText(p), deltaWidth, true)}` : ''}`.trimEnd();
      if (used + line.length + 1 > budget) break;
      lines.push(line);
      used += line.length + 1;
    }
    const omitted = ordered.length - lines.length;
    const table = [header, ...lines].filter(Boolean).join('\n');
    const value = `${table ? `\`\`\`\n${table}\n\`\`\`` : 'No roster reported.'}${omitted ? `\n… ${omitted} more reported` : ''}`;
    return { team: group.team, heading, value, omitted };
  });
  const legend =
    activeRound && players.some(p => p.team !== 3 && typeof p.alive === 'boolean')
      ? '\n🟢 alive / 💀 dead'
      : '';
  const rosterFields = sections.flatMap(section => {
    const field = { name: section.heading, value: section.value, inline: false };
    return section.team === 2 && sections.some(other => other.team === 1)
      ? [{ name: 'VS', value: '\u200b', inline: false }, field]
      : [field];
  });
  return new EmbedBuilder()
    .setColor(
      s.stale || (final && (!confirmed || s.finalAborted)) ? 0xb08030 : final ? 0xf1c40f : 0x527a3b
    )
    .setTitle(`${final ? '🏁 FINAL MATCH RESULTS · ' : ''}${clean(s.name || s.address, 120)}`)
    .setURL(`https://slipgate.gg/servers/${encodeURIComponent(s.address || '')}`)
    .setDescription(
      `${intro}${legend}${rosterFields.length ? '' : '\n\nNo player roster reported.'}`
    )
    .addFields(rosterFields)
    .setFooter({ text: footer(s, now) });
}
module.exports = { renderSlipgateCard, TEAM, clean };
