/**
 * @typedef {Object} QuakeConfig
 * @property {number} eloMode - ELO display mode: 0=Off, 1=Categorized, 2=Actual value
 * @property {number} maxServers - Maximum number of servers to display
 * @property {boolean} showTeamEmojis - Whether to show team emojis next to player names
 * @property {boolean} showServerStatsEmojis - Whether to show emojis in server stats output
 *
 * @typedef {Object} Player
 * @property {string} name - Player's name
 * @property {number} [score] - Player's score
 * @property {string} [totalConnected] - Time connected
 * @property {number} [team] - Team number
 * @property {number} [rating] - Player's ELO rating
 *
 * @typedef {Object} QLStatsPlayer
 * @property {string} name - Player's name
 * @property {number} team - Team number
 * @property {number} rating - Player's ELO rating
 *
 * @typedef {Object} ServerStats
 * @property {string} serverName
 * @property {string} currentMap
 * @property {string} playerCount
 * @property {string} gameType
 * @property {Object} teamScores
 * @property {number} teamScores.red
 * @property {number} teamScores.blue
 * @property {number} roundLimit
 * @property {string} uptime
 * @property {string} address
 * @property {Array<Player>} players
 *
 * @typedef {Object} QLStatsData
 * @property {Array<QLStatsPlayer>} rankedPlayers
 * @property {number} avg
 *
 * @typedef {Object} FormattedServerResponse
 * @property {string} formatted
 *
 * @typedef {Promise<string>|string} AISummaryResult
 *
 * @typedef {function(string=, number=): Promise<string>} LookupQuakeServerFn
 * @typedef {function(boolean=): Promise<string>} TestOpenAISummaryFn
 *
 * @typedef {Object} QuakeLookupAPI
 * @property {LookupQuakeServerFn} lookupQuakeServer
 * @property {TestOpenAISummaryFn} testOpenAISummary
 */
/**
 * Quake Live Server Lookup Module
 *
 * This module provides functionality to query Quake Live servers,
 * retrieve player statistics, and format the data for display in Discord.
 * It supports configurable ELO display modes and uses AI to summarize
 * data when it exceeds Discord's character limits.
 *
 * @module QuakeLookup
 * @author Brett
 * @version 1.0.0
 */

const axios = require('axios');
const { quake: quakeLogger } = require('../core/logger');
const retryWithBreaker = require('../../utils/retryWithBreaker');
const breakerManager = require('../middleware/breakerManager');
const apiKeyManager = require('../../utils/apiKeyManager');
const OpenAI = require('openai');
const { getServerDetails } = require('./qlSyncoreScraper');
const { getEnhancedServerData } = require('./qlstatsScraper');

/**
 * OpenAI client instance for AI-powered summaries
 * @type {OpenAI}
 */
let openai = null;

/**
 * Initializes the OpenAI client if it hasn't been initialized yet.
 * This ensures the client is ready before any API calls are made.
 *
 * @returns {OpenAI} The initialized OpenAI client
 */
function initializeOpenAI() {
  if (openai !== null) {
    return openai; // Return existing instance if already initialized
  }

  try {
    // Try to get API key from secure manager
    const apiKey = apiKeyManager.getApiKey('OPENAI_API_KEY');
    openai = new OpenAI({
      apiKey: apiKey,
    });
    quakeLogger.debug('OpenAI client initialized with API key from secure manager');
  } catch (error) {
    // Fallback to environment variable if API key manager fails
    quakeLogger.warn(
      { error: error.message },
      'Failed to get API key from manager, falling back to environment variable'
    );

    if (!process.env.OPENAI_API_KEY) {
      quakeLogger.error('OpenAI API key not available');
      // Create a dummy client that will throw appropriate errors when used
      openai = {
        chat: {
          completions: {
            create: async () => {
              throw new Error('OpenAI API key not available');
            },
          },
        },
      };
    } else {
      openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  return openai;
}

// Circuit breaker configuration for Quake API calls
const QUAKE_BREAKER_CONFIG = {
  maxRetries: 2, // Increased for better fault tolerance
  breakerLimit: 8, // Increased from 5 to be more tolerant of occasional failures
  breakerTimeoutMs: 180000, // 3 minutes timeout
  onBreakerOpen: error => {
    quakeLogger.error({ error }, 'Quake API circuit breaker opened');
    breakerManager.notifyOwnerBreakerTriggered(
      'Quake API circuit breaker opened: ' + error.message
    );
  },
};

// Circuit breaker configuration for OpenAI API calls
const OPENAI_BREAKER_CONFIG = {
  maxRetries: 1,
  breakerLimit: 3, // Open breaker after 3 consecutive failures
  breakerTimeoutMs: 300000, // 5 minutes timeout
  onBreakerOpen: error => {
    quakeLogger.error({ error }, 'OpenAI API circuit breaker opened');
    breakerManager.notifyOwnerBreakerTriggered(
      'OpenAI API circuit breaker opened: ' + error.message
    );
  },
};

const {
  validateServerInput,
  validateEloMode,
  sanitizeOutput,
} = require('../../utils/inputValidator');
const { sanitizeQuery } = require('../../utils/inputSanitizer');

/**
 * Validates server response data to ensure it's in a usable format.
 *
 * @param {*} response - The server response to validate
 * @returns {Object} Validation result with isValid flag and error message if invalid
 */
function validateServerResponse(response) {
  // Check for null or undefined
  if (response === null || response === undefined) {
    return { isValid: false, error: 'Server response is null or undefined' };
  }

  // Check if it's an object with data and servers properties
  if (typeof response !== 'object') {
    return { isValid: false, error: `Expected object, got ${typeof response}` };
  }

  // Check if data property exists
  if (!response.data) {
    return { isValid: false, error: 'Response missing data property' };
  }

  // Check if servers array exists
  if (!Array.isArray(response.data.servers)) {
    return { isValid: false, error: 'Response missing servers array' };
  }

  // Validate that each server has the expected structure
  const invalidServers = response.data.servers.filter(server => {
    return !server || typeof server !== 'object' || !server.info;
  });

  if (invalidServers.length > 0) {
    return {
      isValid: false,
      error: `Found ${invalidServers.length} invalid server entries`,
      invalidCount: invalidServers.length,
    };
  }

  return { isValid: true };
}

/**
 * API endpoints and configuration constants
 * @constant {string} SERVERS_API_URL - URL for the Quake Live servers API
 * @constant {string} QLSTATS_API_URL - URL for the QLStats rankings API
 * @constant {Object} DEFAULT_PARAMS - Default parameters for server queries
 * @constant {number} DISCORD_CHAR_LIMIT - Maximum character limit for Discord messages
 * @constant {number} BUFFER_SPACE - Buffer space to account for message formatting
 */
const SERVERS_API_URL = 'https://ql.syncore.org/api/servers';
const QLSTATS_API_URL = 'https://ql.syncore.org/api/qlstats/rankings';
const DEFAULT_PARAMS = {
  regions: 'Oceania',
  hasPlayers: true,
  hasBots: false,
};
const DISCORD_CHAR_LIMIT = 2000;
const BUFFER_SPACE = 100;

/**
 * Module configuration
 * @typedef {Object} QuakeConfig
 * @property {number} eloMode - ELO display mode: 0=Off, 1=Categorized, 2=Actual value
 * @property {number} maxServers - Maximum number of servers to display
 */
const CONFIG = {
  // ELO display mode:
  // 0 = Off (don't show ELO)
  // 1 = Categorized (Scrub/Mid/Pro)
  // 2 = Actual ELO value
  eloMode: 1,
  maxServers: 3,
  // Whether to show team emojis (🔴/🔵) next to player names
  showTeamEmojis:
    process.env.SHOW_TEAM_EMOJIS === 'true' || process.env.SHOW_TEAM_EMOJIS === undefined, // Default to true unless explicitly set to false
  // Whether to show emojis in server stats output
  showServerStatsEmojis:
    process.env.SHOW_SERVER_STATS_EMOJIS === 'true' ||
    process.env.SHOW_SERVER_STATS_EMOJIS === undefined, // Default to true unless explicitly set to false
};

// Configuration loaded - debug logging removed for production

/**
 * Calculate server uptime from level start time.
 *
 * Converts the level start time (Unix timestamp) to a formatted uptime string in the format HH:MM:SS.
 *
 * @param {string|number} levelStartTime - Unix timestamp when the level started
 * @returns {string} Formatted uptime string (HH:MM:SS)
 */
function calculateUptime(levelStartTime) {
  try {
    const startTime = parseInt(levelStartTime, 10);
    if (isNaN(startTime)) {
      throw new Error('Invalid level start time');
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const uptimeSeconds = Math.max(0, currentTime - startTime);

    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  } catch (error) {
    quakeLogger.error({ error }, 'Uptime calculation error');
    return '00:00:00';
  }
}

/**
 * Remove Quake color codes from text.
 *
 * Quake uses color codes in the format ^n where n is a digit. This function removes these codes to display clean text.
 *
 * @param {string} text - Text potentially containing color codes
 * @returns {string} Text with color codes removed
 */
function stripColorCodes(text) {
  return text ? text.replace(/\^\d+/g, '') : '';
}

function formatGameStatus(serverStats) {
  if (serverStats.gameType === 'Clan Arena') {
    const redScore = serverStats.teamScores.red;
    const blueScore = serverStats.teamScores.blue;

    // Check if the game is in warmup mode (all players have 0 score and team scores are 0)
    const isWarmup =
      redScore === 0 &&
      blueScore === 0 &&
      serverStats.players &&
      serverStats.players.every(p => p.score === 0);

    if (isWarmup) {
      return `⏸️ Warmup (First to ${serverStats.roundLimit})`;
    }

    let winningTeam = '';
    if (redScore > blueScore) {
      winningTeam = '🔴 RED leading';
    } else if (blueScore > redScore) {
      winningTeam = '🔵 BLUE leading';
    } else {
      winningTeam = '⚖️ Teams tied';
    }

    // Check if game is close to ending
    const maxScore = Math.max(redScore, blueScore);
    const isCloseToEnd = maxScore >= serverStats.roundLimit - 2;
    const emoji = isCloseToEnd ? '🔥' : '⚔️';

    return `${emoji} ${winningTeam} (First to ${serverStats.roundLimit})`;
  }

  // Add emojis for other game types
  const gameTypeEmojis = {
    'Capture the Flag': '🏁',
    'Team Deathmatch': '💀',
    Duel: '⚔️',
    'Free for All': '💥',
    Instagib: '⚡',
    'Freeze Tag': '❄️',
  };

  const emoji = gameTypeEmojis[serverStats.gameType] || '🎮';
  return `${emoji} ${serverStats.gameType}`;
}

/**
 * Get QLStats data for a single server (original working format)
 * @param {string} serverAddress - Server address
 * @returns {Promise<Object|null>} QLStats response data
 */
async function getQLStatsData(serverAddress) {
  try {
    // Validate server address before making API call
    const validatedAddress = validateServerInput(serverAddress);
    if (!validatedAddress.isValid) {
      quakeLogger.warn({ address: serverAddress }, 'Invalid server address in getQLStatsData');
      return null;
    }

    // Use original working format: ?server= (singular) with fast timeout
    const response = await axios.get(
      `${QLSTATS_API_URL}?server=${encodeURIComponent(validatedAddress.value)}`,
      {
        timeout: 3000, // Original timeout that worked
        validateStatus: status => status < 500, // Accept all responses except server errors
      }
    );

    // Log detailed response data for debugging
    if (process.env.ENABLE_QUAKE_DEBUG_LOGGING === 'true') {
      quakeLogger.info(
        {
          serverAddress: validatedAddress.value,
          hasData: !!response.data,
          playerCount: response.data?.rankedPlayers?.length || 0,
          responseData: JSON.stringify(response.data),
          players: response.data?.rankedPlayers
            ? JSON.stringify(response.data.rankedPlayers)
            : 'No players',
        },
        'QLStats API response (detailed)'
      );
    }

    return response.data;
  } catch (error) {
    // Don't log as error to reduce noise - QLStats is optional
    if (process.env.ENABLE_QUAKE_DEBUG_LOGGING === 'true') {
      quakeLogger.debug({ error, serverAddress }, 'QLStats data unavailable (non-critical)');
    }
    return null;
  }
}

function mergePlayerData(basicPlayers, qlstatsPlayers) {
  // If no QLStats data is available, try to extract team info from basic player data
  if (!qlstatsPlayers || qlstatsPlayers.length === 0) {
    quakeLogger.info('No QLStats data available, using basic player data only');

    // Debug: Log the first player's full structure to see available properties
    if (basicPlayers.length > 0 && process.env.ENABLE_QUAKE_DEBUG_LOGGING === 'true') {
      quakeLogger.info(
        {
          firstPlayerStructure: JSON.stringify(basicPlayers[0]),
          allPlayerProps: Object.keys(basicPlayers[0]),
        },
        'Debug: Raw player data structure'
      );
    }

    return basicPlayers.map(player => ({
      name: player.name,
      score: player.score,
      totalConnected: player.totalConnected,
      // Check if the server data includes team information directly
      team:
        player.team !== undefined
          ? player.team
          : player.name.toLowerCase().includes('red')
            ? 1
            : player.name.toLowerCase().includes('blue')
              ? 2
              : player.score < 0
                ? 3
                : 0, // Negative score often indicates spectator
      rating: null,
    }));
  }

  // Merge basic and QLStats data
  const playerMap = new Map();

  basicPlayers.forEach(player => {
    const strippedName = stripColorCodes(player.name).toLowerCase();
    playerMap.set(strippedName, {
      name: player.name,
      score: player.score,
      totalConnected: player.totalConnected,
    });
  });

  return qlstatsPlayers.map(qlstatsPlayer => {
    const strippedName = stripColorCodes(qlstatsPlayer.name).toLowerCase();

    // Try different matching strategies
    let basicData = playerMap.get(strippedName);

    // If no match found, try partial name matching
    if (!basicData) {
      for (const [key, value] of playerMap.entries()) {
        if (key.includes(strippedName) || strippedName.includes(key)) {
          basicData = value;
          break;
        }
      }
    }

    basicData = basicData || {};

    return {
      name: qlstatsPlayer.name,
      score: basicData.score || 0,
      totalConnected: basicData.totalConnected || '0:00',
      team: qlstatsPlayer.team || 0, // Default to 0 if team is undefined
      rating: qlstatsPlayer.rating,
    };
  });
}

/**
 * Get ELO category (Scrub/Mid/Pro) based on rating.
 *
 * Categorizes players into skill levels based on their ELO rating:
 * - Scrub: 0-799
 * - Mid: 800-1300
 * - Pro: 1301+
 *
 * @param {number} rating - Player's ELO rating
 * @returns {string} ELO category label
 */
function getEloCategory(rating) {
  if (rating < 800) return 'Scrub';
  if (rating < 1301) return 'Mid';
  return 'Pro';
}

/**
 * Format player line with optional ELO display.
 *
 * Creates a formatted string for a player entry in the server stats display. The format changes based on whether the player is active or spectating and includes ELO information according to the configured display mode.
 *
 * @param {Player} player - Player data
 * @param {boolean} [isSpectator=false] - Whether player is a spectator
 * @returns {string} Formatted player line for display
 */
function formatPlayerLine(player, isSpectator = false) {
  const cleanName = stripColorCodes(player.name).padEnd(20);

  // For spectators, only show name to save space
  if (isSpectator) {
    return `${cleanName}`;
  }

  // For active players, show score and ELO based on config
  const score = `${String(player.score || 0).padStart(3)}`;

  // Handle different ELO display modes
  let eloDisplay = '';
  if (CONFIG.eloMode === 1 && player.rating) {
    // Mode 1: Show category (Scrub/Mid/Pro)
    eloDisplay = `(${getEloCategory(player.rating)})`;
  } else if (CONFIG.eloMode === 2 && player.rating) {
    // Mode 2: Show actual ELO value
    eloDisplay = `(${String(player.rating).padStart(4)})`;
  }

  // Add team indicator if enabled in config (but not here since we show team sections)
  // Keep it simple in team sections - no individual player team emojis needed

  return `${cleanName} ${score} ${eloDisplay}`.trim();
}

/**
 * Format player list for display.
 *
 * Creates a formatted string for the player list, including team scores, player names, and ELO information based on the configured display mode.
 *
 * @param {Array<Player>} players - Player data array
 * @param {Array<Player>} basicPlayers - Basic player data from server stats
 * @param {ServerStats|null} serverStats - Server stats object
 * @returns {string} Formatted player list string
 */
function formatPlayerList(players, basicPlayers = [], serverStats = null) {
  // Debug log for player data
  quakeLogger.info(
    {
      qlstatsPlayers: players
        ? JSON.stringify(players.map(p => ({ name: p.name, team: p.team, rating: p.rating })))
        : 'No QLStats players',
      basicPlayers: basicPlayers
        ? JSON.stringify(basicPlayers.map(p => ({ name: p.name, score: p.score })))
        : 'No basic players',
      eloMode: CONFIG.eloMode,
    },
    'formatPlayerList debug info'
  );

  // If no QLStats data and no basic players, show no players message
  if ((!players || !players.length) && (!basicPlayers || !basicPlayers.length)) {
    return 'No players';
  }

  // If no QLStats data, use basic players with team detection
  const mergedPlayers = players?.length
    ? mergePlayerData(basicPlayers, players)
    : mergePlayerData(basicPlayers, []);
  const isWarmup = mergedPlayers.every(p => p.score === 0);

  // Assign unassigned players to teams based on pattern matching if possible
  mergedPlayers.forEach(p => {
    if (!p.team || p.team === 0) {
      const name = stripColorCodes(p.name).toLowerCase();
      if (name.includes('red')) {
        p.team = 1;
      } else if (name.includes('blue')) {
        p.team = 2;
      } else if (p.score <= 0) {
        p.team = 3; // Spectator
      } else {
        // If we can't determine team, put them in a general list
        p.team = 0;
      }
    }
  });

  const teams = {
    red: mergedPlayers.filter(p => p.team === 1),
    blue: mergedPlayers.filter(p => p.team === 2),
    spec: mergedPlayers.filter(p => p.team === 3),
    other: mergedPlayers.filter(p => p.team === 0 || p.team === undefined),
  };

  // Add team scores to player objects if available from serverStats
  if (serverStats && serverStats.teamScores) {
    teams.red.forEach(p => (p.teamScore = serverStats.teamScores.red));
    teams.blue.forEach(p => (p.teamScore = serverStats.teamScores.blue));
  }

  const sortFn =
    isWarmup && CONFIG.eloMode > 0
      ? (a, b) => (b.rating || 0) - (a.rating || 0)
      : (a, b) => (b.score || 0) - (a.score || 0);

  Object.values(teams).forEach(team => team.sort(sortFn));

  const lines = [];

  // Start with an empty line for better visual separation
  lines.push('');

  // Get team scores from serverStats directly
  let redScore = serverStats && serverStats.teamScores ? serverStats.teamScores.red : 0;
  let blueScore = serverStats && serverStats.teamScores ? serverStats.teamScores.blue : 0;

  // If no team scores in serverStats, try to get from player data
  if (redScore === 0 && blueScore === 0) {
    const firstRedPlayer = teams.red[0];
    const firstBluePlayer = teams.blue[0];

    if (firstRedPlayer && firstRedPlayer.teamScore) {
      redScore = firstRedPlayer.teamScore;
    }
    if (firstBluePlayer && firstBluePlayer.teamScore) {
      blueScore = firstBluePlayer.teamScore;
    }
  }

  // Use emojis for team headings based on config setting
  const teamLabels = CONFIG.showTeamEmojis
    ? {
        red: '🔴',
        blue: '🔵',
        other: '⚪',
        spec: '👁️',
      }
    : {
        red: '',
        blue: '',
        other: '',
        spec: '',
      };

  // Display teams only if they have players
  if (teams.red.length) {
    lines.push(`${teamLabels.red} RED TEAM (${redScore})`);
    lines.push('─────────────────────────────────────');
    teams.red.forEach(p => {
      lines.push(formatPlayerLine(p));
    });

    // Add a separator line if there's also a blue team
    if (teams.blue.length) {
      lines.push('');
    }
  }

  if (teams.blue.length) {
    lines.push(`${teamLabels.blue} BLUE TEAM (${blueScore})`);
    lines.push('─────────────────────────────────────');
    teams.blue.forEach(p => {
      lines.push(formatPlayerLine(p));
    });

    // Add a separator line if there are other players
    if (teams.other.length && teams.other.length > 0) {
      lines.push('');
    }
  }

  // If there are players not assigned to a team, show them
  if (teams.other.length) {
    if (!teams.red.length && !teams.blue.length) {
      // If no team players, try to distribute them between red and blue teams
      // Split players roughly evenly between teams for better display
      const halfPoint = Math.ceil(teams.other.length / 2);

      // Create temporary red and blue teams from unassigned players
      const tempRed = teams.other.slice(0, halfPoint).map(p => ({ ...p, team: 1 }));
      const tempBlue = teams.other.slice(halfPoint).map(p => ({ ...p, team: 2 }));

      // Display as red and blue teams
      if (tempRed.length) {
        lines.push(`${teamLabels.red} RED TEAM (${redScore})`);
        lines.push('─────────────────────────────────────');
        tempRed.forEach(p => {
          lines.push(formatPlayerLine(p));
        });

        if (tempBlue.length) {
          lines.push('');
        }
      }

      if (tempBlue.length) {
        lines.push(`${teamLabels.blue} BLUE TEAM (${blueScore})`);
        lines.push('─────────────────────────────────────');
        tempBlue.forEach(p => {
          lines.push(formatPlayerLine(p));
        });
      }
    } else {
      // Otherwise, show them under an 'Other Players' header
      lines.push(`${teamLabels.other} OTHER PLAYERS`);
      lines.push('─────────────────────────────────────');
      teams.other.forEach(p => {
        lines.push(formatPlayerLine(p));
      });
    }

    // Add a separator line if there are spectators
    if (teams.spec.length && teams.spec.length > 0) {
      lines.push('');
    }
  }

  // For spectators, only show names in a compact format if there are any
  if (teams.spec.length) {
    // Add a clear divider before spectators section
    lines.push('');
    lines.push('═══════════════════════════════════════');
    lines.push(
      `${teamLabels.spec} SPECTATORS: ` +
        teams.spec
          .slice(0, 5)
          .map(p => stripColorCodes(p.name))
          .join(', ')
    );

    // If there are more than 5 spectators, just show the count
    if (teams.spec.length > 5) {
      lines.push(`...and ${teams.spec.length - 5} more`);
    }
  }

  return lines.join('\n');
}

/**
 * Extract server stats from server data.
 *
 * Creates a server stats object with relevant information for display.
 *
 * @param {Object} server - Server data object
 * @returns {ServerStats} Server stats object
 */
function extractServerStats(server) {
  const { info, rules, players } = server;
  const uptime = calculateUptime(rules.g_levelStartTime);

  // Normalize whitespace in server name (replace multiple spaces/tabs with a single space)
  const normalizedServerName = info.serverName.trim().replace(/\s+/g, ' ');

  return {
    serverName: normalizedServerName,
    currentMap: info.map,
    playerCount: `${info.players}/${info.maxPlayers}`,
    gameType: info.gameTypeShort === 'CA' ? 'Clan Arena' : info.gameType,
    teamScores: {
      red: rules.g_redScore,
      blue: rules.g_blueScore,
    },
    roundLimit: rules.roundlimit,
    uptime,
    address: server.address,
    players,
  };
}

/**
 * Format server response for display.
 *
 * Creates a formatted string for a server response, including server information, player list, and team scores.
 *
 * @param {ServerStats} serverStats - Server stats object
 * @param {QLStatsData} qlstatsData - QLStats data object
 * @returns {FormattedServerResponse} Formatted server response object
 */
function formatServerResponse(serverStats, qlstatsData) {
  // const steamLink = `steam://connect/${serverStats.address}`;

  // Debug log for qlstatsData and player info
  quakeLogger.info(
    {
      hasQlstatsData: !!qlstatsData,
      rankedPlayersCount: qlstatsData?.rankedPlayers?.length || 0,
      eloMode: CONFIG.eloMode,
      basicPlayersCount: serverStats.players?.length || 0,
    },
    'formatServerResponse debug info'
  );

  // Check if qlstatsData exists and has rankedPlayers before accessing properties
  const avgRating =
    CONFIG.eloMode > 0 &&
    qlstatsData &&
    qlstatsData.rankedPlayers &&
    qlstatsData.rankedPlayers.length > 0
      ? `Avg Rating: ${Math.round(qlstatsData.avg)}`
      : '';

  // Choose labels based on emoji setting
  const labels = CONFIG.showServerStatsEmojis
    ? {
        server: '🎮',
        map: '🗺️',
        status: '🎯',
        players: '👥',
        uptime: '⏱️',
        rating: '📊',
      }
    : {
        server: 'Server:',
        map: 'Map:',
        status: 'Status:',
        players: 'Players:',
        uptime: 'Uptime:',
        rating: 'Avg Rating:',
      };

  return {
    formatted: [
      '```',
      '═══════════════════════════════════════',
      `${labels.server} ${serverStats.serverName}`,
      '───────────────────────────────────────',
      `${labels.map} ${serverStats.currentMap}`,
      `${labels.status} ${formatGameStatus(serverStats)}`,
      `${labels.players} ${serverStats.playerCount}`,
      `${labels.uptime} ${serverStats.uptime}`,
      avgRating ? `${labels.rating} ${Math.round(qlstatsData.avg)}` : '',
      '───────────────────────────────────────',
      formatPlayerList(qlstatsData?.rankedPlayers || [], serverStats.players, serverStats),
      '═══════════════════════════════════════',
      '```',
    ]
      .filter(line => line !== '')
      .join('\n'),
  };
}

/**
 * Process server stats with AI to create a concise summary.
 *
 * When the full server stats would exceed Discord's character limit, this function uses OpenAI to generate a condensed summary of the most important information from all servers.
 *
 * @param {Array<FormattedServerResponse>} serverResponses - Array of formatted server responses
 * @param {Array<ServerStats>} allServerStats - Array of all server stats objects
 * @returns {AISummaryResult} AI-processed summary string
 */
async function processServerStatsWithAI(serverResponses, allServerStats) {
  // Initialize formattedResponses at the function scope so it's available in the catch block
  let formattedResponses = [];

  try {
    // Check if serverResponses is valid
    if (!serverResponses || !serverResponses.length) {
      quakeLogger.warn('Invalid server responses data - empty or null');
      throw new Error('Invalid server responses data');
    }

    // Log the received data format for debugging
    quakeLogger.debug(
      {
        responseType: typeof serverResponses[0],
        isArray: Array.isArray(serverResponses),
        hasFormatted: typeof serverResponses[0] === 'object' && 'formatted' in serverResponses[0],
        firstItem: JSON.stringify(serverResponses[0]).substring(0, 100), // Log first 100 chars
      },
      'Server response format details'
    );

    // Handle different formats for serverResponses
    if (typeof serverResponses[0] === 'string') {
      // If we already have strings, use them directly
      formattedResponses = serverResponses;
      quakeLogger.debug('Using string format responses');
    } else if (typeof serverResponses[0] === 'object') {
      if (serverResponses[0]?.formatted) {
        // If we have objects with formatted property, extract those
        formattedResponses = serverResponses.map(response => response.formatted);
        quakeLogger.debug('Extracted formatted strings from objects');
      } else if (serverResponses[0]?.serverName) {
        // If we have server objects directly, format them on the fly
        formattedResponses = serverResponses.map(server => {
          return (
            '```\n' +
            `Server: ${server.serverName}\n` +
            `Map: ${server.currentMap || 'Unknown'}\n` +
            `Players: ${server.playerCount || 0}\n` +
            `Game Type: ${server.gameType || 'Unknown'}\n` +
            '```'
          );
        });
        quakeLogger.debug('Created formatted strings from server objects');
      } else {
        // Unknown object format
        quakeLogger.error(
          { sample: JSON.stringify(serverResponses[0]).substring(0, 200) },
          'Unknown server response object format'
        );
        throw new Error('Invalid server responses format - unknown object structure');
      }
    } else {
      // If we don't have strings or objects, error
      quakeLogger.error(
        { type: typeof serverResponses[0] },
        'Invalid server responses format - neither string nor object'
      );
      throw new Error(`Invalid server responses format - received ${typeof serverResponses[0]}`);
    }

    // Verify we have valid formatted responses
    if (!formattedResponses.length || !formattedResponses[0]) {
      quakeLogger.error('Failed to extract formatted responses');
      throw new Error('Failed to extract formatted responses');
    }

    // Always include the first server's full details
    const firstServerResponse = formattedResponses[0];
    quakeLogger.debug(
      { firstResponseLength: firstServerResponse.length },
      'First server response extracted'
    );

    // Create a summary of the remaining servers
    const remainingServers = allServerStats.slice(1);
    if (remainingServers.length === 0) {
      return firstServerResponse;
    }

    // Create a condensed representation of the remaining servers
    const serverSummaries = remainingServers.map(server => {
      return {
        name: server.serverName,
        map: server.currentMap,
        players: server.playerCount,
        gameType: server.gameType,
        playerNames: server.players.map(p => stripColorCodes(p.name)),
      };
    });

    try {
      /**
       * Generate a concise summary of additional servers using OpenAI
       *
       * @requires OpenAI API key in environment variables
       * @requires openai package to be installed and configured
       * @param {Object} serverSummaries - Array of simplified server objects with name, map, players, etc.
       * @returns {string} A 3-4 sentence summary of all additional servers
       */
      // Ensure OpenAI client is initialized before making API call
      const openaiClient = initializeOpenAI();

      quakeLogger.debug('Using retryWithBreaker for OpenAI API request');
      const aiResponse = await retryWithBreaker(async () => {
        quakeLogger.debug('Making OpenAI API request for server summary');
        return await openaiClient.chat.completions.create({
          model: 'gpt-4.1-nano', // Using GPT-4.1-nano for cost efficiency and adequate performance
          messages: [
            {
              role: 'system',
              content:
                'You are a helpful assistant that summarizes Quake Live server information. Create a very concise summary of the additional servers in 3-4 sentences total. Focus on player counts, maps, and game types.',
            },
            {
              role: 'user',
              content: `Summarize these additional Quake Live servers in a very brief format: ${JSON.stringify(serverSummaries)}`,
            },
          ],
          max_completion_tokens: 150, // Limiting response length to ensure it fits within Discord's character limits
        });
      }, OPENAI_BREAKER_CONFIG);

      // Extract the generated summary text from the API response
      const aiSummary = aiResponse.choices[0].message.content;

      // Combine the first server's full details with the AI summary
      return firstServerResponse + '\n```\n\n**Additional Servers**\n' + aiSummary + '\n```';
    } catch (openaiError) {
      quakeLogger.error({ error: openaiError }, 'OpenAI API error');
      // Fallback to a simple manual summary if OpenAI API fails
      const manualSummary = remainingServers
        .map(server => {
          return `${server.serverName} - Map: ${server.currentMap}, Players: ${server.playerCount}, Type: ${server.gameType}`;
        })
        .join('\n');

      return firstServerResponse + '\n```\n\n**Additional Servers**\n' + manualSummary + '\n```';
    }
  } catch (error) {
    // Log the error with detailed context
    quakeLogger.error(
      {
        error,
        errorName: error.name,
        errorMessage: error.message,
        hasFormattedResponses: Boolean(formattedResponses && formattedResponses.length),
        hasServerStats: Boolean(allServerStats && allServerStats.length),
        serverResponsesType: typeof serverResponses,
        serverStatsType: typeof allServerStats,
      },
      'Error processing server stats with AI'
    );

    // Return a valid formatted response even if everything fails
    if (formattedResponses && formattedResponses.length) {
      quakeLogger.info(
        { count: formattedResponses.length },
        'Falling back to available formatted responses'
      );
      return formattedResponses.join('\n');
    } else if (allServerStats && allServerStats.length) {
      // Create a basic formatted response from the first server stats
      quakeLogger.info('Falling back to generating basic response from server stats');
      const firstServer = allServerStats[0];
      return (
        '```\n' +
        `Server: ${firstServer.serverName || 'Unknown'}\n` +
        `Map: ${firstServer.currentMap || 'Unknown'}\n` +
        `Players: ${firstServer.playerCount || 0}\n` +
        `Game Type: ${firstServer.gameType || 'Unknown'}\n` +
        '```'
      );
    }
    quakeLogger.warn('No fallback data available, returning error message');
    return '```\n  ⚠️   Error processing server stats\n```';
  }
}

/**
 * Look up Quake Live server statistics.
 *
 * Main function that retrieves server information, player stats, and formats the data for display in Discord. If the formatted output would exceed Discord's character limit, it uses AI to create a condensed summary.
 *
 * @param {string|null} [serverFilter=null] - Optional server name or IP to filter by
 * @param {number|null} [eloMode=null] - Optional ELO display mode override (0=Off, 1=Categorized, 2=Actual value)
 * @returns {Promise<string>} Formatted server statistics for display in Discord
 */
async function lookupQuakeServer(serverFilter = null, eloMode = null) {
  // Sanitize server filter input first
  if (serverFilter !== null && serverFilter !== undefined) {
    const sanitizedServerFilter = sanitizeQuery(serverFilter);

    // Log if the server filter was modified during sanitization
    if (sanitizedServerFilter !== serverFilter) {
      quakeLogger.warn(
        { original: serverFilter, sanitized: sanitizedServerFilter },
        'Server filter was sanitized before Quake lookup'
      );
    }

    // Use the sanitized input for validation
    // serverFilter is already sanitized at this point
  }

  // Validate inputs (these should already be validated by the command module,
  // but we validate again here for safety and to handle direct calls)
  const serverToValidate = serverFilter;
  const validatedServer = validateServerInput(serverToValidate);
  const validatedEloMode = validateEloMode(eloMode);

  quakeLogger.info(
    {
      serverFilter: validatedServer.value,
      eloMode: validatedEloMode.value,
      originalServerFilter: serverFilter,
      originalEloMode: eloMode,
    },
    'lookupQuakeServer: Function started'
  );

  try {
    // Apply ELO mode override if provided
    if (validatedEloMode.value !== null) {
      CONFIG.eloMode = validatedEloMode.value;
      quakeLogger.info({ eloMode: CONFIG.eloMode }, 'ELO mode set');
    }

    // Use retryWithBreaker to handle retries and circuit breaking
    quakeLogger.debug('Using retryWithBreaker for Quake servers API request');
    const response = await retryWithBreaker(async () => {
      quakeLogger.debug('Making Quake servers API request');
      return await axios.get(SERVERS_API_URL, {
        params: DEFAULT_PARAMS,
        timeout: 5000,
      });
    }, QUAKE_BREAKER_CONFIG);

    // Validate the server response
    const validationResult = validateServerResponse(response);
    if (!validationResult.isValid) {
      quakeLogger.error({ error: validationResult.error }, 'Invalid server response');
      return `# 🎯 Quake Live Server Status\n\n> ⚠️ Error: ${validationResult.error}`;
    }

    if (!response.data?.servers?.length) {
      return '# 🎯 Quake Live Server Status\n\n> 🚫 No active servers found.';
    }

    // Filter servers by name/IP if provided
    let filteredServers = response.data.servers.filter(server => server?.info?.players > 0);

    if (validatedServer.value) {
      const serverFilterLower = validatedServer.value.toLowerCase();
      filteredServers = filteredServers.filter(server => {
        const serverName = stripColorCodes(server.info.name || '').toLowerCase();
        const serverAddress = (server.address || '').toLowerCase();
        return serverName.includes(serverFilterLower) || serverAddress.includes(serverFilterLower);
      });
    }

    const sortedServers = filteredServers
      .sort((a, b) => b.info.players - a.info.players)
      .slice(0, CONFIG.maxServers);

    if (!sortedServers.length) {
      const noServersMessage = serverFilter
        ? `No active servers found matching "${serverFilter}".`
        : 'No active servers found.';

      return `# 🎯 Quake Live Server Status\n\n> 🚫 ${noServersMessage}`;
    }

    // Process servers and optionally fetch QLStats data
    const allServerStats = [];
    const serverResponses = [];

    for (const server of sortedServers) {
      // Extract basic server stats
      const serverStats = extractServerStats(server);
      allServerStats.push(serverStats);

      // Try to get enhanced server data with ELO/ratings (fast-fail, non-blocking)
      let qlstatsData = null;

      // First try QLStats API if enabled
      if (CONFIG.eloMode > 0 && server.address && process.env.ENABLE_QLSTATS === 'true') {
        try {
          qlstatsData = await getQLStatsData(server.address);
        } catch (error) {
          // Silently ignore QLStats failures - they're optional
          if (process.env.ENABLE_QUAKE_DEBUG_LOGGING === 'true') {
            quakeLogger.debug(
              { error, address: server.address },
              'QLStats call failed (non-critical)'
            );
          }
        }
      }

      // If QLStats failed or disabled, try web scraper for enhanced data
      if (
        !qlstatsData &&
        CONFIG.eloMode > 0 &&
        server.address &&
        process.env.ENABLE_SYNCORE_SCRAPING === 'true'
      ) {
        try {
          const scrapedData = await getServerDetails(server.address);
          if (scrapedData && scrapedData.rankedPlayers && scrapedData.rankedPlayers.length > 0) {
            // Transform scraped data to QLStats format for compatibility
            qlstatsData = {
              rankedPlayers: scrapedData.rankedPlayers,
              avg: 0, // Not available from scraper
            };
            if (process.env.ENABLE_QUAKE_DEBUG_LOGGING === 'true') {
              quakeLogger.debug(
                { address: server.address, playerCount: scrapedData.rankedPlayers.length },
                'Enhanced data from web scraper'
              );
            }
          }
        } catch (error) {
          // Silently ignore scraper failures - they're optional
          if (process.env.ENABLE_QUAKE_DEBUG_LOGGING === 'true') {
            quakeLogger.debug(
              { error, address: server.address },
              'Web scraper call failed (non-critical)'
            );
          }
        }
      }

      // If still no QLStats data, try QLStats.net scraping for enhanced player data
      if (
        !qlstatsData &&
        CONFIG.eloMode > 0 &&
        server.address &&
        process.env.ENABLE_QLSTATS_NET_SCRAPING === 'true'
      ) {
        try {
          const enhancedData = await getEnhancedServerData(server.address, serverStats);
          if (enhancedData && enhancedData.enhanced && enhancedData.qlstatsData) {
            // Transform QLStats.net data to QLStats format for compatibility
            qlstatsData = {
              rankedPlayers: enhancedData.mergedPlayers.filter(p => p.hasQLStatsData),
              avg:
                enhancedData.qlstatsData.players.length > 0
                  ? enhancedData.qlstatsData.players.reduce((sum, p) => sum + (p.rating || 0), 0) /
                    enhancedData.qlstatsData.players.length
                  : 0,
            };
            if (process.env.ENABLE_QUAKE_DEBUG_LOGGING === 'true') {
              quakeLogger.debug(
                { address: server.address, playerCount: qlstatsData.rankedPlayers.length },
                'Enhanced data from QLStats.net scraper'
              );
            }
          }
        } catch (error) {
          // Silently ignore QLStats.net scraper failures - they're optional
          if (process.env.ENABLE_QUAKE_DEBUG_LOGGING === 'true') {
            quakeLogger.debug(
              { error, address: server.address },
              'QLStats.net scraper call failed (non-critical)'
            );
          }
        }
      }

      // Log if all methods are disabled
      if (
        CONFIG.eloMode > 0 &&
        process.env.ENABLE_QLSTATS !== 'true' &&
        process.env.ENABLE_SYNCORE_SCRAPING !== 'true' &&
        process.env.ENABLE_QLSTATS_NET_SCRAPING !== 'true'
      ) {
        if (process.env.ENABLE_QUAKE_DEBUG_LOGGING === 'true') {
          quakeLogger.debug(
            { address: server.address },
            'All QLStats methods (API, Syncore, and QLStats.net) disabled via environment variables'
          );
        }
      }

      // Format the server response with optional QLStats data
      const formattedResponse = formatServerResponse(serverStats, qlstatsData);
      serverResponses.push(formattedResponse.formatted);
    }

    // If we have no results at this point, return an error
    if (serverResponses.length === 0) {
      return sanitizeOutput(
        '# 🎯 Quake Live Server Status\n\n> ⚠️ Error retrieving server information.'
      );
    }

    // If the total response is too long, use AI to summarize
    const totalLength = serverResponses.join('\n\n').length;
    if (totalLength > DISCORD_CHAR_LIMIT - BUFFER_SPACE) {
      quakeLogger.info({ totalLength }, 'Response too long, using AI to summarize');
      const aiSummary = await processServerStatsWithAI(serverResponses, allServerStats);
      // Sanitize the AI-generated output
      return sanitizeOutput(aiSummary);
    }

    // Return the sanitized formatted response
    return sanitizeOutput(serverResponses.join('\n\n'));
  } catch (error) {
    // Log based on debug level to reduce production log noise
    if (process.env.ENABLE_QUAKE_DEBUG_LOGGING === 'true') {
      quakeLogger.error({ error }, 'Server stats fetch error');
    } else {
      quakeLogger.warn(
        { errorType: error.name, message: error.message },
        'Quake server lookup failed'
      );
    }
    return sanitizeOutput(
      '# 🎯 Quake Live Server Status\n\n> ⚠️ Error retrieving server information.'
    );
  }
}

/**
 * Test the OpenAI server summary functionality.
 *
 * Tests the AI summary generation for multiple servers without making actual API calls to Quake Live servers.
 * Supports multiple test scenarios including different response formats and error conditions.
 *
 * @param {Object} options - Test configuration options
 * @param {boolean} [options.mockOpenAIFailure=false] - If true, simulates an OpenAI API failure
 * @param {string} [options.responseFormat='object'] - Format of mock responses ('object', 'string', 'server', 'invalid')
 * @param {boolean} [options.emptyResponse=false] - If true, tests with empty response data
 * @param {boolean} [options.nullResponse=false] - If true, tests with null response data
 * @returns {Promise<string>} The generated summary or error message
 */
async function testOpenAISummary(options = {}) {
  // Default options
  const testOptions = {
    mockOpenAIFailure: false,
    responseFormat: 'object',
    emptyResponse: false,
    nullResponse: false,
    ...options,
  };

  quakeLogger.info({ testOptions }, 'Starting OpenAI summary test');

  // Mock server data for testing
  const mockServerStats = [
    {
      serverName: 'Test Server 1',
      currentMap: 'bloodrun',
      playerCount: 6,
      gameType: 'CA',
      players: [
        { name: '^1Player1', score: 10, ping: 25 },
        { name: '^2Player2', score: 5, ping: 30 },
      ],
    },
    {
      serverName: 'Test Server 2',
      currentMap: 'campgrounds',
      playerCount: 4,
      gameType: 'TDM',
      players: [
        { name: '^3Player3', score: 15, ping: 20 },
        { name: '^4Player4', score: 8, ping: 35 },
      ],
    },
    {
      serverName: 'Test Server 3',
      currentMap: 'aerowalk',
      playerCount: 2,
      gameType: 'Duel',
      players: [
        { name: '^5Player5', score: 12, ping: 15 },
        { name: '^6Player6', score: 9, ping: 40 },
      ],
    },
  ];

  // Create mock responses based on the specified format
  let mockResponses;

  if (testOptions.nullResponse) {
    mockResponses = null;
  } else if (testOptions.emptyResponse) {
    mockResponses = [];
  } else {
    switch (testOptions.responseFormat) {
      case 'string':
        mockResponses = [
          '```\nServer: Test Server 1\nMap: bloodrun\nPlayers: 6\nGame Type: CA\n```',
        ];
        break;
      case 'object':
        mockResponses = [
          {
            formatted: '```\nServer: Test Server 1\nMap: bloodrun\nPlayers: 6\nGame Type: CA\n```',
          },
        ];
        break;
      case 'server':
        // Pass the server objects directly
        mockResponses = [mockServerStats[0]];
        break;
      case 'invalid':
        // Create an invalid format to test error handling
        mockResponses = [{ invalid: 'format' }];
        break;
      default:
        mockResponses = [
          {
            formatted: '```\nServer: Test Server 1\nMap: bloodrun\nPlayers: 6\nGame Type: CA\n```',
          },
        ];
    }
  }

  // Ensure OpenAI client is initialized
  const openaiClient = initializeOpenAI();

  // If testing OpenAI failure, modify the openai object temporarily
  const originalCreate = openaiClient.chat.completions.create;
  if (testOptions.mockOpenAIFailure) {
    openaiClient.chat.completions.create = async () => {
      throw new Error('Simulated OpenAI API failure');
    };
  }

  try {
    // Call the function with our mock data
    quakeLogger.debug(
      {
        mockResponsesType: typeof mockResponses,
        mockResponsesLength: mockResponses?.length,
        firstItem: mockResponses?.[0] ? JSON.stringify(mockResponses[0]).substring(0, 100) : null,
      },
      'Test data details'
    );

    const result = await processServerStatsWithAI(mockResponses, mockServerStats);
    quakeLogger.info('AI Summary Test Result:\n' + result);
    return result;
  } catch (error) {
    quakeLogger.error({ error }, 'AI Summary Test Error');
    return `Error: ${error.message}`;
  } finally {
    // Restore original function if we mocked it
    if (testOptions.mockOpenAIFailure) {
      openaiClient.chat.completions.create = originalCreate;
    }
  }
}

/**
 * Quake Lookup API exports.
 *
 * @type {QuakeLookupAPI}
 */
module.exports = Object.assign(lookupQuakeServer, { testOpenAISummary });

// Allow direct testing
if (require.main === module) {
  (async () => {
    try {
      // Test standard server lookup
      quakeLogger.info('=== Testing standard server lookup ===');
      const result = await lookupQuakeServer();
      quakeLogger.info(result);

      // Test OpenAI summary functionality with different formats
      quakeLogger.info('\n=== Testing OpenAI summary with object format ===');
      await testOpenAISummary({ responseFormat: 'object' });

      quakeLogger.info('\n=== Testing OpenAI summary with string format ===');
      await testOpenAISummary({ responseFormat: 'string' });

      quakeLogger.info('\n=== Testing OpenAI summary with server object format ===');
      await testOpenAISummary({ responseFormat: 'server' });

      // Test error handling
      quakeLogger.info('\n=== Testing OpenAI failure fallback ===');
      await testOpenAISummary({ mockOpenAIFailure: true });

      quakeLogger.info('\n=== Testing invalid response format handling ===');
      await testOpenAISummary({ responseFormat: 'invalid' });

      quakeLogger.info('\n=== Testing empty response handling ===');
      await testOpenAISummary({ emptyResponse: true });

      quakeLogger.info('\n=== Testing null response handling ===');
      await testOpenAISummary({ nullResponse: true });

      quakeLogger.info('\n=== All tests completed successfully ===');
    } catch (error) {
      quakeLogger.error({ error }, 'Test execution error');
    }
  })();
}
