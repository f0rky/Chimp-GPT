'use strict';
const { EmbedBuilder } = require('discord.js');
function clean(value, max = 1024) {
  return (
    String(value ?? '')
      .replace(/@/g, '@\u200b')
      .replace(/[`<>*_~|]/g, '')
      .replace(/(?!\n)\p{Cc}/gu, '')
      .slice(0, max)
      .replace(/[\uD800-\uDBFF]$/, '') || '—'
  );
}
const label = (value, max = 60) => clean(value, max).replace(/\n/g, ' ');
const count = value => (Number.isSafeInteger(value) && value >= 0 ? String(value) : 'unavailable');
const lengthOf = d =>
  (d.title?.length || 0) +
  (d.description?.length || 0) +
  (d.footer?.text?.length || 0) +
  (d.author?.name?.length || 0) +
  (d.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0);
function add(embed, name, value) {
  const f = { name: label(name, 256), value: clean(value), inline: false };
  if (
    (embed.data.fields?.length || 0) >= 25 ||
    lengthOf(embed.data) + f.name.length + f.value.length > 6000
  )
    return false;
  embed.addFields(f);
  return true;
}
function rowsWithCoverage(players, row) {
  const shown = [];
  let size = 0;
  for (const p of players) {
    const line = label(row(p), 900);
    if (size + line.length + 1 > 940) break;
    shown.push(line);
    size += line.length + 1;
  }
  const omitted = players.length - shown.length;
  return (
    shown.join('\n') +
    (omitted
      ? `\n… ${omitted} more players omitted (${shown.length} shown · ${players.length} total)`
      : '')
  );
}
function playerName(report, id) {
  return label(report?.players?.find(p => p.steamId === id)?.name || 'Roster player');
}
function leaderText(report) {
  if (report?.leader)
    return `${playerName(report, report.leader.steamId)} · ${count(report.leader.value)} lifetime pummels among ${count(report.leader.population)} matched roster players (not a global rank).`;
  const tied = (report?.leaders || []).map(id => playerName(report, id));
  return tied.length > 1
    ? `Tied community lifetime lead: ${tied.slice(0, 8).join(', ')}${tied.length > 8 ? ' and others' : ''}; matched roster only.`
    : null;
}
function rivalryText(report, r) {
  const a = playerName(report, r.a),
    b = playerName(report, r.b);
  return `${a} ${count(r.winsA)} – ${count(r.winsB)} ${b} · ${count(r.decided)} decided in ${label(r.gameType || 'unknown', 20).toUpperCase()} (reported ladders combined).\nAll-mode history: ${count(r.shared)} shared (${count(r.teammates)} teammates, ${count(r.opponents)} opponents).\nCommunity lifetime pummels: ${a} → ${b} ${count(r.pummelsAtoB)} · ${b} → ${a} ${count(r.pummelsBtoA)}`;
}
function renderGauntReport(report, { kind = 'gaunt' } = {}) {
  const title =
    kind === 'prematch'
      ? 'Gaunt · Pre-match'
      : kind === 'summary' || kind === 'final'
        ? 'Gaunt · Match summary'
        : 'Gaunt rivalry report';
  const embed = new EmbedBuilder().setColor(0xc0392b).setTitle(title),
    scope = report?.scope || {};
  const checked = Number.isFinite(scope.checkedAt)
    ? `\nChecked <t:${Math.floor(scope.checkedAt / 1000)}:R>`
    : '';
  embed.setDescription(
    `${label(scope.phase || 'Unknown phase', 30)} · ${label(scope.gameType || 'mode unknown', 20).toUpperCase()} · ${label(scope.map || 'map unknown')}${checked}`
  );
  const players = Array.isArray(report?.players) ? report.players : [];
  const isTeam = (p, n, name) => p.team === n || String(p.team).toLowerCase() === name;
  const red = players.filter(p => isTeam(p, 1, 'red')),
    blue = players.filter(p => isTeam(p, 2, 'blue'));
  const row = p =>
    `• ${label(p.name, 50)} — lifetime pummels ${count(p.lifetimePummels)}${p.recentGaunts != null ? ` · recent gaunts ${count(p.recentGaunts)}` : ''}${p.matchGaunts != null ? ` · match gaunts ${count(p.matchGaunts)}` : ''}${Number.isSafeInteger(p.rating) ? ` · ELO ${p.rating}` : ''}`;
  if (red.length) add(embed, '🔴 Red', rowsWithCoverage(red, row));
  if (red.length && blue.length) add(embed, 'VS', '↕');
  if (blue.length) add(embed, '🔵 Blue', rowsWithCoverage(blue, row));
  const other = players.filter(p => !isTeam(p, 1, 'red') && !isTeam(p, 2, 'blue'));
  if (other.length) add(embed, 'Unassigned public players', rowsWithCoverage(other, row));
  const c = report?.coverage || {};
  add(
    embed,
    'Coverage · matched public players',
    `${count(c.matched)}/${count(c.eligible)} matched · ${count(c.missing)} missing`
  );
  const lead = leaderText(report);
  if (lead) add(embed, 'Community lifetime lead', lead);
  for (const r of (report?.rivalries || []).slice(0, 2))
    add(
      embed,
      `Head-to-head · ${label(r.gameType || scope.gameType || 'mode', 20).toUpperCase()}`,
      rivalryText(report, r)
    );
  if (report?.facts?.length)
    add(
      embed,
      'Recorded facts',
      report.facts
        .slice(0, 5)
        .map(x => `• ${clean(x, 180)}`)
        .join('\n')
    );
  if (report?.commentary) add(embed, 'Commentary', clean(report.commentary, 600));
  if (report?.warnings?.length)
    add(
      embed,
      'Coverage notes',
      report.warnings
        .slice(0, 3)
        .map(x => `• ${clean(x, 150)}`)
        .join('\n')
    );
  return embed;
}
function appendGauntContext(base, report, { kind = 'gaunt' } = {}) {
  const embed = new EmbedBuilder(base.toJSON());
  const medals = (report?.players || []).filter(p => Number.isSafeInteger(p.matchGaunts));
  if (medals.length)
    add(
      embed,
      'Gaunt context · this match',
      rowsWithCoverage(medals, p => `${label(p.name)} · match gaunts ${count(p.matchGaunts)}`)
    );
  const lead = leaderText(report);
  if (lead) add(embed, 'Gaunt context · community lifetime lead', lead);
  for (const r of (report?.rivalries || []).slice(0, 1))
    add(
      embed,
      `Gaunt context · ${label(r.gameType || 'mode', 20).toUpperCase()} H2H`,
      rivalryText(report, r)
    );
  if (report?.commentary)
    add(
      embed,
      `Gaunt context · ${kind === 'final' || kind === 'summary' ? 'assessment' : 'pre-match assessment'}`,
      clean(report.commentary, 600)
    );
  return embed;
}
module.exports = { renderGauntReport, appendGauntContext, clean };
