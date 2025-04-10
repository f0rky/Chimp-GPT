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
const OpenAI = require('openai');
const { quake: quakeLogger } = require('./logger');
const { validateServerInput, validateEloMode, sanitizeOutput } = require('./utils/inputValidator');

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
    hasBots: false
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
    maxServers: 3
};

/**
 * OpenAI client instance for AI-powered summaries
 * @type {OpenAI}
 */
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/**
 * Calculate server uptime from level start time
 * 
 * Converts the level start time (Unix timestamp) to a formatted
 * uptime string in the format HH:MM:SS.
 * 
 * @param {string|number} levelStartTime - Unix timestamp when the level started
 * @returns {string} Formatted uptime string (HH:MM:SS)
 */
function calculateUptime(levelStartTime) {
    try {
        const startTime = parseInt(levelStartTime, 10);
        if (isNaN(startTime)) {
            throw new Error("Invalid level start time");
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
 * Remove Quake color codes from text
 * 
 * Quake uses color codes in the format ^n where n is a digit.
 * This function removes these codes to display clean text.
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
        
        let winningTeam = '';
        if (redScore > blueScore) {
            winningTeam = 'RED leading';
        } else if (blueScore > redScore) {
            winningTeam = 'BLUE leading';
        } else {
            winningTeam = 'Teams tied';
        }
        
        return `${winningTeam} (First to ${serverStats.roundLimit})`;
    }
    return serverStats.gameType;
}

async function getQLStatsData(serverAddress) {
    try {
        // Validate server address before making API call
        const validatedAddress = validateServerInput(serverAddress);
        if (!validatedAddress.isValid) {
            quakeLogger.warn({ address: serverAddress }, 'Invalid server address in getQLStatsData');
            return null;
        }
        
        const response = await axios.get(`${QLSTATS_API_URL}?server=${encodeURIComponent(validatedAddress.value)}`, { timeout: 3000 });
        return response.data;
    } catch (error) {
        quakeLogger.error({ error, serverAddress }, 'Error fetching QLStats data');
        return null;
    }
}

function mergePlayerData(basicPlayers, qlstatsPlayers) {
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
        const basicData = playerMap.get(strippedName) || {};
        
        return {
            name: qlstatsPlayer.name,
            score: basicData.score || 0,
            totalConnected: basicData.totalConnected || '0:00',
            team: qlstatsPlayer.team,
            rating: qlstatsPlayer.rating
        };
    });
}

/**
 * Get ELO category (Scrub/Mid/Pro) based on rating
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
 * Format player line with configurable ELO display
 * 
 * Creates a formatted string for a player entry in the server stats display.
 * The format changes based on whether the player is active or spectating and
 * includes ELO information according to the configured display mode.
 * 
 * @param {Object} player - Player data
 * @param {string} player.name - Player's name
 * @param {number} [player.score] - Player's score (for active players)
 * @param {number} [player.ping] - Player's ping in milliseconds
 * @param {number} [player.elo] - Player's ELO rating if available
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
    const score = `${String(player.score).padStart(2)}`;
    
    // Handle different ELO display modes
    let eloDisplay = '';
    if (CONFIG.eloMode === 1 && player.rating) {
        // Mode 1: Show category (Scrub/Mid/Pro)
        eloDisplay = `(${getEloCategory(player.rating)})`;
    } else if (CONFIG.eloMode === 2 && player.rating) {
        // Mode 2: Show actual ELO value
        eloDisplay = `(${String(player.rating).padStart(4)})`;
    }
    
    return `${cleanName} ${score} ${eloDisplay}`;
}

/**
 * Format player list for display
 * 
 * Creates a formatted string for the player list, including team scores,
 * player names, and ELO information based on the configured display mode.
 * 
 * @param {Array<Object>} players - Player data array
 * @param {Array<Object>} basicPlayers - Basic player data from server stats
 * @param {Object} serverStats - Server stats object
 * @returns {string} Formatted player list string
 */
function formatPlayerList(players, basicPlayers = [], serverStats = null) {
    if (!players?.length) {
        return basicPlayers.map(player => {
            const cleanName = stripColorCodes(player.name);
            return `${cleanName} ${player.score}`;
        }).join('\n') || "No players";
    }

    const mergedPlayers = mergePlayerData(basicPlayers, players);
    const isWarmup = mergedPlayers.every(p => p.score === 0);
    
    const teams = {
        red: mergedPlayers.filter(p => p.team === 1),
        blue: mergedPlayers.filter(p => p.team === 2),
        spec: mergedPlayers.filter(p => p.team === 3)
    };
    
    // Add team scores to player objects if available from serverStats
    if (serverStats && serverStats.teamScores) {
        teams.red.forEach(p => p.teamScore = serverStats.teamScores.red);
        teams.blue.forEach(p => p.teamScore = serverStats.teamScores.blue);
    }

    const sortFn = isWarmup && CONFIG.showElo ? 
        ((a, b) => b.rating - a.rating) : 
        ((a, b) => b.score - a.score);

    Object.values(teams).forEach(team => team.sort(sortFn));

    const lines = [];
    
    // Get team scores from the first player's team data
    let redScore = 0;
    let blueScore = 0;
    
    // Try to find team scores from player data
    const firstRedPlayer = teams.red[0];
    const firstBluePlayer = teams.blue[0];
    
    if (firstRedPlayer && firstRedPlayer.teamScore) {
        redScore = firstRedPlayer.teamScore;
    }
    if (firstBluePlayer && firstBluePlayer.teamScore) {
        blueScore = firstBluePlayer.teamScore;
    }
    
    if (teams.red.length) {
        lines.push(`🔴 RED TEAM (${redScore})`);
        lines.push('───────────────────────────');
        teams.red.forEach(p => {
            lines.push(formatPlayerLine(p));
        });
        lines.push('');
    }
    
    if (teams.blue.length) {
        lines.push(`🔵 BLUE TEAM (${blueScore})`);
        lines.push('───────────────────────────');
        teams.blue.forEach(p => {
            lines.push(formatPlayerLine(p));
        });
        lines.push('');
    }
    
    // For spectators, only show names in a compact format if there are any
    if (teams.spec.length) {
        lines.push('👁️ SPECTATORS: ' + teams.spec.slice(0, 5).map(p => stripColorCodes(p.name)).join(', '));
        
        // If there are more than 5 spectators, just show the count
        if (teams.spec.length > 5) {
            lines.push(`...and ${teams.spec.length - 5} more`);
        }
    }
    
    return lines.join('\n');
}

/**
 * Extract server stats from server data
 * 
 * Creates a server stats object with relevant information for display.
 * 
 * @param {Object} server - Server data object
 * @returns {Object} Server stats object
 */
function extractServerStats(server) {
    const { info, rules, players } = server;
    const uptime = calculateUptime(rules.g_levelStartTime);
    
    return {
        serverName: info.serverName.trim(),
        currentMap: info.map,
        playerCount: `${info.players}/${info.maxPlayers}`,
        gameType: info.gameTypeShort === 'CA' ? 'Clan Arena' : info.gameType,
        teamScores: {
            red: rules.g_redScore,
            blue: rules.g_blueScore
        },
        roundLimit: rules.roundlimit,
        uptime,
        address: server.address,
        players
    };
}

/**
 * Format server response for display
 * 
 * Creates a formatted string for a server response, including server information,
 * player list, and team scores.
 * 
 * @param {Object} serverStats - Server stats object
 * @param {Object} qlstatsData - QLStats data object
 * @returns {Object} Formatted server response object
 */
function formatServerResponse(serverStats, qlstatsData) {
    const steamLink = `steam://connect/${serverStats.address}`;
    // Check if qlstatsData exists and has rankedPlayers before accessing properties
    const avgRating = CONFIG.eloMode > 0 && qlstatsData && qlstatsData.rankedPlayers && qlstatsData.rankedPlayers.length > 0 
        ? `Avg Rating: ${Math.round(qlstatsData.avg)}` : '';

    return {
        formatted: [
            '```',
            '═════════════════════════════════',
            `🎮 ${serverStats.serverName}`,
            '─────────────────────────────────',
            `🗺️ Map: ${serverStats.currentMap}`,
            `🎯 Status: ${formatGameStatus(serverStats)}`,
            `👥 Players: ${serverStats.playerCount}`,
            `⏱️ Uptime: ${serverStats.uptime}`,
            avgRating ? `📊 ${avgRating}` : '',
            '',
            formatPlayerList(qlstatsData?.rankedPlayers || [], serverStats.players, serverStats),
            '',
            '═════════════════════════════════',
            '```'
        ].filter(line => line !== '').join('\n')
    };
}

/**
 * Process server stats with AI to create a concise summary
 * 
 * When the full server stats would exceed Discord's character limit,
 * this function uses OpenAI to generate a condensed summary of the
 * most important information from all servers.
 * 
 * @param {Array<string>} serverResponses - Array of formatted server responses
 * @param {Array<Object>} allServerStats - Array of all server stats objects
 * @returns {Promise<Object>} AI-processed summary object with formatted property
 */
async function processServerStatsWithAI(serverResponses, allServerStats) {
    try {
        // Check if serverResponses is valid
        if (!serverResponses || !serverResponses.length || !serverResponses[0]?.formatted) {
            throw new Error('Invalid server responses data');
        }
        
        // Always include the first server's full details
        const firstServerResponse = serverResponses[0].formatted;
        
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
                playerNames: server.players.map(p => stripColorCodes(p.name))
            };
        });
        
        try {
            // Use OpenAI to generate a concise summary
            const aiResponse = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant that summarizes Quake Live server information. Create a very concise summary of the additional servers in 3-4 sentences total. Focus on player counts, maps, and game types."
                    },
                    {
                        role: "user",
                        content: `Summarize these additional Quake Live servers in a very brief format: ${JSON.stringify(serverSummaries)}`
                    }
                ],
                max_tokens: 150
            });
            
            const aiSummary = aiResponse.choices[0].message.content;
            
            // Combine the first server's full details with the AI summary
            return firstServerResponse + '\n```\n\n**Additional Servers**\n' + aiSummary + '\n```';
        } catch (openaiError) {
            console.error('OpenAI API error:', openaiError);
            // Fallback to a simple manual summary if OpenAI API fails
            const manualSummary = remainingServers.map(server => {
                return `${server.serverName} - Map: ${server.currentMap}, Players: ${server.playerCount}, Type: ${server.gameType}`;
            }).join('\n');
            
            return firstServerResponse + '\n```\n\n**Additional Servers**\n' + manualSummary + '\n```';
        }
    } catch (error) {
        console.error('Error processing server stats with AI:', error);
        // Return a valid formatted response even if everything fails
        if (serverResponses && serverResponses.length) {
            return serverResponses.map(r => r.formatted || '').join('\n');
        } else if (allServerStats && allServerStats.length) {
            // Create a basic formatted response from the first server stats
            const firstServer = allServerStats[0];
            return '```\n' + 
                   `Server: ${firstServer.serverName}\n` +
                   `Map: ${firstServer.currentMap}\n` +
                   `Players: ${firstServer.playerCount}\n` +
                   `Game Type: ${firstServer.gameType}\n` +
                   '```';
        } else {
            return '```\n  ⚠️   Error processing server stats\n```';
        }
    }
}

/**
 * Look up Quake Live server statistics
 * 
 * Main function that retrieves server information, player stats, and formats
 * the data for display in Discord. If the formatted output would exceed
 * Discord's character limit, it uses AI to create a condensed summary.
 * 
 * The function implements the compact display format preferred by the user,
 * with team scores next to team names, condensed spectator lists, and
 * configurable ELO display modes.
 * 
 * @param {string} [serverFilter=null] - Optional server name or IP to filter by
 * @param {number} [eloMode=null] - Optional ELO display mode override (0=Off, 1=Categorized, 2=Actual value)
 * @returns {Promise<string>} Formatted server statistics for display in Discord
 */
async function lookupQuakeServer(serverFilter = null, eloMode = null) {
    // Validate inputs (these should already be validated by the command module,
    // but we validate again here for safety and to handle direct calls)
    const validatedServer = validateServerInput(serverFilter);
    const validatedEloMode = validateEloMode(eloMode);
    
    quakeLogger.info({
        serverFilter: validatedServer.value,
        eloMode: validatedEloMode.value,
        originalServerFilter: serverFilter,
        originalEloMode: eloMode
    }, 'lookupQuakeServer: Function started');

    try {
        // Apply ELO mode override if provided
        if (validatedEloMode.value !== null) {
            CONFIG.eloMode = validatedEloMode.value;
        }
        
        const response = await axios.get(SERVERS_API_URL, {
            params: DEFAULT_PARAMS,
            timeout: 5000
        });

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

        // Process all servers to get their stats
        const serverResponses = [];
        const allServerStats = [];
        
        for (const server of sortedServers) {
            try {
                // Validate server address before making API call
                const validatedAddress = validateServerInput(server.address);
                if (!validatedAddress.isValid) {
                    quakeLogger.warn({ address: server.address }, 'Invalid server address');
                    continue;
                }
                
                // Get server stats
                const serverStats = extractServerStats(server);
                
                // Get QLStats data for the server
                const qlstatsData = await getQLStatsData(validatedAddress.value);
                
                // Format the server response
                const formattedResponse = formatServerResponse(serverStats, qlstatsData);
                serverResponses.push(formattedResponse.formatted);
                allServerStats.push(serverStats);
            } catch (error) {
                quakeLogger.error({ error, server: server.address }, 'Error getting QLStats data');
                // If we can't get QLStats data, still include the server but without ELO info
                const serverStats = extractServerStats(server);
                const formattedResponse = formatServerResponse(serverStats, null);
                serverResponses.push(formattedResponse.formatted);
                allServerStats.push(serverStats);
            }
        }

        // If we have no results at this point, return an error
        if (serverResponses.length === 0) {
            return sanitizeOutput('# 🎯 Quake Live Server Status\n\n> ⚠️ Error retrieving server information.');
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
        quakeLogger.error({ error }, 'Server stats fetch error');
        return sanitizeOutput('# 🎯 Quake Live Server Status\n\n> ⚠️ Error retrieving server information.');
    }
}

module.exports = lookupQuakeServer;

// Allow direct testing
if (require.main === module) {
    (async () => {
        try {
            const result = await lookupQuakeServer();
            console.log(result);
        } catch (error) {
            console.error('Test execution error:', error);
        }
    })();
}