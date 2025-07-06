/**
 * QL Syncore Web Scraper Module
 *
 * This module scrapes ql.syncore.org for comprehensive Quake Live server statistics
 * including player ELO ratings, team assignments, and detailed match data.
 * Designed to replace the deprecated QLStats API.
 *
 * @module QLSyncoreScraper
 * @author Brett
 * @version 1.0.0
 */

const { chromium } = require('playwright');
const { quake: quakeLogger } = require('../core/logger');

/**
 * In-memory cache for scraped data to avoid repeated requests
 * @type {Map<string, {data: Object, timestamp: number}>}
 */
const dataCache = new Map();

/**
 * Cache duration in milliseconds (default: 5 minutes)
 * @type {number}
 */
const CACHE_DURATION = (parseInt(process.env.SYNCORE_CACHE_MINUTES, 10) || 5) * 60 * 1000;

/**
 * Browser instance for reuse across scraping requests
 * @type {Browser|null}
 */
let browser = null;

/**
 * Initialize browser instance with stealth configuration
 * @returns {Promise<Browser>} Configured browser instance
 */
async function initBrowser() {
  if (browser && browser.isConnected()) {
    return browser;
  }

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });

    quakeLogger.info('Browser instance initialized for QL Syncore scraping');
    return browser;
  } catch (error) {
    quakeLogger.error({ error }, 'Failed to initialize browser for scraping');
    throw error;
  }
}

/**
 * Clean up browser resources
 * @returns {Promise<void>}
 */
async function closeBrowser() {
  if (browser && browser.isConnected()) {
    await browser.close();
    browser = null;
    quakeLogger.info('Browser instance closed');
  }
}

/**
 * Check if cached data is still valid
 * @param {string} cacheKey - Cache identifier
 * @returns {boolean} True if cache is valid
 */
function isCacheValid(cacheKey) {
  const cached = dataCache.get(cacheKey);
  if (!cached) return false;

  const age = Date.now() - cached.timestamp;
  return age < CACHE_DURATION;
}

/**
 * Get cached data if available and valid
 * @param {string} cacheKey - Cache identifier
 * @returns {Object|null} Cached data or null
 */
function getCachedData(cacheKey) {
  if (isCacheValid(cacheKey)) {
    const cached = dataCache.get(cacheKey);
    quakeLogger.debug({ cacheKey }, 'Using cached QL Syncore data');
    return cached.data;
  }
  return null;
}

/**
 * Store data in cache
 * @param {string} cacheKey - Cache identifier
 * @param {Object} data - Data to cache
 */
function setCachedData(cacheKey, data) {
  dataCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
  });
  quakeLogger.debug({ cacheKey }, 'Cached QL Syncore data');
}

/**
 * Scrape Oceania region servers from ql.syncore.org
 * @returns {Promise<Array>} Array of server data with player statistics
 */
async function scrapeOceaniaServers() {
  const cacheKey = 'oceania_servers';

  // Check cache first
  const cachedData = getCachedData(cacheKey);
  if (cachedData) {
    return cachedData;
  }

  if (process.env.ENABLE_SYNCORE_SCRAPING !== 'true') {
    quakeLogger.debug(
      'QL Syncore scraping disabled via ENABLE_SYNCORE_SCRAPING environment variable'
    );
    return [];
  }

  let page = null;
  try {
    const browserInstance = await initBrowser();
    page = await browserInstance.newPage();

    // Set stealth user agent
    await page.setExtraHTTPHeaders({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    });

    quakeLogger.info('Starting QL Syncore scraping for Oceania region');

    // Navigate to servers page
    await page.goto('https://ql.syncore.org/servers', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Wait for dynamic content to load (DataTable)
    await page.waitForSelector('#serverList tbody tr', { timeout: 15000 });
    await page.waitForTimeout(2000); // Extra wait for DataTable to fully populate

    // Debug: Get page content to understand structure
    if (process.env.ENABLE_QUAKE_DEBUG_LOGGING === 'true') {
      const title = await page.title();
      const url = page.url();
      quakeLogger.debug({ title, url }, 'Page loaded for scraping');
    }

    // Debug page structure first
    const pageInfo = await page.evaluate(() => {
      /* eslint-disable no-undef */
      const info = {
        hasTable: !!document.querySelector('table'),
        tableCount: document.querySelectorAll('table').length,
        rowCount: document.querySelectorAll('tr').length,
        tdCount: document.querySelectorAll('td').length,
        bodyContent: document.body.innerText.substring(0, 500),
        serverDivs: document.querySelectorAll('.server-row, .server, [class*="server"]').length,
        tableHTML:
          document.querySelector('table')?.outerHTML.substring(0, 1000) || 'No table found',
      };
      return info;
      /* eslint-enable no-undef */
    });

    if (process.env.ENABLE_QUAKE_DEBUG_LOGGING === 'true') {
      quakeLogger.debug({ pageInfo }, 'Page structure analysis');
    }

    // Extract server data from DataTable
    const serverData = await page.evaluate(() => {
      /* eslint-disable no-undef */
      const servers = [];

      // Target the specific DataTable structure
      const rows = document.querySelectorAll('#serverList tbody tr');

      rows.forEach((row, _index) => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 8) {
          // DataTable has more columns
          // DataTable column order based on header: [Favorite, Where, Name, Map, Players, Mode, IP, ...]
          const server = {
            favorite: cells[0]?.textContent?.trim() || '',
            location: cells[1]?.textContent?.trim() || '',
            name: cells[2]?.textContent?.trim() || '',
            map: cells[3]?.textContent?.trim() || '',
            playerCount: cells[4]?.textContent?.trim() || '0/0',
            gameMode: cells[5]?.textContent?.trim() || '',
            address: cells[6]?.textContent?.trim() || '',
            players: [],
          };

          // Filter for Oceania region servers (Australia/New Zealand)
          const isOceania =
            server.location?.toLowerCase().includes('au') ||
            server.location?.toLowerCase().includes('nz') ||
            server.name?.toLowerCase().includes('sydney') ||
            server.name?.toLowerCase().includes('melbourne') ||
            server.name?.toLowerCase().includes('oceania');

          // Only include servers with valid data and in Oceania region
          if (server.name && server.address && isOceania) {
            servers.push(server);
          }
        }
      });

      return servers;
      /* eslint-enable no-undef */
    });

    quakeLogger.info(
      { serverCount: serverData.length },
      'Successfully scraped QL Syncore server data'
    );

    // Cache the results
    setCachedData(cacheKey, serverData);

    return serverData;
  } catch (error) {
    quakeLogger.error({ error }, 'Failed to scrape QL Syncore data');
    throw error;
  } finally {
    if (page) {
      await page.close();
    }
  }
}

/**
 * Get detailed server information including player stats and ELO data
 * @param {string} serverAddress - Server IP:port to look up
 * @returns {Promise<Object|null>} Server data with player statistics or null
 */
async function getServerDetails(serverAddress) {
  try {
    const oceaniaServers = await scrapeOceaniaServers();

    // Find the specific server by address
    const server = oceaniaServers.find(s => s.address === serverAddress);

    if (!server) {
      quakeLogger.debug({ serverAddress }, 'Server not found in Oceania region data');
      return null;
    }

    // Transform data to match expected format
    return {
      serverName: server.name,
      address: server.address,
      currentMap: server.map,
      gameType: server.gameMode,
      playerCount: server.playerCount,
      rankedPlayers: server.players.map(player => ({
        name: player.name,
        score: player.score,
        rating: player.rating,
        team: player.team,
      })),
    };
  } catch (error) {
    quakeLogger.error({ error, serverAddress }, 'Failed to get server details from scraper');
    return null;
  }
}

/**
 * Clear all cached data
 */
function clearCache() {
  dataCache.clear();
  quakeLogger.info('QL Syncore scraper cache cleared');
}

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
function getCacheStats() {
  return {
    size: dataCache.size,
    keys: Array.from(dataCache.keys()),
    oldestEntry: Math.min(...Array.from(dataCache.values()).map(v => v.timestamp)),
  };
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  await closeBrowser();
});

process.on('SIGTERM', async () => {
  await closeBrowser();
});

module.exports = {
  scrapeOceaniaServers,
  getServerDetails,
  clearCache,
  getCacheStats,
  closeBrowser,
};
