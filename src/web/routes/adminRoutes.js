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

  // GET /settings — delegates to original statusServer logic (kept inline, not duplicated)
  // This route is complex (rebuilds CONFIG_SCHEMA inline) — kept as a passthrough stub
  // TODO: extract CONFIG_SCHEMA to a shared module so settings can be served cleanly
  router.get('/settings', async (req, res) => {
    try {
      // Re-require fresh config for settings display
      const config = require('../../core/configValidator');
      const safeSettings = {
        BOT_NAME: config.BOT_NAME,
        NODE_ENV: process.env.NODE_ENV,
        ENABLE_REPLY_CONTEXT: config.ENABLE_REPLY_CONTEXT,
        MAX_MESSAGES_PER_USER_BLENDED: config.MAX_MESSAGES_PER_USER_BLENDED,
        LOG_LEVEL: config.LOG_LEVEL,
        conversationMode: 'PocketFlow (Graph-based Architecture)',
      };
      res.json({ success: true, settings: safeSettings, timestamp: new Date().toISOString() });
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
