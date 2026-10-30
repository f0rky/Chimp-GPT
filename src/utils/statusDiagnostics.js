const http = require('node:http');
const https = require('node:https');
const { createLogger } = require('../core/logger');
const logger = createLogger('statusDiagnostics');

function diagnosticTarget(baseUrl) {
  const target = new URL(baseUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && loopback)) {
    throw new Error('Diagnostics require HTTPS except on loopback interfaces');
  }
  if (target.username || target.password) {
    throw new Error('Diagnostic URLs must not contain credentials');
  }
  return target;
}

function requestApi(target, headers = {}) {
  const requester = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = requester.request(new URL('/api', target), { method: 'GET', headers }, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, data }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('Diagnostic request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function corsSucceeded(testCase, result) {
  if (!testCase.headers.Origin) return result.statusCode === 200;
  const origin = result.headers['access-control-allow-origin'];
  const matches = origin === testCase.headers.Origin || origin === '*';
  return testCase.expectedResult
    ? result.statusCode === 200 && matches
    : result.statusCode !== 200 || !matches;
}

async function testCorsCase(target, testCase) {
  try {
    const result = await requestApi(target, testCase.headers);
    return {
      name: testCase.name,
      success: corsSucceeded(testCase, result),
      statusCode: result.statusCode,
      corsHeaders: {
        'access-control-allow-origin': result.headers['access-control-allow-origin'],
        'access-control-allow-methods': result.headers['access-control-allow-methods'],
        'access-control-allow-credentials': result.headers['access-control-allow-credentials'],
      },
    };
  } catch (error) {
    return { name: testCase.name, success: false, error: error.message };
  }
}

/** Check CORS on the status server; remote diagnostic targets must use HTTPS. */
async function runCorsTests(baseUrl = 'http://localhost:3000') {
  try {
    const target = diagnosticTarget(baseUrl);
    logger.info({ baseUrl }, 'Running CORS configuration tests');
    const testCases = [
      { name: 'No Origin', headers: {}, expectedResult: true },
      {
        name: 'Allowed Origin (localhost)',
        headers: { Origin: 'http://localhost' },
        expectedResult: true,
      },
      {
        name: 'Allowed Origin (127.0.0.1)',
        headers: { Origin: 'http://127.0.0.1' },
        expectedResult: true,
      },
      {
        name: 'Disallowed Origin',
        headers: { Origin: 'https://evil-site.com' },
        expectedResult: false,
      },
    ];
    if (!['localhost', '127.0.0.1'].includes(target.hostname)) {
      testCases.push({
        name: `Allowed Origin (${target.hostname})`,
        headers: { Origin: target.origin.replace(/:\d+$/, '') },
        expectedResult: true,
      });
    }
    const results = await Promise.all(testCases.map(testCase => testCorsCase(target, testCase)));
    return { success: results.every(result => result.success), details: results };
  } catch (error) {
    logger.error({ error }, 'Error running CORS tests');
    return { success: false, error: error.message };
  }
}

async function testSingleRequest(target) {
  try {
    const result = await requestApi(target);
    return {
      name: 'Single Request',
      success: result.statusCode === 200,
      statusCode: result.statusCode,
    };
  } catch (error) {
    return { name: 'Single Request', success: false, error: error.message };
  }
}

async function testMultipleRequests(target) {
  if (process.env.NODE_ENV !== 'development') {
    return {
      name: 'Multiple Requests',
      success: true,
      skipped: true,
      message: 'Skipped in production environment',
    };
  }
  const results = await Promise.all(
    Array.from({ length: 5 }, () => requestApi(target).catch(error => ({ error: error.message })))
  );
  const successCount = results.filter(result => result.statusCode === 200).length;
  return {
    name: 'Multiple Requests',
    success: successCount === results.length,
    requestCount: results.length,
    successCount,
  };
}

/** Verify basic access and, in development only, a five-request burst. */
async function runRateLimiterTests(baseUrl = 'http://localhost:3000') {
  try {
    const target = diagnosticTarget(baseUrl);
    logger.info({ baseUrl }, 'Running rate limiter tests');
    const single = await testSingleRequest(target);
    const multiple = await testMultipleRequests(target);
    const results = [single, multiple];
    return { success: results.every(result => result.success), details: results };
  } catch (error) {
    logger.error({ error }, 'Error running rate limiter tests');
    return { success: false, error: error.message };
  }
}

module.exports = { runCorsTests, runRateLimiterTests };
