/**
 * Deleted Messages Routes
 * GET /api/deleted-messages/auth, /api/deleted-messages
 * POST /api/deleted-messages/status
 * GET /deleted-messages, /admin/deleted-messages
 */

const { Router } = require('express');
const path = require('path');
const { createLogger } = require('../../core/logger');
const { getSafeErrorDetails } = require('../../core/errors');
const { requireOwnerToken, requireOwnerIdentity } = require('../middleware/ownerAuth');

const logger = createLogger('deletedMessagesRoutes');

// Owner token is required and the acting owner comes from server config (res.locals.ownerId).
// There is no x-user-id/OWNER_ID fallback authorization.
const requireOwner = [requireOwnerToken, requireOwnerIdentity];

/**
 * @param {{ maliciousUserManager: Object }} deps
 */
function createRouter(deps) {
  const { maliciousUserManager } = deps;
  const router = Router();

  // GET /api/deleted-messages/auth
  router.get('/api/deleted-messages/auth', requireOwner, (req, res) => {
    res.json({ authenticated: true, timestamp: new Date().toISOString() });
  });

  // GET /api/deleted-messages
  router.get('/api/deleted-messages', requireOwner, (req, res) => {
    try {
      const userId = res.locals.ownerId;

      const filters = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.userId) filters.userId = req.query.userId;
      if (req.query.channelId) filters.channelId = req.query.channelId;
      if (req.query.isRapidDeletion) filters.isRapidDeletion = req.query.isRapidDeletion === 'true';
      if (req.query.startDate) filters.startDate = parseInt(req.query.startDate, 10);
      if (req.query.endDate) filters.endDate = parseInt(req.query.endDate, 10);

      const messages = maliciousUserManager.getDeletedMessagesForWebUI(userId, filters);
      const deletedStats = {
        total: messages.length,
        pending: messages.filter(m => m.status === 'pending_review').length,
        approved: messages.filter(m => m.status === 'approved').length,
        flagged: messages.filter(m => m.status === 'flagged').length,
        ignored: messages.filter(m => m.status === 'ignored').length,
        rapid: messages.filter(m => m.isRapidDeletion).length,
      };

      return res.json({
        success: true,
        messages,
        stats: deletedStats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching deleted messages');
      return res.status(500).json({ error: error.message || 'Failed to fetch deleted messages' });
    }
  });

  // POST /api/deleted-messages/status
  router.post(
    '/api/deleted-messages/status',
    requireOwner,
    // body already parsed by global express.json() middleware
    async (req, res) => {
      try {
        const userId = res.locals.ownerId;
        const { messageId, status, notes = '' } = req.body || {};
        if (!messageId || !status) {
          return res.status(400).json({ error: 'messageId and status are required' });
        }

        const updatedMessage = await maliciousUserManager.updateDeletedMessageStatus(
          userId,
          messageId,
          status,
          notes
        );
        return res.json({
          success: true,
          message: updatedMessage,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Error updating deleted message status');
        const errorDetails = getSafeErrorDetails(error);
        return res.status(errorDetails.statusCode || 500).json({
          error: errorDetails.message,
          timestamp: errorDetails.timestamp,
          ...(errorDetails.context && { context: errorDetails.context }),
        });
      }
    }
  );

  // Serve deleted messages UI
  router.get('/deleted-messages', (req, res) => {
    res.sendFile(path.join(__dirname, '../components', 'deletedMessages.html'));
  });

  router.get('/admin/deleted-messages', (req, res) => {
    res.redirect('/deleted-messages');
  });

  return router;
}

module.exports = { createRouter };
