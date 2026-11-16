'use strict';
const { PermissionFlagsBits } = require('discord.js');
const { renderSlipgateCard } = require('../../handlers/slipgateCardRenderer');
const { analyze } = require('../../services/quakeMatchAnalysis');
const watches = require('../../services/quakeLiveWatch');
const { defaultClient } = require('../../services/slipgateClient');
const { defaultTracker } = require('../../services/quakeRoundTracker');
const { checkUserRateLimit } = require('../../middleware/rateLimiter');
function permitted(message, config) {
  const owner = config.OWNER_ID ?? process.env.OWNER_ID;
  return Boolean(
    message.guild &&
      ((typeof owner === 'string' && /^\d{17,20}$/.test(owner) && message.author?.id === owner) ||
        message.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild) ||
        message.member?.permissions?.has?.(PermissionFlagsBits.ManageChannels))
  );
}
function createCommand({
  client = defaultClient,
  manager = watches,
  tracker = defaultTracker,
  analysis = analyze,
  analysisOptions = {},
  rateLimit = checkUserRateLimit,
} = {}) {
  async function rateAllowed(message) {
    // Prefix commands return before the chat handler's rate gate, so apply the same gate here.
    const result = await rateLimit(message.author?.id, 1, { points: 30, duration: 30 });
    if (!result.limited) return true;
    await message.reply('Quake command rate limit reached; please try again shortly.');
    return false;
  }
  return {
    name: 'quakestats',
    aliases: [],
    description: 'Auto-updating Quake scoreboard, snapshots and watch controls',
    dmAllowed: false,
    async execute(message, args = [], _discordClient, config = {}) {
      if (!message.guild) return message.reply('This command requires a server channel.');
      const sub = String(args[0] || '').toLowerCase();
      const key = `${message.client?.user?.id || 'bot'}:${message.guildId}:${message.channelId}`;
      // Inspect the in-memory reservation synchronously, before any provider/model work.
      // start() reserves the channel before its first timer, including concurrent commands.
      const existing = manager.status?.(key);
      if (sub !== 'stop' && existing) return message.reply(existingText(existing));
      const polling = client.pollingPolicy();
      const watching = sub === 'watch' || (sub !== 'snapshot' && sub !== 'stop' && polling.enabled);
      if (sub === 'stop' || watching) {
        if (!permitted(message, config))
          return message.reply('Manage Server or Manage Channels permission is required.');
        if (!(await rateAllowed(message))) return undefined;
        if (sub === 'stop') {
          const stopped = await manager.stop(key);
          return message.reply(
            stopped ? 'Stopped this channel’s Quake watch.' : 'No Quake watch is active here.'
          );
        }
        const filter = (sub === 'watch' ? args.slice(1) : args).join(' ').trim();
        if (!validFilter(filter)) return message.reply('Invalid server name or address.');
        const result = manager.start(key, { channel: message.channel, client, filter });
        return message.reply(
          result.ok
            ? result.existing
              ? existingText(manager.status?.(key))
              : '👀 Watch started — fetching scoreboard. Stop: !quakestats stop.'
            : result.reason
        );
      }
      const filter = (sub === 'snapshot' ? args.slice(1) : args).join(' ').trim();
      if (!validFilter(filter)) return message.reply('Invalid server name or address.');
      if (!(await rateAllowed(message))) return undefined;
      try {
        let snapshot = await client.selectServer(filter);
        if (!snapshot) return message.reply('No matching Quake server was found.');
        snapshot = await tracker.observe(snapshot, client);
        const content = await analysis(snapshot, analysisOptions);
        return message.reply({
          embeds: [renderSlipgateCard(snapshot)],
          content: `Snapshot — ${polling.enabled ? 'one-time view' : 'auto-refresh disabled'}. ${content}`,
          allowedMentions: { parse: [] },
        });
      } catch (_) {
        return message.reply('Quake stats are temporarily unavailable.');
      }
    },
  };
}
function existingText(status) {
  if (status?.stopping) return 'Quake watch is stopping; try again after stop completes.';
  return `Already polling: a Quake watch is already active in this channel${status?.pending ? ' (initial lookup pending)' : ''}. ${status?.paused ? 'Rate-limit pause; ' : ''}Refresh cadence: ${Math.ceil((status?.intervalMs || 60000) / 1000)}s minimum.${status?.url ? ` ${status.url}` : ''} Use !quakestats stop before changing server.`;
}
function validFilter(value) {
  return (
    value.length <= 100 &&
    !/[\\/<>@]/.test(value) &&
    ![...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  );
}
module.exports = { ...createCommand(), createCommand };
