/**
 * Shared image download utility with timeout protection.
 *
 * Used by SimpleChimpGPTFlow, InteractionEventHandler, and
 * any future code that needs to download an image from a URL.
 *
 * @module imageDownloader
 */

const https = require('https');
const http = require('http');

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Download an image from a URL and return a Buffer.
 *
 * @param {string} url - HTTP(S) URL to download from
 * @param {Object} [options]
 * @param {number} [options.timeout=30000] - Request timeout in ms
 * @param {number} [options.maxSize=10485760] - Max response body size in bytes (10 MB)
 * @returns {Promise<Buffer>}
 */
function downloadImage(url, { timeout = DEFAULT_TIMEOUT_MS, maxSize = DEFAULT_MAX_SIZE } = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    let size = 0;
    const chunks = [];

    const request = client.get(url, response => {
      if (response.statusCode !== 200) {
        response.resume(); // Drain the response to free the socket
        reject(new Error(`Failed to download image: HTTP ${response.statusCode}`));
        return;
      }

      // Enforce max size via Content-Length header (when available)
      const contentLength = parseInt(response.headers['content-length'], 10);
      if (!isNaN(contentLength) && contentLength > maxSize) {
        response.resume();
        reject(new Error(`Image too large: ${contentLength} bytes exceeds ${maxSize} byte limit`));
        return;
      }

      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxSize) {
          request.destroy(new Error(`Image exceeded ${maxSize} byte limit during download`));
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        if (size <= maxSize) {
          resolve(Buffer.concat(chunks));
        }
      });
    });

    request.on('error', reject);

    request.setTimeout(timeout, () => {
      request.destroy(new Error(`Image download timed out after ${timeout}ms`));
    });
  });
}

module.exports = { downloadImage };
