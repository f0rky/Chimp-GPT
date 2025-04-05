const axios = require('axios');
const OpenAI = require('openai');

// Constants
const SERVERS_API_URL = 'https://ql.syncore.org/api/servers';
const QLSTATS_API_URL = 'https://ql.syncore.org/api/qlstats/rankings';
const DEFAULT_PARAMS = {
    regions: 'Oceania',
    hasPlayers: true,
    hasBots: false
};
const DISCORD_CHAR_LIMIT = 2000;
const BUFFER_SPACE = 100;
const CONFIG = {
    // ELO display mode:
    // 0 = Off (don't show ELO)
    // 1 = Categorized (Scrub/Mid/Pro)
    // 2 = Actual ELO value
    eloMode: 1,
    maxServers: 3
};

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

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
        console.error('Uptime calculation error:', error);
        return '00:00:00';
    }
}

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
        console.log('Requesting QLStats for:', serverAddress);
        const response = await axios.get(`${QLSTATS_API_URL}?servers=${serverAddress}`);
        return response.data;
    } catch (error) {
        console.error('Error fetching QLStats data:', error);
        return { rankedPlayers: [] };
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
 * @param {number} rating - Player's ELO rating
 * @returns {string} - ELO category
 */
function getEloCategory(rating) {
    if (rating < 800) return 'Scrub';
    if (rating < 1301) return 'Mid';
    return 'Pro';
}

/**
 * Format player line with configurable ELO display
 * @param {Object} player - Player data
 * @param {boolean} isSpectator - Whether player is a spectator
 * @returns {string} - Formatted player line
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

function formatServerResponse(serverStats, qlstatsData) {
    const steamLink = `steam://connect/${serverStats.address}`;
    const avgRating = CONFIG.eloMode > 0 && qlstatsData.rankedPlayers?.length > 0 
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
            formatPlayerList(qlstatsData.rankedPlayers, serverStats.players, serverStats),
            '',
            '═════════════════════════════════',
            '```'
        ].filter(line => line !== '').join('\n')
    };
}

/**
 * Process server stats with AI to create a concise summary when the response exceeds Discord's character limit
 * @param {Array} serverResponses - Array of formatted server responses
 * @param {Array} allServerStats - Array of all server stats objects
 * @returns {Promise<string>} - AI-processed summary
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

async function lookupQuakeServer() {
    console.log("lookupQuakeServer: Function started");

    try {
        const { data } = await axios.get(SERVERS_API_URL, {
            params: DEFAULT_PARAMS,
            timeout: 5000
        });

        if (!data?.servers?.length) {
            return [{
                formatted: '```\n  🚫  No active servers found.\n```'
            }];
        }

        const sortedServers = data.servers
            .filter(server => server?.info?.players > 0)
            .sort((a, b) => b.info.players - a.info.players)
            .slice(0, CONFIG.maxServers);

        if (!sortedServers.length) {
            return [{
                formatted: '```\n  🚫  No active servers found.\n```'
            }];
        }

        // Process all servers to get their stats
        const allServerStats = [];
        const results = [];
        let totalSize = 0;

        // Always process at least the first server
        if (sortedServers.length > 0) {
            try {
                const server = sortedServers[0];
                const serverStats = extractServerStats(server);
                const qlstatsData = await getQLStatsData(serverStats.address);
                const formattedResponse = formatServerResponse(serverStats, qlstatsData);
                
                // Store server stats and add to results
                allServerStats.push(serverStats);
                results.push(formattedResponse);
                totalSize += formattedResponse.formatted.length;
                
                // Process remaining servers
                for (let i = 1; i < sortedServers.length; i++) {
                    const server = sortedServers[i];
                    const serverStats = extractServerStats(server);
                    const qlstatsData = await getQLStatsData(serverStats.address);
                    const formattedResponse = formatServerResponse(serverStats, qlstatsData);
                    
                    // Store all server stats for potential AI processing
                    allServerStats.push(serverStats);
                    
                    if (totalSize + formattedResponse.formatted.length <= DISCORD_CHAR_LIMIT - BUFFER_SPACE) {
                        results.push(formattedResponse);
                        totalSize += formattedResponse.formatted.length;
                    } else {
                        break;
                    }
                }
            } catch (error) {
                console.error('Error processing server data:', error);
                // If we failed to process any servers, create a basic formatted response for the first server
                if (results.length === 0 && sortedServers.length > 0) {
                    try {
                        const server = sortedServers[0];
                        const serverStats = extractServerStats(server);
                        allServerStats.push(serverStats);
                        
                        // Create a complete formatted response with player information
                        const steamLink = `steam://connect/${serverStats.address}`;
                        const playerList = serverStats.players.map(player => {
                            const cleanName = stripColorCodes(player.name);
                            return `${cleanName} ${player.score}`;
                        }).join('\n') || "No players";
                        
                        const formattedResponse = {
                            formatted: [
                                '```',
                                '═════════════════════════════════',
                                `🎮 ${serverStats.serverName}`,
                                '─────────────────────────────────',
                                `🗺️ Map: ${serverStats.currentMap}`,
                                `🎯 Status: ${formatGameStatus(serverStats)}`,
                                `👥 Players: ${serverStats.playerCount}`,
                                `⏱️ Uptime: ${serverStats.uptime}`,
                                '',
                                '─────────────────────────────────',
                                '',
                                // For the fallback case, we don't have team information, so just show players
                                playerList,
                                '',
                                '═════════════════════════════════',
                                '```'
                            ].filter(line => line !== '').join('\n')
                        };
                        
                        results.push(formattedResponse);
                    } catch (innerError) {
                        console.error('Error creating fallback response:', innerError);
                        return [{
                            formatted: '```\n  ⚠️   Error processing server data.\n```'
                        }];
                    }
                }
            }
        }

        // If we have no results at this point, return an error
        if (results.length === 0) {
            return [{
                formatted: '```\n  ⚠️   Error retrieving server information.\n```'
            }];
        }

        // Check if we need AI processing (if we couldn't fit all servers)
        if (results.length < sortedServers.length) {
            try {
                // Process with AI and return a single result
                const aiProcessedResult = await processServerStatsWithAI(results, allServerStats);
                return [{ formatted: aiProcessedResult }];
            } catch (error) {
                console.error('Error in AI processing:', error);
                // Fallback: return what we have plus a message about additional servers
                const remaining = sortedServers.length - results.length;
                results.push({
                    formatted: `\n\`\`\`\n  ℹ️   ${remaining} more server${remaining > 1 ? 's' : ''} not shown due to space constraints.\n\`\`\``
                });
                return results;
            }
        }

        return results;

    } catch (error) {
        console.error('Server stats fetch error:', error);
        return [{
            formatted: '```\n  ⚠️   Error fetching server stats: ' + error.message + '\n```'
        }];
    }
}

module.exports = lookupQuakeServer;

// Allow direct testing
if (require.main === module) {
    (async () => {
        try {
            const results = await lookupQuakeServer();
            results.forEach(result => {
                console.log(result.formatted + '\n');
            });
        } catch (error) {
            console.error('Test execution error:', error);
        }
    })();
}