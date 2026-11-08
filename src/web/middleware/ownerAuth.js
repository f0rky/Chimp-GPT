/**
 * Dashboard owner authentication middleware.
 *
 * - Credentials are accepted only via the X-Owner-Token header (never query or body).
 * - OWNER_TOKEN is read at request time and must be at least 32 characters and not a
 *   placeholder; otherwise protected routes fail closed with 503.
 * - The acting owner is resolved server-side from OWNER_ID; callers cannot choose it.
 */

const crypto = require('crypto');
const { createLogger } = require('../../core/logger');

const logger = createLogger('ownerAuth');

const MIN_OWNER_TOKEN_LENGTH = 32;
const OWNER_TOKEN_HEADER = 'x-owner-token';
const PLACEHOLDER_PATTERN =
  /change[-_]?me|placeholder|your[-_]|example|replace[-_]?me|goes[-_]?here/i;
const OWNER_ID_PATTERN = /^\d+$/;

/**
 * Validate the configured dashboard owner token.
 * @param {string|undefined} value
 * @returns {{ valid: boolean, token?: string, reason?: string }}
 */
function validateOwnerTokenConfig(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token) return { valid: false, reason: 'OWNER_TOKEN is not set' };
  if (token.length < MIN_OWNER_TOKEN_LENGTH) {
    return {
      valid: false,
      reason: `OWNER_TOKEN must be at least ${MIN_OWNER_TOKEN_LENGTH} characters`,
    };
  }
  if (PLACEHOLDER_PATTERN.test(token) || new Set(token).size < 8) {
    return { valid: false, reason: 'OWNER_TOKEN looks like a placeholder value' };
  }
  return { valid: true, token };
}

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function tokensMatch(presented, expected) {
  return crypto.timingSafeEqual(digest(presented), digest(expected));
}

function requestContext(req) {
  return { method: req.method, path: req.path, ip: req.ip };
}

/**
 * Require a valid X-Owner-Token header. Never logs or echoes token values.
 */
function requireOwnerToken(req, res, next) {
  const config = validateOwnerTokenConfig(process.env.OWNER_TOKEN);
  if (!config.valid) {
    logger.warn(
      { ...requestContext(req), reason: config.reason },
      'Owner-protected route unavailable: dashboard owner token not configured'
    );
    return res.status(503).json({
      error: 'Dashboard owner authentication is not configured on the server',
      code: 'OWNER_AUTH_NOT_CONFIGURED',
      hint: `Set OWNER_TOKEN (at least ${MIN_OWNER_TOKEN_LENGTH} random characters) and restart`,
    });
  }

  const presented = req.get(OWNER_TOKEN_HEADER);
  if (typeof presented !== 'string' || presented.length === 0) {
    return res.status(401).json({
      error: 'Owner token required in the X-Owner-Token header',
      code: 'OWNER_TOKEN_REQUIRED',
    });
  }

  if (!tokensMatch(presented, config.token)) {
    logger.warn(requestContext(req), 'Rejected invalid dashboard owner token');
    return res.status(403).json({ error: 'Invalid owner token', code: 'OWNER_TOKEN_INVALID' });
  }

  return next();
}

/**
 * Resolve the acting owner from server configuration into res.locals.ownerId.
 * Must run after requireOwnerToken. Fails closed when OWNER_ID is missing or invalid.
 */
function requireOwnerIdentity(req, res, next) {
  const ownerId = typeof process.env.OWNER_ID === 'string' ? process.env.OWNER_ID.trim() : '';
  if (!OWNER_ID_PATTERN.test(ownerId)) {
    logger.warn(requestContext(req), 'Owner-protected route unavailable: OWNER_ID not configured');
    return res.status(503).json({
      error: 'Owner identity is not configured on the server',
      code: 'OWNER_ID_NOT_CONFIGURED',
      hint: 'Set OWNER_ID to the Discord user ID of the bot owner and restart',
    });
  }
  res.locals.ownerId = ownerId;
  return next();
}

module.exports = {
  MIN_OWNER_TOKEN_LENGTH,
  validateOwnerTokenConfig,
  requireOwnerToken,
  requireOwnerIdentity,
};
