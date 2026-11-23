'use strict';
const { checkUserRateLimit } = require('../../middleware/rateLimiter');
const { renderGauntReport } = require('../../handlers/gauntCardRenderer');
const { createHash } = require('node:crypto');
const inFlight = new Map();
const STEAM = /^7656119\d{10}$/;
const safeReply = (message, content) => message.reply({ content, allowedMentions: { parse: [] } });
const isPublic = p =>
  p &&
  p.private !== true &&
  p.isPrivate !== true &&
  p.public !== false &&
  p.visibility !== 'private' &&
  p.team !== 3 &&
  p.spectator !== true &&
  typeof (p.steamId ?? p.steam_id) === 'string' &&
  STEAM.test(p.steamId ?? p.steam_id);
function contextKey(snapshot) {
  if (!snapshot) return null;
  return createHash('sha256')
    .update(
      JSON.stringify([
        snapshot.address,
        snapshot.matchGuid,
        snapshot.map,
        snapshot.gameType,
        snapshot.ratingSet,
        snapshot.state,
        snapshot.stale === true,
        (snapshot.players || []).map(p => [
          p.steamId ?? p.steam_id,
          p.name,
          p.team,
          p.private === true,
        ]),
      ])
    )
    .digest('hex');
}
function opposing(a, b, mode) {
  if ([1, 2].includes(a.team) && [1, 2].includes(b.team)) return a.team !== b.team;
  return ['duel', 'ffa'].includes(String(mode).toLowerCase()) && a.team === 0 && b.team === 0;
}
function createCommand({
  service,
  watches,
  rateLimit = checkUserRateLimit,
  renderer = renderGauntReport,
  isActive,
} = {}) {
  return {
    name: 'gaunt',
    aliases: ['gaunts'],
    description: 'Show public gaunt and rivalry evidence for this watched Quake roster',
    dmAllowed: false,
    async execute(message, args = []) {
      if (!message.guild) return safeReply(message, 'This command requires a server channel.');
      const key = `${message.client?.user?.id || 'bot'}:${message.guildId}:${message.channelId}`;
      const source = watches || require('../../services/quakeLiveWatch');
      const snapshot = source.snapshot?.(key);
      if (!snapshot || snapshot.stale)
        return safeReply(
          message,
          'No active Quake watch with a current snapshot exists in this channel; no provider query was made.'
        );
      const context = contextKey(snapshot);
      const active = () =>
        contextKey(source.snapshot?.(key)) === context && (!isActive || isActive(key, snapshot));
      const players = (Array.isArray(snapshot.players) ? snapshot.players : []).filter(isPublic);
      const byName = name => {
        const found = players.filter(
          p =>
            String(p.name || p.name_plain || '')
              .trim()
              .toLocaleLowerCase() === name.trim().toLocaleLowerCase()
        );
        return found.length === 1 ? (found[0].steamId ?? found[0].steam_id) : null;
      };
      const tokens = args.map(String);
      let kind = 'gaunt';
      if (tokens[0] && ['prematch', 'summary'].includes(tokens[0].toLowerCase()))
        kind = tokens.shift().toLowerCase();
      if (tokens.length > 2)
        return safeReply(message, 'Usage: !gaunt [prematch|summary] [player [opponent]]');
      const pairIds = [];
      for (const token of tokens) {
        const id = STEAM.test(token) ? token : byName(token);
        if (!id)
          return safeReply(
            message,
            `Player name or ID “${token
              .replace(/@/g, '@\u200b')
              .replace(/[<>`*_~|]/g, '')
              .slice(0, 80)}” is missing, invalid or ambiguous on the current public roster.`
          );
        if (players.filter(p => (p.steamId ?? p.steam_id) === id).length !== 1)
          return safeReply(
            message,
            'That public player ID is missing or ambiguous on the current roster.'
          );
        pairIds.push(id);
      }
      if (pairIds.length === 2) {
        if (pairIds[0] === pairIds[1])
          return safeReply(message, 'Choose two different opposing players.');
        const a = players.find(p => (p.steamId ?? p.steam_id) === pairIds[0]);
        const b = players.find(p => (p.steamId ?? p.steam_id) === pairIds[1]);
        if (!opposing(a, b, snapshot.gameType))
          return safeReply(message, 'Choose two opposing players for a head-to-head comparison.');
      }
      const flightKey = `${key}:${context}:${pairIds.join(':')}:${kind}`;
      if (inFlight.has(flightKey)) return inFlight.get(flightKey);
      if (inFlight.size >= 32)
        return safeReply(message, 'Gaunt reports are busy; please try again shortly.');
      const run = (async () => {
        try {
          const limited = await rateLimit(message.author?.id, 1, { points: 30, duration: 30 });
          if (limited?.limited || limited?.allowed === false)
            return safeReply(
              message,
              'Gaunt command rate limit reached; please try again shortly.'
            );
          if (!active())
            return safeReply(message, 'The active Quake watch changed; run the command again.');
          const collector = service || require('../../services/quakeRivalryService').defaultService;
          const report = await collector.collect(snapshot, {
            ...(pairIds.length ? { pairIds } : {}),
            window: 20,
            isActive: active,
          });
          if (!active())
            return safeReply(
              message,
              'The active Quake watch changed; stale results were discarded.'
            );
          return message.reply({
            embeds: [renderer(report, { kind })],
            allowedMentions: { parse: [] },
          });
        } catch (_) {
          return safeReply(message, 'Gaunt evidence is temporarily unavailable.');
        } finally {
          inFlight.delete(flightKey);
        }
      })();
      inFlight.set(flightKey, run);
      return run;
    },
  };
}
module.exports = { ...createCommand(), createCommand, STEAM, isPublic };
