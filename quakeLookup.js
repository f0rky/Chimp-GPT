const axios = require('axios');

async function getServerStats() {
    console.log("getServerStats: Function started");
    const apiUrl = 'https://ql.syncore.org/api/servers?regions=Oceania&hasPlayers=true&hasBots=false';

    try {
        const response = await axios.get(apiUrl);

        if (response.data && response.data.servers && response.data.servers.length > 0) {
            const server = response.data.servers[0];
            const info = server.info;
            const players = server.players;

            // Getting the top player based on score
            const topPlayer = players.reduce((prev, current) => {
                return (prev.score > current.score) ? prev : current;
            });

            // Calculate uptime based on the level start time
            const currentTime = Math.floor(Date.now() / 1000);  // Current time in seconds
            const uptimeSeconds = currentTime - parseInt(server.rules.g_levelStartTime);
            const uptime = new Date(uptimeSeconds * 1000).toISOString().substr(11, 8);  // Convert seconds to HH:mm:ss format
            console.log("getServerStats: Function completed");
            return {
                serverName: info.serverName.trim(),
                currentMap: info.map,
                playerCount: `${info.players}/${info.maxPlayers}`,
                currentTopPlayer: `${topPlayer.name} with ${topPlayer.score} points`,
                uptime: uptime
            };
        } else {
            return "No active servers found.";
        }
    } catch (error) {
        console.error(error);
        return "Error fetching server stats.";
    }
}

module.exports = getServerStats;

if (require.main === module) {  // Check if the script is being run directly
    (async () => {
        const result = await getServerStats();
        console.log(result);
    })();
}
