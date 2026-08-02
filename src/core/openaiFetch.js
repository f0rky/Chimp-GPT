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

/**
 * Build a fetch bound to its own undici dispatcher.
 *
 * headersTimeout caps the wait for the first response byte. These responses are
 * not streamed, so headers only arrive once the model has finished - it is an
 * end-to-end ceiling on the call, independent of any timeout the OpenAI SDK
 * applies. Callers that legitimately run long (image generation) need their own
 * dispatcher rather than a raised shared limit, so a hung chat completion still
 * fails fast.
 *
 * @param {Object} [options] - Dispatcher timeouts in milliseconds
 * @param {number} [options.headersTimeout] - Max wait for response headers
 * @param {number} [options.bodyTimeout] - Max wait for the response body
 * @param {number} [options.connectTimeout] - Max wait for the TCP/TLS connect
 * @returns {{ fetch: Function, dispatcher: import('undici').Agent }}
 */
function createOpenAIFetch({
  headersTimeout = 120_000,
  bodyTimeout = 300_000,
  connectTimeout = 30_000,
} = {}) {
  const dispatcher = new Agent({
    connect: { timeout: connectTimeout },
    headersTimeout,
    bodyTimeout,
  });

  return {
    fetch: (url, options = {}) => undiciFetch(url, { ...options, dispatcher }),
    dispatcher,
  };
}

// Shared default for chat, weather and Quake lookups: these should fail fast.
const { fetch: openaiFetch, dispatcher: openaiDispatcher } = createOpenAIFetch();

module.exports = { openaiFetch, openaiDispatcher, createOpenAIFetch };
