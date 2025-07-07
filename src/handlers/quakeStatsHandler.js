const { logger, discord: discordLogger } = require('../core/logger');
const lookupQuakeServer = require('../services/quakeLookup');

/**
 * Handles requests for Quake server statistics
 *
 * This function retrieves Quake server statistics and updates the message
 * with the formatted results. It uses the configured ELO display mode.
 *
 * @param {Object} feedbackMessage - The Discord message to update with results
 * @param {string} loadingEmoji - The emoji to show while loading
 * @param {Object} statusManager - Status manager instance for tracking
 * @returns {Promise<boolean>} True if successful, false if an error occurred
 */
async function handleQuakeStats(feedbackMessage, loadingEmoji, statusManager) {
  try {
    await feedbackMessage.edit(`${loadingEmoji} Checking server stats...`);

    // Get server stats - lookupQuakeServer now returns a formatted string
    const serverStats = await lookupQuakeServer();

    // The AI processing in quakeLookup.js should ensure we're under the Discord character limit
    // but we'll still truncate if needed as a safety measure
    const finalMessage = serverStats.slice(0, 1997) + (serverStats.length > 1997 ? '...' : '');

    // Log Discord message content if debug logging enabled
    if (process.env.ENABLE_DISCORD_MESSAGE_LOGGING === 'true') {
      logger.info(
        {
          messageLength: finalMessage.length,
          messageContent: finalMessage,
          originalLength: serverStats.length,
          wasTruncated: serverStats.length > 1997,
        },
        'Discord message content for Quake stats'
      );
    }

    await feedbackMessage.edit(finalMessage);

    // Count active servers for status update
    // Extract server count from response (improved parsing)
    let serverCount = 0;

    if (serverStats.includes('No active servers found')) {
      serverCount = 0;
    } else {
      // Look for server headings in different formats
      // Format 1: '# Server: <name>'
      const serverHeadings1 = (serverStats.match(/# Server:/g) || []).length;

      // Format 2: '## <name>' (used in some responses)
      const serverHeadings2 = (serverStats.match(/## [^#]/g) || []).length;

      // Format 3: 'Server: <name>' (used in AI-generated summaries)
      const serverHeadings3 = (serverStats.match(/Server: /g) || []).length;

      // Use the maximum count from any of these patterns
      serverCount = Math.max(serverHeadings1, serverHeadings2, serverHeadings3);

      // If we still have 0 but the response doesn't indicate no servers, assume at least 1
      if (serverCount === 0 && !serverStats.includes('No active servers found')) {
        serverCount = 1;
      }
    }

    // Update status with server count and username if available
    const username = feedbackMessage.author ? feedbackMessage.author.username : null;
    if (statusManager && typeof statusManager.trackQuakeLookup === 'function') {
      statusManager.trackQuakeLookup(serverCount, username);
    }

    return true;
  } catch (error) {
    discordLogger.error({ error }, 'Error in handleQuakeStats');
    await feedbackMessage.edit(
      '# 🎯 Quake Live Server Status\n\n> ⚠️ An error occurred while retrieving server information.'
    );
    return false;
  }
}

module.exports = {
  handleQuakeStats,
};
