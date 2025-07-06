/**
 * QLStats.net Scraper Module
 *
 * This module scrapes qlstats.net for detailed Quake Live server and player statistics
 * including Glicko ratings, team assignments, and enhanced player data.
 * Designed to complement the Syncore scraper for comprehensive server information.
 *
 * @module QLStatsScraper
 * @author Brett
 * @version 1.0.0
 */

const axios = require('axios');
const { quake: quakeLogger } = require('../core/logger');

/**
 * In-memory cache for scraped data to avoid repeated requests
 * @type {Map<string, {data: Object, timestamp: number}>}
 */
const dataCache = new Map();

/**
 * Cache duration in milliseconds (default: 3 minutes)
 * @type {number}
 */
const CACHE_DURATION = (parseInt(process.env.QLSTATS_CACHE_MINUTES, 10) || 3) * 60 * 1000;

/**
 * Request timeout in milliseconds
 * @type {number}
 */
const REQUEST_TIMEOUT = parseInt(process.env.QLSTATS_TIMEOUT_MS, 10) || 8000;

/**
 * Base URL for QLStats.net
 * @type {string}
 */
const QLSTATS_BASE_URL = 'https://qlstats.net';

/**
 * Check if cached data is still valid
 * @param {string} cacheKey - The cache key to check
 * @returns {boolean} True if cache is valid, false otherwise
 */
function isCacheValid(cacheKey) {
  const cached = dataCache.get(cacheKey);
  if (!cached) return false;

  const age = Date.now() - cached.timestamp;
  return age < CACHE_DURATION;
}

/**
 * Get cached data if valid
 * @param {string} cacheKey - The cache key to retrieve
 * @returns {Object|null} Cached data or null if invalid/missing
 */
function getCachedData(cacheKey) {
  if (isCacheValid(cacheKey)) {
    const cached = dataCache.get(cacheKey);
    quakeLogger.debug({ cacheKey }, 'Using cached QLStats data');
    return cached.data;
  }
  return null;
}

/**
 * Set data in cache
 * @param {string} cacheKey - The cache key to set
 * @param {Object} data - The data to cache
 */
function setCachedData(cacheKey, data) {
  dataCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
  });
  quakeLogger.debug({ cacheKey }, 'Cached QLStats data');
}

/**
 * Clean player name by removing color codes and extra whitespace
 * @param {string} name - Player name to clean
 * @returns {string} Cleaned player name
 */
function cleanPlayerName(name) {
  if (!name) return '';
  // Remove Quake color codes (^1, ^2, etc.) and trim whitespace
  return name.replace(/\^\d+/g, '').trim();
}

/**
 * Fetch enhanced player data from QLStats.net for a specific server
 * @param {string} serverAddress - Server IP:port (e.g., "45.125.247.91:27960")
 * @returns {Promise<Object|null>} Enhanced player data or null if unavailable
 */
async function fetchQLStatsPlayerData(serverAddress) {
  if (!serverAddress) {
    throw new Error('Server address is required');
  }

  // Check cache first
  const cacheKey = `qlstats_${serverAddress}`;
  const cachedData = getCachedData(cacheKey);
  if (cachedData) {
    return cachedData;
  }

  try {
    // Try to fetch player data from the JSON API endpoint
    const playersUrl = `${QLSTATS_BASE_URL}/api/server/${serverAddress}/players`;

    quakeLogger.info({ serverAddress, playersUrl }, 'Fetching QLStats data for server');

    const response = await axios.get(playersUrl, {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });

    if (response.status !== 200) {
      quakeLogger.warn(
        {
          serverAddress,
          status: response.status,
        },
        'QLStats API returned non-200 status'
      );
      return null;
    }

    const responseData = response.data;

    // Check if response has the expected structure
    if (!responseData || !responseData.ok || !Array.isArray(responseData.players)) {
      quakeLogger.warn(
        {
          serverAddress,
          dataType: typeof responseData,
          hasPlayers: responseData ? !!responseData.players : false,
        },
        'QLStats API returned unexpected data structure'
      );
      return null;
    }

    const playerData = responseData.players;

    // Process and enhance the player data
    const enhancedPlayers = playerData.map(player => ({
      steamid: player.steamid || '',
      name: cleanPlayerName(player.name || ''),
      originalName: player.name || '',
      team: player.team || 0,
      rating: player.rating || 0,
      ratingDeviation: player.rd || 0,
      // Map team numbers to readable names
      teamName: getTeamName(player.team),
    }));

    const result = {
      serverAddress,
      playerCount: enhancedPlayers.length,
      players: enhancedPlayers,
      lastUpdated: new Date().toISOString(),
    };

    // Cache the result
    setCachedData(cacheKey, result);

    quakeLogger.info(
      {
        serverAddress,
        playerCount: enhancedPlayers.length,
      },
      'Successfully fetched QLStats player data'
    );

    return result;
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      quakeLogger.warn(
        {
          serverAddress,
          error: error.message,
        },
        'QLStats.net appears to be unavailable'
      );
    } else if (error.code === 'ECONNABORTED') {
      quakeLogger.warn(
        {
          serverAddress,
          timeout: REQUEST_TIMEOUT,
        },
        'QLStats request timed out'
      );
    } else {
      quakeLogger.error(
        {
          serverAddress,
          error: error.message,
        },
        'Failed to fetch QLStats data'
      );
    }
    return null;
  }
}

/**
 * Get team name from team number
 * @param {number} teamNum - Team number
 * @returns {string} Human-readable team name
 */
function getTeamName(teamNum) {
  switch (teamNum) {
    case 1:
      return 'red';
    case 2:
      return 'blue';
    case 3:
      return 'spectator';
    default:
      return 'free';
  }
}

/**
 * Merge basic player data with QLStats enhanced data
 * @param {Array} basicPlayers - Basic player data from Syncore
 * @param {Array} qlstatsPlayers - Enhanced player data from QLStats
 * @returns {Array} Merged player data with enhanced information
 */
function mergeWithQLStatsData(basicPlayers = [], qlstatsPlayers = []) {
  if (!qlstatsPlayers || qlstatsPlayers.length === 0) {
    return basicPlayers;
  }

  // Create a map of QLStats players by cleaned name for faster lookup
  const qlstatsMap = new Map();
  qlstatsPlayers.forEach(player => {
    const cleanName = cleanPlayerName(player.name);
    if (cleanName) {
      qlstatsMap.set(cleanName.toLowerCase(), player);
    }
  });

  // Merge the data
  const mergedPlayers = basicPlayers.map(basicPlayer => {
    const cleanBasicName = cleanPlayerName(basicPlayer.name);
    const qlstatsPlayer = qlstatsMap.get(cleanBasicName.toLowerCase());

    if (qlstatsPlayer) {
      return {
        ...basicPlayer,
        rating: qlstatsPlayer.rating,
        ratingDeviation: qlstatsPlayer.ratingDeviation,
        steamid: qlstatsPlayer.steamid,
        team: qlstatsPlayer.team || basicPlayer.team,
        hasQLStatsData: true,
      };
    }

    return {
      ...basicPlayer,
      hasQLStatsData: false,
    };
  });

  quakeLogger.debug(
    {
      basicCount: basicPlayers.length,
      qlstatsCount: qlstatsPlayers.length,
      mergedCount: mergedPlayers.length,
      enhancedCount: mergedPlayers.filter(p => p.hasQLStatsData).length,
    },
    'Merged basic and QLStats player data'
  );

  return mergedPlayers;
}

/**
 * Get comprehensive server data by combining Syncore and QLStats data
 * @param {string} serverAddress - Server IP:port
 * @param {Object} syncoreData - Basic server data from Syncore
 * @returns {Promise<Object>} Combined server data with enhanced player information
 */
async function getEnhancedServerData(serverAddress, syncoreData = null) {
  try {
    const qlstatsData = await fetchQLStatsPlayerData(serverAddress);

    if (!qlstatsData || !syncoreData) {
      return {
        serverAddress,
        syncoreData,
        qlstatsData,
        mergedPlayers: syncoreData?.players || [],
        enhanced: false,
      };
    }

    const mergedPlayers = mergeWithQLStatsData(syncoreData.players, qlstatsData.players);

    return {
      serverAddress,
      syncoreData,
      qlstatsData,
      mergedPlayers,
      enhanced: true,
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    quakeLogger.error(
      {
        serverAddress,
        error: error.message,
      },
      'Failed to get enhanced server data'
    );

    return {
      serverAddress,
      syncoreData,
      qlstatsData: null,
      mergedPlayers: syncoreData?.players || [],
      enhanced: false,
      error: error.message,
    };
  }
}

module.exports = {
  fetchQLStatsPlayerData,
  mergeWithQLStatsData,
  getEnhancedServerData,
  cleanPlayerName,
  getTeamName,
};
