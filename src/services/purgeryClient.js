'use strict';
const axios = require('axios');
const BASE = 'https://thepurgery.com/api/v1/players';
const validSteamId = value => typeof value === 'string' && /^7656119\d{10}$/.test(value);
function retryAfterMs(headers, now) {
  const value = headers?.['retry-after'] ?? headers?.['Retry-After'];
  const seconds = Number(value);
  if (value !== undefined && value !== null && Number.isFinite(seconds) && seconds >= 0)
    return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 1000;
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function createPurgeryClient({ httpGet = axios.get, now = Date.now } = {}) {
  const cache = new Map(),
    inflight = new Map(),
    starts = [];
  let blockedUntil = 0;
  async function dispatch(ids) {
    while (starts.length && starts[0] <= now() - 60000) starts.shift();
    if (now() < blockedUntil)
      throw Object.assign(new Error('Purgery request cooldown'), {
        code: 'PURGERY_RATE_LIMITED',
        status: 429,
        retryAfterMs: blockedUntil - now(),
      });
    if (starts.length >= 40)
      throw Object.assign(new Error('Purgery local request budget exhausted'), {
        code: 'PURGERY_RATE_LIMITED',
        status: 429,
        retryAfterMs: Math.max(1, starts[0] + 60000 - now()),
      });
    starts.push(now());
    const response = await httpGet(BASE, {
      params: { steam_ids: ids },
      timeout: 8000,
      maxContentLength: 512 * 1024,
      maxBodyLength: 512 * 1024,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    if (response?.status === 429) {
      const delay = retryAfterMs(response.headers, now());
      blockedUntil = Math.max(blockedUntil, now() + delay);
      throw Object.assign(new Error('Purgery rate limited the request'), {
        code: 'PURGERY_RATE_LIMITED',
        status: 429,
        retryAfterMs: delay,
      });
    }
    return response;
  }
  async function getPlayers(input) {
    if (!Array.isArray(input) || input.length > 50 || input.some(id => !validSteamId(id)))
      throw new TypeError('Expected at most 50 valid Steam IDs');
    const ids = [...new Set(input)].sort((a, b) => a.localeCompare(b, 'en'));
    if (!ids.length) return { players: [], missing: [] };
    const key = ids.join(',');
    const hit = cache.get(key);
    if (hit && hit.until > now()) {
      cache.delete(key);
      cache.set(key, hit);
      return clone(hit.value);
    }
    if (inflight.has(key)) return clone(await inflight.get(key));
    const promise = (async () => {
      const response = await dispatch(ids.join(','));
      if (response?.status === 404) return { players: [], missing: ids };
      if (response?.status < 200 || response?.status >= 300)
        throw Object.assign(new Error(`Purgery HTTP ${response?.status ?? 'invalid'}`), {
          status: response?.status,
        });
      const data = response.data;
      if (!data || !Array.isArray(data.players) || data.players.length > 50)
        throw new Error('Invalid Purgery response');
      const players = [],
        seen = new Set();
      for (const row of data.players) {
        if (
          !row ||
          !validSteamId(row.steam_id) ||
          !ids.includes(row.steam_id) ||
          row.private === true ||
          seen.has(row.steam_id)
        )
          throw new Error('Invalid or ambiguous Purgery player row');
        seen.add(row.steam_id);
        const rawVictims = row.pummels?.victims;
        if (rawVictims != null && !Array.isArray(rawVictims))
          throw new Error('Invalid Purgery victim list');
        const victims = (rawVictims || []).slice(0, 100).map(v => {
          if (!validSteamId(v?.steam_id) || !Number.isSafeInteger(v.count) || v.count < 0)
            throw new Error('Invalid Purgery victim row');
          return {
            steam_id: v.steam_id,
            name: typeof v.name === 'string' ? v.name.slice(0, 120) : null,
            count: v.count,
          };
        });
        players.push({
          steam_id: row.steam_id,
          name_plain: typeof row.name_plain === 'string' ? row.name_plain.slice(0, 120) : '',
          pummels: {
            total:
              Number.isSafeInteger(row.pummels?.total) && row.pummels.total >= 0
                ? row.pummels.total
                : null,
            victims,
          },
          games: {
            completed:
              Number.isSafeInteger(row.games?.completed) && row.games.completed >= 0
                ? row.games.completed
                : null,
            left:
              Number.isSafeInteger(row.games?.left) && row.games.left >= 0 ? row.games.left : null,
          },
        });
      }
      const value = { players, missing: ids.filter(id => !seen.has(id)) };
      cache.set(key, { until: now() + 60000, value: clone(value) });
      while (cache.size > 128) cache.delete(cache.keys().next().value);
      return value;
    })().finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return clone(await promise);
  }
  return { getPlayers };
}
const defaultClient = createPurgeryClient();
module.exports = { createPurgeryClient, defaultClient, validSteamId };
