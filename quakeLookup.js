const axios = require('axios');

const API_URL = 'https://ql.syncore.org/api/servers?regions=Oceania&hasPlayers=true&hasBots=false';

function getTopPlayer(players) {
    if (players.length === 0) {
        throw new Error("No players found.");
    }

    return players.reduce((prev, current) => {
        return (prev.score > current.score) ? prev : current;
    });
}
function calculateUptime(levelStartTime) {
    const currentTime = Math.floor(Date.now() / 1000);  // Current time in seconds
    const uptimeSeconds = currentTime - parseInt(levelStartTime);
    return new Date(uptimeSeconds * 1000).toISOString().substr(11, 8);  // Convert seconds to HH:mm:ss format
}

function extractServerStats(server) {
    const { info, players, rules } = server;
    const topPlayer = getTopPlayer(players);
    const uptime = calculateUptime(rules.g_levelStartTime);

    return {
        serverName: info.serverName.trim(),
        currentMap: info.map,
        playerCount: `${info.players}/${info.maxPlayers}`,
        currentTopPlayer: `${topPlayer.name} with ${topPlayer.score} points`,
        uptime
    };
}

async function getServerStats() {
    console.log("getServerStats: Function started");

    try {
        const { data } = await axios.get(API_URL);

        if (data && data.servers && data.servers.length > 0) {
            // Sort the servers by player count in descending order
            const sortedServers = data.servers.sort((a, b) => b.info.players - a.info.players);

            // Extract stats for top 3 servers or less
            const topServers = sortedServers.slice(0, 3).map(extractServerStats);

            console.log("getServerStats: Function completed");

            return topServers;
        } else {
            return [{ message: "No active servers found." }];
        }
    } catch (error) {
        console.error(error);
        return [{ error: "Error fetching server stats." }];
    }
}

module.exports = getServerStats;

if (require.main === module) {  // Check if the script is being run directly
    (async () => {
        const results = await getServerStats();
        
        results.forEach((result, index) => {
            if (result.error || result.message) {
                console.log(result.error || result.message);
            } else {
                console.log(`Server ${index + 1}:\n`, result, '\n');
            }
        });
    })();
}
