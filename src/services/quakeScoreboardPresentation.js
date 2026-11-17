'use strict';
// Pure presentation rules shared by the card and command-only summary.
const number = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
function matchState(s) {
  if (/^(warmup|waiting)$/i.test(s.state || '')) return 'WARMUP';
  if (/^live$/i.test(s.state || '')) return 'LIVE';
  if (/^(finished|final|postgame|intermission|ended)$/i.test(s.state || '')) return 'FINAL';
  return 'UNKNOWN';
}
function liveRound(s) {
  return (
    !s.stale &&
    !s.quality?.a2sOnly &&
    matchState(s) === 'LIVE' &&
    /^(ca|ft|ad)$/i.test(s.gameType || '') &&
    Number.isInteger(s.round) &&
    s.round > 0
  );
}
function elapsedClock(seconds) {
  if (number(seconds) === null || seconds < 0 || seconds > 359999) return null;
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
const MODES = {
  ca: 'Clan Arena',
  ft: 'Freeze Tag',
  ad: 'Attack & Defend',
  tdm: 'Team Deathmatch',
  ctf: 'Capture the Flag',
  ffa: 'Free For All',
  duel: 'Duel',
  race: 'Race',
  dom: 'Domination',
  har: 'Harvester',
  oneflag: 'One Flag CTF',
  rr: 'Red Rover',
};
function modeLabel(mode) {
  const key = String(mode || '').toLowerCase();
  return Object.hasOwn(MODES, key) ? MODES[key] : null;
}
function freshnessWarning(s) {
  if (!s.stale) return '';
  if (/timestamp/i.test(s.staleReason || '')) return 'Stale snapshot: source update delayed';
  if (/cooldown|rate limit/i.test(s.staleReason || ''))
    return 'Stale snapshot: refresh rate limited';
  return 'Stale snapshot: refresh unavailable';
}
module.exports = { number, matchState, liveRound, elapsedClock, modeLabel, freshnessWarning };
