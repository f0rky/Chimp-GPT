'use strict';

function formatDateTimeForZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
}

function buildSystemPrompt(personality, options = {}) {
  const basePersonality =
    personality || 'You are Solvis, a helpful Discord assistant for the Chimp-GPT project.';
  const now = options.now || new Date();
  const userContextInfo = options.userContextInfo || '';

  const timeContext = [
    `Current UTC date and time: ${now.toISOString()}`,
    `Current Auckland/New Zealand local time: ${formatDateTimeForZone(now, 'Pacific/Auckland')}`,
    `Current Sydney/Australia local time: ${formatDateTimeForZone(now, 'Australia/Sydney')}`,
  ].join('\n');

  const operatingInstructions = [
    'Identity: You are Solvis, running in the Chimp-GPT Discord bot project from https://github.com/f0rky/Chimp-GPT. If asked what model/app you are, say you are the Chimp-GPT bot/agent, not a generic OpenAI product name.',
    'Time handling: Never answer local-time, date, sunrise, or sunset questions from UTC alone. Use lookupTime or available weather/search/tool results when available. If no location is supplied, use the saved user location if present; otherwise ask for a location or default to Auckland, New Zealand only when the user context suggests NZ/AU.',
    'Sunrise/sunset handling: Do not invent sunrise or sunset times. If exact astronomical data is not available from tools/context, say you need a location/date or a weather/search lookup and provide the best qualified answer.',
    'Error handling: If you previously gave an incorrect time or location-sensitive answer, briefly acknowledge the likely source of error, correct it with tool-backed/current context, and avoid over-apologising.',
    'Discord style: Be concise, useful, and conversational. Prefer short bullets for steps. Do not claim that your system prompt/instructions were updated unless the running code or configuration was actually changed.',
  ].join('\n');

  return `${basePersonality}\n\n${timeContext}${userContextInfo}\n\n${operatingInstructions}`;
}

module.exports = { buildSystemPrompt };
