/**
 * Discovery Routes
 * GET /api/discover-bots, /api/discover-services
 *
 * Both routes are owner-only (X-Owner-Token header), scan only the local 3000-3020 window,
 * and return an allow-listed summary of each service (no raw responses, headers, or env).
 */

const { Router } = require('express');
const { createLogger } = require('../../core/logger');
const { discoverPM2Bots, discoverDockerBots, checkBotHealth } = require('../utils/botDiscovery');
const { requireOwnerToken } = require('../middleware/ownerAuth');
const config = require('../../core/configValidator');

const logger = createLogger('discoveryRoutes');

const PORT_WINDOW = { START: 3000, END: 3020 };
const MAX_PORT_RANGE = 100;
const DISPLAY_FIELDS = [
  'name',
  'botName',
  'instanceName',
  'version',
  'environment',
  'discordStatus',
  'uptime',
  'formattedUptime',
];
const MAX_TEXT_LENGTH = 200;

// Values come from arbitrary local services, so every field is type-checked
const ENTRY_TYPES = {
  host: 'string',
  url: 'string',
  status: 'string',
  accessible: 'boolean',
  serviceType: 'string',
  isBotService: 'boolean',
  botConfidence: 'number',
  workingEndpoints: 'number',
  totalEndpoints: 'number',
};
const HEALTH_TYPES = {
  hasHealthEndpoint: 'boolean',
  hasApiEndpoint: 'boolean',
  responseTime: 'number',
  status: 'number',
};

/**
 * Coerce a value to the expected type: strings are trimmed and capped, numbers must be finite.
 * @returns {*} the safe value, or undefined to drop it
 */
function typedValue(value, type) {
  if (typeof value !== type) return undefined;
  if (type === 'string') return value.trim().slice(0, MAX_TEXT_LENGTH);
  if (type === 'number' && !Number.isFinite(value)) return undefined;
  return value;
}

function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Reduce a discovery/health result to display fields. Top-level values win over serviceInfo.
 * @param {Object} entry
 * @returns {Object|null} null when the entry has no valid integer port
 */
function sanitizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || !isValidPort(entry.port)) return null;
  const info = entry.serviceInfo && typeof entry.serviceInfo === 'object' ? entry.serviceInfo : {};
  const safe = { port: entry.port };
  for (const [field, type] of Object.entries(ENTRY_TYPES)) {
    const value = typedValue(entry[field], type);
    if (value !== undefined) safe[field] = value;
  }
  for (const field of DISPLAY_FIELDS) {
    const value = typedValue(entry[field], 'string') ?? typedValue(info[field], 'string');
    if (value !== undefined) safe[field] = value;
  }
  const guilds = entry.discordGuilds ?? info.discordGuilds;
  if (Number.isInteger(guilds) && guilds >= 0) safe.discordGuilds = guilds;
  if (entry.health && typeof entry.health === 'object') {
    safe.health = {};
    for (const [field, type] of Object.entries(HEALTH_TYPES)) {
      const value = typedValue(entry.health[field], type);
      if (value !== undefined) safe.health[field] = value;
    }
  }
  return safe;
}

function sanitizeEntries(entries) {
  return entries.map(sanitizeEntry).filter(Boolean);
}

/**
 * Parse an optional port bound. Returns the default when absent, or null when invalid.
 */
function parsePortBound(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  return parseInt(value, 10);
}

/**
 * Discovery data sources may be injected for hermetic tests. Authorization is always the shared
 * ownerAuth middleware; an injected requireOwnerToken is intentionally ignored.
 * @param {{ discoverPM2Bots?: Function, discoverDockerBots?: Function, checkBotHealth?: Function, discoverServices?: Function, getCurrentBotInfo?: Function }} deps
 */
function createRouter(deps = {}) {
  const {
    discoverPM2Bots: discoverPM2BotsImpl = discoverPM2Bots,
    discoverDockerBots: discoverDockerBotsImpl = discoverDockerBots,
    checkBotHealth: checkBotHealthImpl = checkBotHealth,
  } = deps;
  const router = Router();

  // GET /api/discover-bots
  router.get('/api/discover-bots', requireOwnerToken, async (req, res) => {
    try {
      const discoveredBots = [];

      try {
        discoveredBots.push(...(await discoverPM2BotsImpl()));
      } catch (e) {
        logger.warn({ error: e }, 'PM2 discovery failed');
      }

      try {
        discoveredBots.push(...(await discoverDockerBotsImpl()));
      } catch (e) {
        logger.warn({ error: e }, 'Docker discovery failed');
      }

      const botsWithHealth = await Promise.allSettled(
        discoveredBots.map(bot => checkBotHealthImpl(bot.port, bot.botName, bot.name))
      );

      const healthyBots = sanitizeEntries(
        botsWithHealth.filter(r => r.status === 'fulfilled' && r.value.accessible).map(r => r.value)
      );

      res.json({
        success: true,
        count: healthyBots.length,
        totalDiscovered: discoveredBots.length,
        bots: healthyBots,
        currentBot: {
          name: config.BOT_NAME || process.env.BOT_NAME || 'ChimpGPT',
          port: config.PORT || process.env.PORT || 3001,
          url: `${req.protocol}://${req.get('host')}`,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Error discovering bot instances');
      res.status(500).json({ success: false, error: 'Bot discovery failed' });
    }
  });

  // GET /api/discover-services
  router.get('/api/discover-services', requireOwnerToken, async (req, res) => {
    try {
      const startPort = parsePortBound(req.query.startPort, PORT_WINDOW.START);
      const endPort = parsePortBound(req.query.endPort, PORT_WINDOW.END);
      const botsOnly = req.query.botsOnly === 'true';

      if (
        startPort === null ||
        endPort === null ||
        startPort < PORT_WINDOW.START ||
        endPort > PORT_WINDOW.END ||
        startPort > endPort
      ) {
        return res.status(400).json({
          success: false,
          error: `Invalid port range. Ports must be within ${PORT_WINDOW.START}-${PORT_WINDOW.END} and startPort <= endPort`,
        });
      }
      if (endPort - startPort > MAX_PORT_RANGE) {
        return res.status(400).json({
          success: false,
          error: `Port range too large. Maximum range is ${MAX_PORT_RANGE} ports.`,
        });
      }

      const {
        discoverServices = require('../../utils/serviceDiscovery').discoverServices,
        getCurrentBotInfo = require('../../utils/serviceDiscovery').getCurrentBotInfo,
      } = deps;
      const discoveryResults = await discoverServices({ startPort, endPort, maxParallel: 5 });
      const currentPort = config.PORT || process.env.PORT || 3001;
      const currentBot = getCurrentBotInfo(currentPort);
      const services = botsOnly ? discoveryResults.botServices : discoveryResults.services;

      let legacyBots = [];
      try {
        const allLegacyBots = [
          ...(await discoverPM2BotsImpl()),
          ...(await discoverDockerBotsImpl()),
        ];
        const legacyHealth = await Promise.allSettled(
          allLegacyBots.map(bot => checkBotHealthImpl(bot.port, bot.botName, bot.name))
        );
        legacyBots = legacyHealth
          .filter(r => r.status === 'fulfilled' && r.value.accessible)
          .map(r => r.value);
      } catch (e) {
        logger.warn({ error: e }, 'Legacy discovery failed');
      }

      const allBots = [...services.filter(s => s.isBotService), ...legacyBots];
      const uniqueBots = allBots.reduce((unique, bot) => {
        const existing = unique.find(b => b.port === bot.port);
        if (!existing) {
          unique.push(bot);
        } else {
          Object.assign(existing, {
            ...existing,
            ...bot,
            botConfidence: Math.max(existing.botConfidence || 0, bot.botConfidence || 0),
          });
        }
        return unique;
      }, []);
      const safeServices = sanitizeEntries(services);
      const safeBots = sanitizeEntries(uniqueBots);

      return res.json({
        success: true,
        discoveryTime: discoveryResults.discoveryTime,
        portRange: { start: startPort, end: endPort },
        totalPorts: discoveryResults.totalPorts,
        activePorts: discoveryResults.activePorts,
        closedPorts: discoveryResults.closedPorts,
        services: safeServices,
        botServices: safeBots,
        currentBot: { ...currentBot, url: `${req.protocol}://${req.get('host')}` },
        discovery: {
          portRange: { start: startPort, end: endPort },
          botsOnly,
          legacyBotsFound: legacyBots.length,
          totalUniqueServices: safeServices.length,
          totalUniqueBots: safeBots.length,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Error in comprehensive service discovery');
      return res.status(500).json({
        success: false,
        error: 'Service discovery failed',
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}

module.exports = { createRouter };
