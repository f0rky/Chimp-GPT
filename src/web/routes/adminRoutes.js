/**
 * Admin Routes
 * GET /blocked-users, POST /unblock-user, GET /settings, GET /run-tests
 */

const { Router } = require('express');
const { createLogger } = require('../../core/logger');

const logger = createLogger('adminRoutes');

/**
 * @param {{ maliciousUserManager: Object, requireOwnerToken: Function }} deps
 */
function createRouter(deps) {
  const { maliciousUserManager, requireOwnerToken } = deps;
  const router = Router();
  let maliciousUserManagerInitialized = false;

  // GET /blocked-users
  router.get('/blocked-users', async (req, res) => {
    try {
      if (!maliciousUserManagerInitialized) {
        await maliciousUserManager.init();
        maliciousUserManagerInitialized = true;
      }
      const blockedUserIds = maliciousUserManager.getBlockedUsers();
      const blockedUsersData = blockedUserIds.map(userId => ({
        userId,
        ...maliciousUserManager.getUserStats(userId),
        blockedAt: new Date().toISOString(),
      }));
      res.json({
        success: true,
        count: blockedUsersData.length,
        users: blockedUsersData,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Error getting blocked users');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /unblock-user
  router.post('/unblock-user', requireOwnerToken, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

    try {
      const wasUnblocked = await maliciousUserManager.unblockUser(userId);
      if (wasUnblocked) {
        return res.json({ success: true, message: `User ${userId} has been unblocked` });
      }
      return res.status(404).json({ success: false, error: 'User was not blocked' });
    } catch (error) {
      logger.error({ error, userId }, 'Error unblocking user');
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /settings — builds response from CONFIG_SCHEMA, omitting sensitive fields
  router.get('/settings', async (req, res) => {
    try {
      const config = require('../../core/configValidator');
      const { CONFIG_SCHEMA } = config;

      // Keys that contain secrets and must never be exposed
      const SENSITIVE_KEYS = new Set([
        'DISCORD_TOKEN',
        'OPENAI_API_KEY',
        'X_RAPIDAPI_KEY',
        'SERPAPI_API_KEY',
        'BRAVE_SEARCH_API_KEY',
        'WOLFRAM_APP_ID',
        'TELNYX_API_KEY',
        'OWNER_ID',
      ]);

      const settings = [];

      for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
        if (SENSITIVE_KEYS.has(key)) continue;
        const value = config[key];
        const isSet = value !== undefined && value !== '' && value !== schema.default;
        const displayValue = SENSITIVE_KEYS.has(key)
          ? '••••••••'
          : Array.isArray(value)
            ? value.join(', ')
            : String(value ?? '');

        settings.push({
          key,
          description: schema.description,
          required: schema.required ?? false,
          isSet,
          displayValue,
        });
      }

      // Append non-schema runtime values
      settings.push({
        key: 'NODE_ENV',
        description: 'Node environment',
        required: false,
        isSet: !!process.env.NODE_ENV,
        displayValue: process.env.NODE_ENV || '',
      });

      const summary = {
        total: settings.length,
        required: settings.filter(s => s.required).length,
        set: settings.filter(s => s.isSet).length,
        valid: settings.filter(s => !s.required || s.isSet).length,
      };

      res.json({ success: true, settings, summary, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error({ error }, 'Error getting settings');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /run-tests
  router.get('/run-tests', async (req, res) => {
    try {
      const { runDiagnostics } = require('../../utils/diagnostics');
      const results = await runDiagnostics();
      res.json({ success: true, results, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error({ error }, 'Error running tests');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = { createRouter };
