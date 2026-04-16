/**
 * Recursively sanitizes an object by truncating strings that exceed a
 * maximum length.  Used to prevent large payloads (e.g. base64-encoded
 * images) from ballooning persisted JSON files.
 *
 * @param {*} obj - Value to sanitize (string, array, object, or primitive)
 * @param {number} [maxLength=10000] - Maximum string length before truncation
 * @returns {*} Sanitized copy with long strings truncated
 */
function sanitizeEntry(obj, maxLength = 10000) {
  if (typeof obj === 'string') {
    if (obj.length > maxLength) {
      return obj.substring(0, maxLength) + `...[truncated ${obj.length - maxLength} chars]`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeEntry(item, maxLength));
  }
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const key of Object.keys(obj)) {
      sanitized[key] = sanitizeEntry(obj[key], maxLength);
    }
    return sanitized;
  }
  return obj;
}

module.exports = { sanitizeEntry };
