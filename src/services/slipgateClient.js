'use strict';
const axios = require('axios');
const { randomUUID } = require('node:crypto');
const BASE = 'https://slipgate.gg/api/v1';
const validAddress = value =>
  typeof value === 'string' &&
  value.length <= 255 &&
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?|\[[0-9a-fA-F:]+\]):\d{1,5}$/.test(value) &&
  Number(value.slice(value.lastIndexOf(':') + 1)) > 0 &&
  Number(value.slice(value.lastIndexOf(':') + 1)) <= 65535;
const validSteamId = value => typeof value === 'string' && /^7656119\d{10}$/.test(value);
const validGuid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const positive = value =>
  /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const number = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const string = value => (typeof value === 'string' ? value.slice(0, 512) : null);
const { matchState } = require('./quakeScoreboardPresentation');
function budgetPolicy(env = process.env, apiKey = env.SLIPGATE_API_KEY) {
  const fraction = Number(env.SLIPGATE_WATCH_BUDGET_FRACTION);
  const confirmed =
    positive(env.SLIPGATE_CONFIRMED_REQUESTS_PER_WINDOW) &&
    positive(env.SLIPGATE_CONFIRMED_WINDOW_SECONDS) &&
    Number.isFinite(fraction) &&
    fraction > 0 &&
    fraction <= 0.25;
  const capacity = confirmed
    ? Math.min(1000, Math.floor(Number(env.SLIPGATE_CONFIRMED_REQUESTS_PER_WINDOW) * fraction))
    : 0;
  const windowMs = confirmed ? Number(env.SLIPGATE_CONFIRMED_WINDOW_SECONDS) * 1000 : 60000;
  const enabled = confirmed && capacity > 0 && Number.isSafeInteger(windowMs);
  const experimental =
    !enabled &&
    env.SLIPGATE_EXPERIMENTAL_POLLING === 'true' &&
    typeof apiKey === 'string' &&
    apiKey.trim().length > 0 &&
    positive(env.SLIPGATE_EXPERIMENTAL_REQUESTS_PER_MINUTE) &&
    Number(env.SLIPGATE_EXPERIMENTAL_REQUESTS_PER_MINUTE) <= 6;
  if (experimental)
    return {
      enabled: true,
      reason: null,
      experimental: true,
      providerQuotaConfirmed: false,
      budgetLabel: 'experimental local budget (provider quota unknown)',
      minIntervalMs: Math.ceil(60000 / Number(env.SLIPGATE_EXPERIMENTAL_REQUESTS_PER_MINUTE)),
      capacity: Number(env.SLIPGATE_EXPERIMENTAL_REQUESTS_PER_MINUTE),
      windowMs: 60000,
    };
  return {
    enabled,
    experimental: false,
    providerQuotaConfirmed: confirmed,
    budgetLabel: enabled
      ? 'confirmed provider budget'
      : 'demand-only local budget (polling disabled)',
    reason: enabled
      ? null
      : 'Polling disabled: confirmed finite quota/window and a share up to 0.25 allowing at least one request are required.',
    minIntervalMs: enabled ? Math.ceil(windowMs / capacity) : 0,
    capacity: enabled ? capacity : 60,
    windowMs: enabled ? windowMs : 60000,
  };
}
function createSlipgateClient({
  httpGet = axios.get,
  httpPost = axios.post,
  now = Date.now,
  env = process.env,
  sleep = ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 60000))),
  apiKey = env.SLIPGATE_API_KEY,
} = {}) {
  const policy = budgetPolicy(env, apiKey);
  const spacing = Math.ceil(policy.windowMs / policy.capacity);
  const cache = new Map(),
    inflight = new Map(),
    ratingCache = new Map(),
    matchLifecycles = new Map();
  let ratingsBlockedUntil = 0;
  let gate = Promise.resolve(),
    lastStart = -Infinity,
    blockedUntil = 0;
  const starts = [];
  const cooldown = () =>
    Object.assign(
      new Error(`Slipgate cooldown active for ${Math.ceil((blockedUntil - now()) / 1000)}s`),
      { status: 429, retryAfterMs: Math.max(0, blockedUntil - now()) }
    );
  function canonical(path, params = {}) {
    if (
      typeof path !== 'string' ||
      !/^\/(servers|matches)(\/[^/?#]+)?(\?[^#]*)?$/.test(path) ||
      path.includes('..')
    )
      throw new TypeError('Invalid Slipgate API path');
    const url = new URL(BASE + path);
    const suffix = url.pathname.slice('/api/v1'.length);
    const parts = suffix.split('/');
    if (parts[2]) {
      let decoded;
      try {
        decoded = decodeURIComponent(parts[2]);
      } catch (_) {
        throw new TypeError('Invalid Slipgate API path');
      }
      if (!(parts[1] === 'servers' ? validAddress(decoded) : validGuid(decoded)))
        throw new TypeError('Invalid Slipgate API path');
    }
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const sorted = Object.fromEntries(
      [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
    );
    if (
      Object.keys(sorted).some(
        k =>
          !['limit', 'offset', 'active', 'include_rules', 'include_prediction', 'server'].includes(
            k
          )
      )
    )
      throw new TypeError('Invalid Slipgate query');
    if (sorted.server && !validAddress(sorted.server))
      throw new TypeError('Invalid server address');
    for (const key of ['offset', 'limit'])
      if (
        sorted[key] !== undefined &&
        (!/^\d{1,6}$/.test(sorted[key]) || Number(sorted[key]) > (key === 'limit' ? 500 : 5000))
      )
        throw new TypeError('Invalid pagination');
    return { path: suffix, params: sorted, key: `${suffix}:${JSON.stringify(sorted)}` };
  }
  async function admit() {
    if (now() < blockedUntil) throw cooldown();
    let delay;
    do {
      const t = now();
      while (starts.length && starts[0] <= t - policy.windowMs) starts.shift();
      delay = Math.max(
        0,
        lastStart + spacing - t,
        starts.length >= policy.capacity ? starts[0] + policy.windowMs - t : 0
      );
      if (delay > 0) await sleep(delay);
      if (now() < blockedUntil) throw cooldown();
    } while (delay > 0);
    lastStart = now();
    starts.push(lastStart);
  }
  function bulk(body) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body)
        .sort((a, b) => a.localeCompare(b))
        .join(',') !== 'game_type,rating_set,steam_ids' ||
      body.game_type !== 'ca' ||
      !['A', 'B'].includes(body.rating_set) ||
      !Array.isArray(body.steam_ids) ||
      !body.steam_ids.length ||
      body.steam_ids.length > 64 ||
      !body.steam_ids.every(validSteamId)
    )
      throw new TypeError('Invalid Slipgate ratings body');
    return {
      steam_ids: [...new Set(body.steam_ids)].sort((a, b) => a.localeCompare(b)),
      game_type: body.game_type,
      rating_set: body.rating_set,
    };
  }
  function validateRatings(data, body) {
    if (
      data?.ok !== true ||
      data.game_type !== body.game_type ||
      data.rating_set !== body.rating_set ||
      !Array.isArray(data.players) ||
      data.players.length > 200
    )
      throw new Error('Invalid Slipgate ratings response');
    const requested = new Set(body.steam_ids),
      seen = new Set();
    const players = [];
    for (const p of data.players) {
      if (!p || !requested.has(p.steam_id)) continue;
      if (
        seen.has(p.steam_id) ||
        typeof p.found !== 'boolean' ||
        (p.found && p.display != null && !Number.isSafeInteger(p.display)) ||
        (p.provisional != null && typeof p.provisional !== 'boolean')
      )
        throw new Error('Invalid Slipgate ratings player');
      seen.add(p.steam_id);
      players.push({
        steam_id: p.steam_id,
        found: p.found,
        ...(p.found && Number.isSafeInteger(p.display) ? { display: p.display } : {}),
        ...(typeof p.provisional === 'boolean' ? { provisional: p.provisional } : {}),
      });
    }
    if (seen.size !== requested.size) throw new Error('Slipgate ratings response mismatch');
    return { ok: true, game_type: body.game_type, rating_set: body.rating_set, players };
  }
  async function request(path, options = {}) {
    const method = options.method ?? 'GET';
    let c;
    if (method === 'POST' && path === '/ratings/bulk' && options.params === undefined) {
      const body = bulk(options.body);
      if (!apiKey || !String(apiKey).trim())
        throw new Error('Slipgate ratings authentication required');
      if (now() < ratingsBlockedUntil) throw new Error('Slipgate ratings authentication cooldown');
      c = {
        path,
        body,
        key: `POST:${path}:${JSON.stringify(body)}${options.cacheScope ? `:${options.cacheScope}` : ''}`,
      };
    } else {
      if (method !== 'GET' || options.body !== undefined)
        throw new TypeError('Invalid Slipgate method/body');
      c = canonical(path, options.params);
    }
    const saved = cache.get(c.key);
    if (!options.noCache && saved && now() < saved.until) return saved.response;
    if (inflight.has(c.key)) return inflight.get(c.key);
    if (now() < blockedUntil) throw cooldown();
    if (inflight.size >= 64) throw new Error('Slipgate local request queue full');
    const admission = gate.then(admit);
    gate = admission.catch(() => {
      /* Keep later admissions usable after failures. */
    });
    const promise = (async () => {
      await admission;
      if (now() < blockedUntil) throw cooldown();
      if (c.body && now() < ratingsBlockedUntil)
        throw new Error('Slipgate ratings authentication cooldown');
      try {
        const config = {
          ...(c.body ? {} : { params: c.params }),
          maxRedirects: 0,
          timeout: 2500,
          maxContentLength: 1048576,
          maxBodyLength: 1048576,
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        };
        const response = c.body
          ? await httpPost(`${BASE}${c.path}`, c.body, config)
          : await httpGet(`${BASE}${c.path}`, config);
        const data = c.body ? validateRatings(response.data, c.body) : stripPrivate(response.data);
        const ttl = c.body
          ? 900000
          : c.path === '/servers'
            ? 300000
            : c.path.startsWith('/matches')
              ? 60000
              : 20000;
        const stored = { ...response, data, slipgateFetchedAt: now() };
        cache.set(c.key, { response: stored, until: now() + ttl });
        while (cache.size > 256) cache.delete(cache.keys().next().value);
        return stored;
      } catch (error) {
        const status = error?.response?.status;
        if (c.body && [401, 403].includes(status)) ratingsBlockedUntil = now() + 900000;
        if (status === 429) {
          const ra = error.response.headers?.['retry-after'];
          const secs =
            (typeof ra === 'string' && /^\d+(\.\d+)?$/.test(ra)) ||
            (typeof ra === 'number' && ra >= 0)
              ? Number(ra)
              : NaN;
          const until = Number.isFinite(secs) ? now() + secs * 1000 : Date.parse(ra);
          blockedUntil = Math.max(blockedUntil, Number.isFinite(until) ? until : now() + 60000);
        }
        throw Object.assign(
          new Error(status === 429 ? 'Slipgate rate limited' : 'Slipgate request failed'),
          { status, code: error?.code, retryAfterMs: Math.max(0, blockedUntil - now()) }
        );
      }
    })();
    inflight.set(c.key, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(c.key);
    }
  }
  function stripPrivate(data) {
    const cleanPrediction = prediction => {
      if (!prediction || typeof prediction !== 'object') return prediction;
      return {
        ...prediction,
        ...(Array.isArray(prediction.red)
          ? { red: prediction.red.filter(p => p && !p.private) }
          : {}),
        ...(Array.isArray(prediction.blue)
          ? { blue: prediction.blue.filter(p => p && !p.private) }
          : {}),
      };
    };
    if (!data || typeof data !== 'object') return data;
    return {
      ...data,
      ...(data.prediction ? { prediction: cleanPrediction(data.prediction) } : {}),
      ...(data.live && typeof data.live === 'object'
        ? {
            live: {
              ...data.live,
              ...(Array.isArray(data.live.players)
                ? {
                    players: data.live.players.map(p =>
                      p?.private ? { ...p, name: 'Anonymous', steam_id: null } : p
                    ),
                  }
                : {}),
              ...(data.live.prediction
                ? { prediction: cleanPrediction(data.live.prediction) }
                : {}),
            },
          }
        : {}),
    };
  }
  function safePrediction(value, gameType, ratingSet) {
    if (
      !value ||
      value.family !== 'team' ||
      value.state !== 'live' ||
      value.game_type !== 'ca' ||
      gameType !== 'ca' ||
      !['A', 'B'].includes(value.rating_set) ||
      value.rating_set !== ratingSet ||
      !['set', 'top'].includes(value.basis) ||
      typeof value.calibrated !== 'boolean' ||
      typeof value.conditioned !== 'boolean'
    )
      return null;
    const pair = v =>
      v &&
      Number.isFinite(v.red) &&
      Number.isFinite(v.blue) &&
      v.red >= 0 &&
      v.red <= 1 &&
      v.blue >= 0 &&
      v.blue <= 1 &&
      Math.abs(v.red + v.blue - 1) <= 0.002;
    if (
      !pair(value.probs) ||
      !pair(value.prior) ||
      !Number.isFinite(value.fairness) ||
      value.fairness < 0 ||
      value.fairness > 1 ||
      !Number.isSafeInteger(value.roundlimit) ||
      value.roundlimit < 1 ||
      (value.basis === 'set' && !value.calibrated)
    )
      return null;
    const members = rows =>
      Array.isArray(rows)
        ? rows
            .slice(0, 64)
            .filter(p => p && !p.private)
            .map(p => ({
              steam_id: validSteamId(p.steam_id) ? p.steam_id : null,
              name: string(p.name),
              name_plain: string(p.name_plain),
              private: false,
              team: number(p.team),
              display: Number.isSafeInteger(p.display) ? p.display : null,
              share: number(p.share),
            }))
        : [];
    return {
      family: 'team',
      state: 'live',
      game_type: 'ca',
      rating_set: value.rating_set,
      basis: value.basis,
      calibrated: value.calibrated,
      conditioned: value.conditioned,
      roundlimit: value.roundlimit,
      prior: { red: value.prior.red, blue: value.prior.blue },
      probs: { red: value.probs.red, blue: value.probs.blue },
      fairness: value.fairness,
      red: members(value.red),
      blue: members(value.blue),
    };
  }
  function normalize(detail, response, includePrediction, stale = false, staleReason = null) {
    const live = detail.live || {},
      info = detail.info || {};
    const updated = detail.updated_at ?? detail.source_updated_at ?? live.updated_at;
    const oldSource =
      typeof updated === 'string' &&
      Number.isFinite(Date.parse(updated)) &&
      now() - Date.parse(updated) > 120000;
    return {
      address: detail.addr,
      name: string(detail.name ?? info.name) || detail.addr,
      map: string(live.map ?? info.map),
      state: string(live.state),
      gameType: string(live.game_type ?? info.game_type),
      ratingSet:
        [live.rating_set, info.rating_set].find(value => ['A', 'B'].includes(value)) ??
        (info.standard_factory === true ? 'A' : info.standard_factory === false ? 'B' : null),
      matchGuid: validGuid(live.match_guid) ? live.match_guid : null,
      round: number(live.round),
      elapsedSeconds: number(live.elapsed_sec),
      scoreRed: number(live.score_red),
      scoreBlue: number(live.score_blue),
      players: (Array.isArray(live.players) ? live.players : [])
        .filter(p => p && typeof p === 'object')
        .slice(0, 64)
        .map(p => ({
          name: p.private ? 'Anonymous' : string(p.name),
          steamId: !p.private && validSteamId(p.steam_id) ? p.steam_id : null,
          team: number(p.team),
          kills: number(p.kills),
          deaths: number(p.deaths),
          score: number(p.score),
          damage: number(p.damage_dealt),
          alive: typeof p.alive === 'boolean' ? p.alive : null,
          private: Boolean(p.private),
        })),
      prediction: includePrediction
        ? safePrediction(
            detail.prediction ?? live.prediction,
            live.game_type ?? info.game_type,
            [live.rating_set, info.rating_set].find(value => ['A', 'B'].includes(value)) ??
              (info.standard_factory === true ? 'A' : info.standard_factory === false ? 'B' : null)
          )
        : null,
      sourceUpdatedAt:
        typeof updated === 'string' && Number.isFinite(Date.parse(updated))
          ? new Date(updated).toISOString()
          : null,
      fetchedAt: response.slipgateFetchedAt,
      stale: stale || oldSource,
      staleReason: staleReason || (oldSource ? 'Source timestamp is older than two minutes' : null),
      quality: {
        a2sOnly: Boolean(live.a2s_only ?? detail.a2s_only ?? !detail.live),
        scoreSource: string(live.score_source ?? detail.score_source),
        connStatus: string(detail.conn_status),
      },
    };
  }
  async function enrichRatings(snapshot) {
    const mode = snapshot.gameType,
      set = snapshot.ratingSet;
    const scope = `${snapshot.address}:${mode}:${set}`;
    let lifecycle = matchLifecycles.get(scope);
    const phase = snapshot.quality?.a2sOnly ? 'unknown' : matchState(snapshot).toLowerCase();
    const matchToken = snapshot.matchGuid || null;
    let newMatch = false;
    if (!lifecycle)
      lifecycle = {
        guid: null,
        phase: null,
        map: snapshot.map,
        token: `session-${now()}-${randomUUID()}`,
      };
    if (
      !snapshot.stale &&
      phase !== 'unknown' &&
      matchToken &&
      lifecycle.guid &&
      matchToken !== lifecycle.guid
    )
      newMatch = true;
    if (!snapshot.stale && phase === 'warmup' && ['live', 'final'].includes(lifecycle.phase))
      newMatch = true;
    if (
      !snapshot.stale &&
      phase !== 'unknown' &&
      !matchToken &&
      lifecycle.map &&
      snapshot.map &&
      lifecycle.map !== snapshot.map
    )
      newMatch = true;
    if (newMatch) {
      for (const key of ratingCache.keys())
        if (key.startsWith(`${scope}:`)) ratingCache.delete(key);
      lifecycle = {
        guid: null,
        phase: null,
        map: snapshot.map,
        token: `session-${now()}-${randomUUID()}`,
      };
    }
    if (!snapshot.stale && phase !== 'unknown' && !snapshot.quality?.a2sOnly) {
      if (matchToken) lifecycle.guid = matchToken;
      lifecycle.phase = phase;
      if (snapshot.map) lifecycle.map = snapshot.map;
      matchLifecycles.delete(scope);
      matchLifecycles.set(scope, lifecycle);
    }
    while (matchLifecycles.size > 128) {
      const oldest = matchLifecycles.keys().next().value;
      matchLifecycles.delete(oldest);
      for (const key of ratingCache.keys())
        if (key.startsWith(`${oldest}:`)) ratingCache.delete(key);
    }
    const players = snapshot.players || [];
    const eligible = p => !p.private && [0, 1, 2].includes(p.team) && validSteamId(p.steamId);
    const roster = () =>
      JSON.stringify((snapshot.players || []).map(p => [p.steamId, p.team, Boolean(p.private)]));
    const identity = roster();
    const cleanSnapshot = () => ({
      ...snapshot,
      players: (snapshot.players || []).map(p => {
        const { rating: _rating, ...rest } = p;
        return p.private ? { ...rest, name: 'Anonymous', steamId: null } : rest;
      }),
    });
    if (!apiKey || mode !== 'ca' || !['A', 'B'].includes(set) || snapshot.stale)
      return cleanSnapshot();
    const cacheKey = id => `${scope}:${lifecycle.token}:${id}`;
    const prediction = safePrediction(snapshot.prediction, mode, set);
    const members =
      phase === 'live' && prediction?.basis === 'set' && prediction.calibrated === true
        ? [
            ...prediction.red.map(p => ({ player: p, side: 1 })),
            ...prediction.blue.map(p => ({ player: p, side: 2 })),
          ]
        : [];
    const memberIds = new Map();
    for (const { player: p, side } of members)
      if (validSteamId(p.steam_id)) {
        if (memberIds.has(p.steam_id) || p.private || p.team !== side)
          memberIds.set(p.steam_id, null);
        else memberIds.set(p.steam_id, side);
      }
    for (const p of players) {
      const team = memberIds.get(p.steamId);
      const member = members.find(m => m.player.steam_id === p.steamId)?.player;
      if (
        !ratingCache.has(cacheKey(p.steamId)) &&
        team &&
        team === p.team &&
        eligible(p) &&
        (Number.isSafeInteger(member?.display) || member?.display === null)
      ) {
        ratingCache.set(cacheKey(p.steamId), {
          player: { found: member.display !== null, display: member.display },
        });
      }
    }
    const ids = [...new Set(players.filter(eligible).map(p => p.steamId))].slice(0, 64);
    const missing = ids.filter(
      id => !ratingCache.has(cacheKey(id)) || now() >= ratingCache.get(cacheKey(id)).until
    );
    if (missing.length && now() >= ratingsBlockedUntil) {
      try {
        const response = await request('/ratings/bulk', {
          method: 'POST',
          body: { steam_ids: missing, game_type: mode, rating_set: set },
          noCache: true,
          cacheScope: lifecycle.token,
        });
        if (matchLifecycles.get(scope)?.token === lifecycle.token) {
          for (const p of response.data.players) {
            ratingCache.set(cacheKey(p.steam_id), { player: p });
          }
        }
        while (ratingCache.size > 512) ratingCache.delete(ratingCache.keys().next().value);
      } catch (_) {
        // Optional ratings never make a healthy scoreboard fail. No automatic retries.
      }
    }
    const result = cleanSnapshot();
    if (
      snapshot.gameType !== mode ||
      snapshot.ratingSet !== set ||
      roster() !== identity ||
      matchLifecycles.get(scope)?.token !== lifecycle.token
    )
      return result;
    result.players = result.players.map(p => {
      const cached = eligible(p) ? ratingCache.get(cacheKey(p.steamId)) : null;
      const r = cached ? cached.player : null;
      return r?.found && Number.isSafeInteger(r.display)
        ? {
            ...p,
            rating: {
              display: r.display,
              ...(typeof r.provisional === 'boolean' ? { provisional: r.provisional } : {}),
            },
          }
        : p;
    });
    return result;
  }
  async function getServer(addr, { forceRefresh = false, includePrediction = false } = {}) {
    if (!validAddress(addr)) throw new TypeError('Invalid server address');
    const path = `/servers/${encodeURIComponent(addr)}`;
    const params = {
      include_rules: true,
      ...(includePrediction ? { include_prediction: true } : {}),
    };
    try {
      const response = await request(path, { params, noCache: forceRefresh });
      if (!response.data?.ok || response.data.addr !== addr)
        throw new Error('Slipgate server response mismatch');
      return await enrichRatings(normalize(response.data, response, includePrediction));
    } catch (error) {
      const old = cache.get(canonical(path, params).key)?.response;
      if (old?.data?.ok && old.data.addr === addr && now() - old.slipgateFetchedAt <= 600000)
        return normalize(old.data, old, includePrediction, true, error.message);
      throw error;
    }
  }
  async function catalogue({ forceRefresh = false, limit = 100, active } = {}) {
    const servers = [];
    for (let page = 0; page < 10; page++) {
      const params = {
        limit,
        ...(page ? { offset: page * limit } : {}),
        ...(active ? { active: 'true' } : {}),
      };
      const d = (await request('/servers', { params, noCache: forceRefresh })).data;
      if (!d?.ok || !Array.isArray(d.servers)) throw new Error('Invalid Slipgate catalogue');
      servers.push(...d.servers.slice(0, limit));
      if (d.servers.length < limit) break;
    }
    return servers;
  }
  async function selectServer(filter = '', options = {}) {
    const f = String(filter).trim();
    if (
      f.length > 100 ||
      /[\\/<>@]/.test(f) ||
      [...f].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    )
      throw new TypeError('Invalid server filter');
    if (validAddress(f)) return getServer(f, options);
    const rows = await catalogue();
    const candidates = rows
      .filter(
        s =>
          s.region === 'OCE' &&
          validAddress(s.addr) &&
          (!f ||
            String(s.name || '')
              .toLowerCase()
              .includes(f.toLowerCase()))
      )
      .sort((a, b) => (number(b.players) || 0) - (number(a.players) || 0));
    return candidates.length ? getServer(candidates[0].addr, options) : null;
  }
  async function listMatches(addr) {
    if (!validAddress(addr)) throw new TypeError('Invalid server address');
    const d = (await request('/matches', { params: { server: addr, limit: 50 } })).data;
    if (!Array.isArray(d?.matches)) throw new Error('Invalid Slipgate archive');
    return d.matches.slice(0, 50);
  }
  async function getMatch(guid) {
    if (!validGuid(guid)) throw new TypeError('Invalid match GUID');
    const d = (await request(`/matches/${encodeURIComponent(guid)}`)).data;
    const match = d?.match ?? d;
    if (!Array.isArray(match?.rounds)) throw new Error('Invalid Slipgate match');
    return match;
  }
  return {
    request,
    catalogue,
    pollingPolicy: () => ({
      enabled: policy.enabled,
      reason: policy.reason,
      minIntervalMs: policy.minIntervalMs,
      experimental: policy.experimental,
      providerQuotaConfirmed: policy.providerQuotaConfirmed,
      budgetLabel: policy.budgetLabel,
      cooldownMs: Math.max(0, blockedUntil - now()),
    }),
    enrichRatings,
    selectServer,
    getServer,
    listMatches,
    getMatch,
  };
}
const defaultClient = createSlipgateClient();
module.exports = {
  createSlipgateClient,
  defaultClient,
  budgetPolicy,
  validSlipgateAddress: validAddress,
};
