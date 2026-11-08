/**
 * Compatibility shim for the former standalone owner-token helper.
 *
 * The single production authorization boundary is ./middleware/ownerAuth (header-only
 * X-Owner-Token, strong-token requirement, 503/401/403 fail-closed semantics). This module
 * re-exports that middleware so no weaker parallel implementation remains.
 */

const crypto = require('crypto');
const { requireOwnerToken, validateOwnerTokenConfig } = require('./middleware/ownerAuth');

// There is intentionally no default token. Returns the configured token only when it passes
// the shared strength checks, otherwise null.
function getConfiguredOwnerToken() {
  const config = validateOwnerTokenConfig(process.env.OWNER_TOKEN);
  return config.valid ? config.token : null;
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

module.exports = { getConfiguredOwnerToken, constantTimeStringEquals, requireOwnerToken };
