'use strict';

/**
 * Dedicated fetch for the OpenAI SDK.
 *
 * Why this exists:
 * - The OpenAI SDK's bundled node-fetch fails on this runtime with
 *   ERR_STREAM_PREMATURE_CLOSE, so we must supply our own fetch.
 * - We can't simply use globalThis.fetch: loading discord.js installs a global
 *   undici dispatcher (Agent). Node's native fetch and the npm `undici` package
 *   share the same global dispatcher symbol, so discord.js's Agent hijacks the
 *   dispatcher native fetch uses. That Agent works for the Discord API but fails
 *   for api.openai.com ("fetch failed" / "Connection error").
 *
 * The fix: route OpenAI requests through a dedicated undici dispatcher that is
 * independent of the hijacked global one.
 */

const { Agent, fetch: undiciFetch } = require('undici');

// Generous timeouts: image generation responses can take 30s+.
const openaiDispatcher = new Agent({
  connect: { timeout: 30_000 },
  headersTimeout: 120_000,
  bodyTimeout: 300_000,
});

/**
 * fetch implementation bound to the dedicated dispatcher.
 * Signature matches what the OpenAI SDK expects (url, init).
 */
function openaiFetch(url, options = {}) {
  return undiciFetch(url, { ...options, dispatcher: openaiDispatcher });
}

module.exports = { openaiFetch, openaiDispatcher };
