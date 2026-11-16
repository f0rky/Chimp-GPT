const MAX_DISCORD_MESSAGE_LENGTH = 2000;
const OMITTED_STATS_NOTICE = '\n\n> ⚠️ Some server stats omitted to fit Discord’s message limit.';
const FENCE_CLOSER = '\n```';

function hasUnclosedFence(content) {
  return (content.match(/```/g) || []).length % 2 === 1;
}

function limitQuakeContent(stats, { prefix = '', omissionNotice = OMITTED_STATS_NOTICE } = {}) {
  const safeStats = String(stats ?? '');
  const content = prefix + safeStats;
  if (content.length <= MAX_DISCORD_MESSAGE_LENGTH) {
    if (!hasUnclosedFence(content)) return content;
    if (content.trimEnd().length + FENCE_CLOSER.length <= MAX_DISCORD_MESSAGE_LENGTH) {
      return content.trimEnd() + FENCE_CLOSER;
    }
  }

  const statsBudget = Math.max(
    0,
    MAX_DISCORD_MESSAGE_LENGTH - prefix.length - omissionNotice.length - FENCE_CLOSER.length
  );
  let shortenedStats = safeStats.slice(0, statsBudget);
  const lastNewline = shortenedStats.lastIndexOf('\n');
  if (lastNewline > statsBudget * 0.75) shortenedStats = shortenedStats.slice(0, lastNewline);

  if (hasUnclosedFence(shortenedStats)) shortenedStats = shortenedStats.trimEnd() + FENCE_CLOSER;

  const limited = prefix + shortenedStats + omissionNotice;
  if (limited.length <= MAX_DISCORD_MESSAGE_LENGTH) return limited;

  return (
    prefix.slice(0, Math.max(0, MAX_DISCORD_MESSAGE_LENGTH - omissionNotice.length)) +
    omissionNotice
  );
}

module.exports = {
  MAX_DISCORD_MESSAGE_LENGTH,
  OMITTED_STATS_NOTICE,
  limitQuakeContent,
};
