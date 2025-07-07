/**
 * Formats a standardized subtext with timing, token usage, and API call information
 *
 * This utility function creates consistent footer information for bot responses,
 * including processing time, token usage, and API call counts.
 *
 * @param {number} startTime - The timestamp when processing started
 * @param {Object} usage - Token usage information {promptTokens, completionTokens}
 * @param {Object} apiCalls - API calls made {openai: 0, weather: 0, wolfram: 0, etc}
 * @returns {string} Formatted subtext string
 */
function formatSubtext(startTime, usage = {}, apiCalls = {}) {
  // Calculate processing time
  const processingTimeMs = Date.now() - startTime;
  const processingTime = (processingTimeMs / 1000).toFixed(1);

  // Format timing display
  let timingDisplay;
  if (processingTime < 1) {
    timingDisplay = `${processingTimeMs}ms`;
  } else {
    timingDisplay = `${parseFloat(processingTime)}s`;
  }

  // Build token info if available
  let tokenInfo = '';
  if (usage.promptTokens || usage.completionTokens) {
    tokenInfo = ` • ${usage.promptTokens || 0}↑ ${usage.completionTokens || 0}↓`;
  }

  // Build API calls info if any were made
  let apiCallsInfo = '';
  const apiCallEntries = Object.entries(apiCalls).filter(([_, count]) => count > 0);
  if (apiCallEntries.length > 0) {
    const callsList = apiCallEntries
      .map(([api, count]) => (count > 1 ? `${api}×${count}` : api))
      .join(', ');
    apiCallsInfo = ` • ${callsList}`;
  }

  return `\n\n-# ${timingDisplay}${tokenInfo}${apiCallsInfo}`;
}

module.exports = {
  formatSubtext,
};
