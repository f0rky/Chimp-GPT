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

const logger = createLogger('deletedMessagesRoutes');

/**
 * @param {{ maliciousUserManager: Object, requireOwnerToken: Function }} deps
 */
function createRouter(deps) {
  const { maliciousUserManager, requireOwnerToken } = deps;
  const router = Router();

  // GET /api/deleted-messages/auth
  // Authorization is enforced solely by requireOwnerToken (X-Owner-Token
  // header). There is no x-user-id/OWNER_ID fallback here.
  router.get('/api/deleted-messages/auth', requireOwnerToken, (req, res) => {
    return res.json({ authenticated: true, timestamp: new Date().toISOString() });
  });

  // GET /api/deleted-messages
  router.get('/api/deleted-messages', requireOwnerToken, (req, res) => {
    try {
      const filters = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.userId) filters.userId = req.query.userId;
      if (req.query.channelId) filters.channelId = req.query.channelId;
      if (req.query.isRapidDeletion) filters.isRapidDeletion = req.query.isRapidDeletion === 'true';
      if (req.query.startDate) filters.startDate = parseInt(req.query.startDate, 10);
      if (req.query.endDate) filters.endDate = parseInt(req.query.endDate, 10);

      // The request has already been authorized by requireOwnerToken above.
      // maliciousUserManager still internally gates on OWNER_ID matching, so
      // we pass OWNER_ID through as the identity for that internal check —
      // it is not used as the access-control decision for this endpoint.
      const ownerUserId = process.env.OWNER_ID;
      const messages = maliciousUserManager.getDeletedMessagesForWebUI(ownerUserId, filters);
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
    requireOwnerToken,
    (req, res, next) => {
      // body already parsed by global express.json() middleware
      next();
    },
    async (req, res) => {
      try {
        const { messageId, status, notes = '' } = req.body;
        if (!messageId || !status) {
          return res.status(400).json({ error: 'messageId and status are required' });
        }

        const ownerUserId = process.env.OWNER_ID;
        const updatedMessage = await maliciousUserManager.updateDeletedMessageStatus(
          ownerUserId,
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
