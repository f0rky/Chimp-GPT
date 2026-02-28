/**
 * Discovery Routes
 * GET /api/discover-bots, /api/discover-services
 */

const { Router } = require('express');
const { createLogger } = require('../../core/logger');
const { discoverPM2Bots, discoverDockerBots, checkBotHealth } = require('../utils/botDiscovery');
const config = require('../../core/configValidator');

const logger = createLogger('discoveryRoutes');

function createRouter() {
  const router = Router();

  // GET /api/discover-bots
  router.get('/api/discover-bots', async (req, res) => {
    try {
      const discoveredBots = [];

      try {
        discoveredBots.push(...(await discoverPM2Bots()));
      } catch (e) {
        logger.warn({ error: e }, 'PM2 discovery failed');
      }

      try {
        discoveredBots.push(...(await discoverDockerBots()));
      } catch (e) {
        logger.warn({ error: e }, 'Docker discovery failed');
      }

      const botsWithHealth = await Promise.allSettled(
        discoveredBots.map(bot => checkBotHealth(bot.port, bot.botName, bot.name))
      );

      const healthyBots = botsWithHealth
        .filter(r => r.status === 'fulfilled' && r.value.accessible)
        .map(r => r.value);

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
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/discover-services
  router.get('/api/discover-services', async (req, res) => {
    try {
      const { discoverServices, getCurrentBotInfo } = require('../../utils/serviceDiscovery');
      const startPort = parseInt(req.query.startPort, 10) || 3000;
      const endPort = parseInt(req.query.endPort, 10) || 3020;
      const botsOnly = req.query.botsOnly === 'true';

      if (startPort < 1 || endPort > 65535 || startPort > endPort) {
        return res.status(400).json({
          success: false,
          error: 'Invalid port range. Ports must be between 1-65535 and startPort <= endPort',
        });
      }
      if (endPort - startPort > 100) {
        return res
          .status(400)
          .json({ success: false, error: 'Port range too large. Maximum range is 100 ports.' });
      }

      const discoveryResults = await discoverServices({ startPort, endPort, maxParallel: 5 });
      const currentPort = config.PORT || process.env.PORT || 3001;
      const currentBot = getCurrentBotInfo(currentPort);
      const services = botsOnly ? discoveryResults.botServices : discoveryResults.services;

      let legacyBots = [];
      try {
        const allLegacyBots = [...(await discoverPM2Bots()), ...(await discoverDockerBots())];
        const legacyHealth = await Promise.allSettled(
          allLegacyBots.map(bot => checkBotHealth(bot.port, bot.botName, bot.name))
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

      return res.json({
        success: true,
        ...discoveryResults,
        services,
        botServices: uniqueBots,
        currentBot: { ...currentBot, url: `${req.protocol}://${req.get('host')}` },
        discovery: {
          portRange: { start: startPort, end: endPort },
          botsOnly,
          legacyBotsFound: legacyBots.length,
          totalUniqueServices: services.length,
          totalUniqueBots: uniqueBots.length,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Error in comprehensive service discovery');
      return res
        .status(500)
        .json({ success: false, error: error.message, timestamp: new Date().toISOString() });
    }
  });

  return router;
}

module.exports = { createRouter };
