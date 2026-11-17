'use strict';
const crypto = require('crypto');
const { buildChatRequest } = require('./chatModel');
const cache = new Map(),
  pending = new Map();
const ids = new WeakMap();
let nextId = 1;
const {
  number,
  matchState,
  liveRound,
  freshnessWarning,
} = require('./quakeScoreboardPresentation');
function facts(s) {
  const state = matchState(s);
  const competitive = !s.quality?.a2sOnly && (state === 'LIVE' || state === 'FINAL');
  return {
    state,
    stale: Boolean(s.stale),
    stateLive: state === 'LIVE',
    detailAvailable: !s.quality?.a2sOnly,
    round: liveRound(s) ? number(s.round) : null,
    scoreRed: competitive ? number(s.scoreRed) : null,
    scoreBlue: competitive ? number(s.scoreBlue) : null,
    teams: [1, 2].map(team => {
      const players = (s.players || []).filter(p => p.team === team);
      return {
        team,
        count: players.length,
        alive:
          liveRound(s) && players.length && players.every(p => typeof p.alive === 'boolean')
            ? players.filter(p => p.alive).length
            : null,
      };
    }),
    spectators: (s.players || []).filter(p => p.team === 3).length,
    unassigned: (s.players || []).filter(p => ![1, 2, 3].includes(p.team)).length,
  };
}
function fingerprint(s, mode = 'facts') {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        address: s.address,
        matchGuid: s.matchGuid,
        map: s.map,
        gameType: s.gameType,
        facts: facts(s),
        freshness: freshnessWarning(s),
        mode,
      })
    )
    .digest('hex');
}
function roster(f) {
  return (
    `Roster: Red ${f.teams[0].count}, Blue ${f.teams[1].count}` +
    (f.unassigned ? `; ${f.unassigned} unassigned` : '') +
    (f.spectators ? `; ${f.spectators} spectating` : '') +
    '.'
  );
}
function scoreline(f) {
  if (f.scoreRed === null && f.scoreBlue === null) return 'Team scores not reported.';
  if (f.scoreRed === null) return `Red score unreported; Blue ${f.scoreBlue}.`;
  if (f.scoreBlue === null) return `Red ${f.scoreRed}; Blue score unreported.`;
  const line = `Red ${f.scoreRed} – Blue ${f.scoreBlue}`;
  if (f.state === 'FINAL') return `${line}.`;
  return f.scoreRed === f.scoreBlue
    ? `${line}, tied.`
    : `${line}; ${f.scoreRed > f.scoreBlue ? 'Red' : 'Blue'} leads by ${Math.abs(f.scoreRed - f.scoreBlue)}.`;
}
function observations(f) {
  const result = {};
  if (f.teams.some(t => t.count) || f.unassigned || f.spectators) result.roster = roster(f);
  if (f.teams.every(t => t.count > 0 && t.alive !== null))
    result.alive = `Currently alive: Red ${f.teams[0].alive}/${f.teams[0].count}, Blue ${f.teams[1].alive}/${f.teams[1].count}.`;
  return result;
}
function factual(s, selected) {
  const f = facts(s);
  if (f.stale) return `${freshnessWarning(s)} — last reported ${f.state}.`;
  if (f.state === 'WARMUP') return `Warmup — match has not started. ${roster(f)}`;
  if (f.state === 'UNKNOWN') return `Match state unavailable. ${roster(f)}`;
  if (!f.detailAvailable)
    return `${f.state === 'FINAL' ? 'Final' : 'Live'} — scoreboard detail unavailable. ${roster(f)}`;
  if (f.state === 'FINAL') return `Final — ${scoreline(f)}`;
  const options = observations(f);
  const detail =
    selected && Object.hasOwn(options, selected)
      ? options[selected]
      : Object.values(options).join(' ');
  return `Live — ${scoreline(f)}${detail ? ` ${detail}` : ''}`;
}
let sdk;
function configuredProvider(env) {
  if (env.SLIPGATE_AI_ANALYSIS !== 'true' || !env.OPENAI_API_KEY) return null;
  return async (evidence, options) => {
    if (!sdk) {
      const OpenAI = require('openai');
      const { openaiFetch } = require('../core/openaiFetch');
      sdk = new OpenAI({
        apiKey: env.OPENAI_API_KEY,
        fetch: openaiFetch,
        maxRetries: 0,
        timeout: 4000,
      });
    }
    const response = await sdk.chat.completions.create(
      buildChatRequest({
        messages: [
          {
            role: 'system',
            content:
              'Select the most useful additional numeric observation from the supplied options: roster or alive. Return JSON with one focus matching an available option. Null means unknown. Do not generate prose or infer positions, communication, causes, trends or outcomes.',
          },
          { role: 'user', content: JSON.stringify(evidence) },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 120,
      }),
      { signal: options.signal, timeout: 4000, maxRetries: 0 }
    );
    return JSON.parse(response.choices?.[0]?.message?.content || '{}');
  };
}
async function analyze(s, { provider, env = process.env, signal, timeoutMs = 4500 } = {}) {
  const enabled = provider || (env.SLIPGATE_AI_ANALYSIS === 'true' && Boolean(env.OPENAI_API_KEY));
  if (provider && !ids.has(provider)) ids.set(provider, nextId++);
  const key = fingerprint(
    s,
    enabled ? `ai:${provider ? ids.get(provider) : 'configured'}` : 'facts'
  );
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 600000) return hit.value;
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 16) return factual(s);
  const work = (async () => {
    let focus;
    const evidence = facts(s);
    const options = observations(evidence);
    if (
      !s.stale &&
      evidence.detailAvailable &&
      evidence.state === 'LIVE' &&
      Object.keys(options).length > 1 &&
      !signal?.aborted
    ) {
      const run = provider || configuredProvider(env);
      if (run) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        let timer;
        try {
          const result = await Promise.race([
            Promise.resolve().then(() =>
              run(
                { facts: evidence, options: Object.keys(options) },
                { signal: controller.signal, timeout: 4000, maxRetries: 0 }
              )
            ),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => {
                  controller.abort();
                  reject(new Error('Analysis timeout'));
                },
                Math.min(4500, Math.max(1, timeoutMs))
              );
            }),
            new Promise((_, reject) =>
              controller.signal.addEventListener(
                'abort',
                () => reject(new Error('Analysis aborted')),
                { once: true }
              )
            ),
          ]);
          if (typeof result?.focus === 'string' && Object.hasOwn(options, result.focus))
            focus = result.focus;
        } catch (_) {
          /* Deterministic factual fallback. */
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
        }
      }
    }
    const value = factual(s, focus);
    cache.set(key, { at: Date.now(), value });
    while (cache.size > 128) cache.delete(cache.keys().next().value);
    return value;
  })();
  pending.set(key, work);
  try {
    return await work;
  } finally {
    pending.delete(key);
  }
}
module.exports = { analyze, fingerprint, factual, facts, _cache: cache };
