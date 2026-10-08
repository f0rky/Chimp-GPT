const crypto = require('crypto');
const { createLogger } = require('../core/logger');

const logger = createLogger('ownerTokenAuth');

// There is intentionally no default token. Owner-only routes deny all
// requests until a token is explicitly configured.
function getConfiguredOwnerToken() {
  const value = process.env.OWNER_TOKEN;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function constantTimeStringEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireOwnerToken(req, res, next) {
  const configuredToken = getConfiguredOwnerToken();
  if (!configuredToken) {
    logger.error('OWNER_TOKEN is not configured; denying owner-protected request (fail closed)');
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!constantTimeStringEquals(req.headers['x-owner-token'], configuredToken)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

module.exports = { getConfiguredOwnerToken, constantTimeStringEquals, requireOwnerToken };
