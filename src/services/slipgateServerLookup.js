/**
 * Slipgate-backed Quake Live server discovery.
 *
 * Fetches the public server catalogue, narrows it to populated Oceania servers,
 * and gets the selected servers' live details concurrently. The returned shape
 * matches the legacy Syncore payload consumed by quakeLookup's existing renderer.
 */
const { createSlipgateClient, defaultClient, validSlipgateAddress } = require('./slipgateClient');

const SLIPGATE_BASE_URL = 'https://slipgate.gg/api/v1';
const SLIPGATE_SERVER_PAGE_BASE = 'https://slipgate.gg/servers';
const DEFAULT_CACHE_MINUTES = 5;
const REQUEST_TIMEOUT_MS = 2500;

function cacheDurationMs(cacheMinutes) {
  return Math.max(1, cacheMinutes) * 60 * 1000;
}

function mapDetailToLegacyServer(detail, now) {
  const info = detail.info || {};
  const live = detail.live || {};
  const rules = info.rules || {};
  const playerCount = Number.isFinite(live.player_count) ? live.player_count : detail.players || 0;
  const elapsedSeconds = Number.isFinite(live.elapsed_sec) ? live.elapsed_sec : 0;
  const levelStartTime = Math.floor(now() / 1000) - elapsedSeconds;
  const gameType = info.game_name || live.game_type || info.game_type || 'Unknown';
  const gameTypeShort = String(live.game_type || info.game_type || '').toUpperCase();

  return {
    address: detail.addr,
    source: 'slipgate',
    sourceUrl: `${SLIPGATE_SERVER_PAGE_BASE}/${encodeURIComponent(detail.addr)}`,
    info: {
      serverName: info.name || detail.name || detail.addr,
      map: live.map || info.map || 'Unknown',
      players: playerCount,
      maxPlayers: info.max_clients || playerCount,
      gameTypeShort,
      gameType,
    },
    rules: {
      g_levelStartTime: String(levelStartTime),
      g_redScore: live.score_red ?? null,
      g_blueScore: live.score_blue ?? null,
      roundlimit: rules.roundlimit || '',
    },
    players: (live.players || []).map(player => ({
      name: player.private ? 'Anonymous' : player.name,
      team: player.team,
      score: player.score,
      totalConnected: player.connected_sec,
    })),
  };
}

function createSlipgateServerLookup({
  apiKey = process.env.SLIPGATE_API_KEY,
  cacheMinutes = parseInt(process.env.SLIPGATE_CACHE_MINUTES, 10) || DEFAULT_CACHE_MINUTES,
  httpGet,
  now = Date.now,
  sleep,
  client: injectedClient,
} = {}) {
  const cacheMs = cacheDurationMs(cacheMinutes);
  const client =
    injectedClient ||
    (httpGet ? createSlipgateClient({ httpGet, now, sleep, env: {}, apiKey }) : defaultClient);
  let catalogueCache = null;
  const detailCache = new Map();
  const request = (url, options) =>
    client.request(url.slice(SLIPGATE_BASE_URL.length), { ...options, noCache: options?.noCache });

  async function getCatalogue(forceRefresh = false) {
    if (!forceRefresh && catalogueCache && now() - catalogueCache.timestamp < cacheMs) {
      return catalogueCache.value;
    }

    const servers = await client.catalogue({ forceRefresh, active: true, limit: 500 });
    catalogueCache = { timestamp: now(), value: servers };
    return catalogueCache.value;
  }

  async function getDetail(address, forceRefresh = false) {
    const cached = detailCache.get(address);
    if (!forceRefresh && cached && now() - cached.timestamp < cacheMs) {
      return cached.value;
    }

    const response = await request(`${SLIPGATE_BASE_URL}/servers/${encodeURIComponent(address)}`, {
      params: { include_rules: true },
      noCache: forceRefresh,
      timeout: REQUEST_TIMEOUT_MS,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      maxRedirects: 0,
    });
    if (!response?.data?.ok || response.data.addr !== address) {
      throw new Error(`Slipgate returned invalid details for ${address}`);
    }

    detailCache.set(address, { timestamp: now(), value: response.data });
    while (detailCache.size > 128) detailCache.delete(detailCache.keys().next().value);
    return response.data;
  }

  async function getServers({ serverFilter = '', maxServers = 3, forceRefresh = false } = {}) {
    const filter = String(serverFilter || '').toLowerCase();
    const selected = (await getCatalogue(forceRefresh))
      .filter(server => {
        const name = String(server.name || '').toLowerCase();
        const address = String(server.addr || '').toLowerCase();
        return (
          server.region === 'OCE' &&
          validSlipgateAddress(server.addr) &&
          Number(server.players) > 0 &&
          (!filter || name.includes(filter) || address.includes(filter))
        );
      })
      .sort((a, b) => Number(b.players) - Number(a.players))
      .slice(0, Math.max(1, Math.min(3, Number(maxServers) || 3)));

    const details = await Promise.all(selected.map(server => getDetail(server.addr, forceRefresh)));
    return details.map(detail => mapDetailToLegacyServer(detail, now));
  }

  return { getServers };
}

const defaultLookup = createSlipgateServerLookup();

module.exports = {
  SLIPGATE_BASE_URL,
  createSlipgateServerLookup,
  getSlipgateOceaniaServers: options => defaultLookup.getServers(options),
  _test: { mapDetailToLegacyServer },
};
