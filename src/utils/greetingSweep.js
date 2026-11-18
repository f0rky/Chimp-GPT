async function cleanStaleBotMessages(
  channel,
  botUserId,
  beforeMessageId,
  { log, targetMessageIds = [] } = {}
) {
  const targets = new Set(Array.isArray(targetMessageIds) ? targetMessageIds : []);
  if (!channel?.messages?.fetch || !botUserId || !beforeMessageId || targets.size === 0) {
    return { deleted: 0, failed: 0 };
  }

  const messages = await channel.messages.fetch({ before: beforeMessageId, limit: 100 });
  const staleBotMessages = [...messages.values()].filter(
    message =>
      targets.has(message.id) &&
      message.id !== beforeMessageId &&
      message.author?.id === botUserId &&
      !message.pinned
  );
  const outcomes = await Promise.allSettled(staleBotMessages.map(message => message.delete()));
  const deleted = outcomes.filter(outcome => outcome.status === 'fulfilled').length;
  const failed = outcomes.length - deleted;

  if (failed && log) {
    log.warn(
      { failed, candidateCount: staleBotMessages.length, channelId: channel.id },
      'Some stale bot messages could not be deleted during greeting sweep'
    );
  }

  return { deleted, failed };
}

module.exports = { cleanStaleBotMessages };
