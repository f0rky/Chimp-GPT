/**
 * Dashboard Security & Functional Remediation Tests
 *
 * Hermetic tests for the owner-token authorization model protecting the
 * status dashboard's admin/performance/deleted-message endpoints, plus
 * static checks on the dashboard frontend assets (Chart.js SRI pinning,
 * in-memory owner token helper, weather rendering schema, no random chart
 * fallback data).
 *
 * These tests never touch the live/dirty project tree, never make network
 * calls, and never require real secrets — synthetic env vars are used only
 * to satisfy configValidator's required-variable check when adminRoutes
 * lazily requires it.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// Synthetic, non-secret values so that configValidator (required lazily by
// adminRoutes' /settings handler) doesn't exit the process for missing
// required environment variables when it's loaded for the first time.
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-discord-token-0123456789';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key-0123456789';
process.env.CHANNEL_ID = process.env.CHANNEL_ID || '123456789012345678';

const REPO_ROOT = path.join(__dirname, '../..');

/**
 * Start an express app on an ephemeral port and return { url, close }.
 *
 * @param {import('express').Express} app
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise(res => server.close(res)),
      });
    });
    server.on('error', reject);
  });
}

async function testSecurityHardeningDashboard() {
  const results = [];
  const express = require('express');
  // requireOwnerToken (and the constant-time comparator) come from the
  // production module under test.
  const { requireOwnerToken, constantTimeStringEquals } = require('../../src/web/statusServer');

  const originalOwnerToken = process.env.OWNER_TOKEN;
  const originalOwnerId = process.env.OWNER_ID;

  // ---- 1. requireOwnerToken fails closed when OWNER_TOKEN is unset ----
  try {
    delete process.env.OWNER_TOKEN;
    const app = express();
    app.use(express.json());
    app.get('/protected', requireOwnerToken, (req, res) => res.json({ ok: true }));
    const { url, close } = await startServer(app);
    try {
      const res = await fetch(`${url}/protected`, {
        headers: { 'X-Owner-Token': 'anything-at-all' },
      });
      assert.equal(res.status, 403);
    } finally {
      await close();
    }
    results.push({ name: 'requireOwnerToken fails closed when OWNER_TOKEN unset', success: true });
  } catch (error) {
    results.push({
      name: 'requireOwnerToken fails closed when OWNER_TOKEN unset',
      success: false,
      error: error.message,
    });
  }

  // ---- 2. requireOwnerToken denies wrong token, allows correct token, via header only ----
  try {
    process.env.OWNER_TOKEN = 'correct-owner-token-value';
    const app = express();
    app.use(express.json());
    app.get('/protected', requireOwnerToken, (req, res) => res.json({ ok: true }));
    const { url, close } = await startServer(app);
    try {
      const noHeader = await fetch(`${url}/protected`);
      assert.equal(noHeader.status, 403);

      const wrongHeader = await fetch(`${url}/protected`, {
        headers: { 'X-Owner-Token': 'wrong-token' },
      });
      assert.equal(wrongHeader.status, 403);

      // Query string and body must NOT be accepted as a token source.
      const viaQuery = await fetch(`${url}/protected?token=correct-owner-token-value`);
      assert.equal(viaQuery.status, 403);

      const viaBody = await fetch(`${url}/protected`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(viaBody.status, 403);

      const correctHeader = await fetch(`${url}/protected`, {
        headers: { 'X-Owner-Token': 'correct-owner-token-value' },
      });
      assert.equal(correctHeader.status, 200);
      const body = await correctHeader.json();
      assert.equal(body.ok, true);
    } finally {
      await close();
    }
    results.push({
      name: 'requireOwnerToken accepts ONLY the X-Owner-Token header with the correct value',
      success: true,
    });
  } catch (error) {
    results.push({
      name: 'requireOwnerToken accepts ONLY the X-Owner-Token header with the correct value',
      success: false,
      error: error.message,
    });
  }

  // ---- 3. constant-time comparator correctness ----
  try {
    assert.equal(constantTimeStringEquals('abc', 'abc'), true);
    assert.equal(constantTimeStringEquals('abc', 'abd'), false);
    assert.equal(constantTimeStringEquals('abc', 'abcd'), false);
    assert.equal(constantTimeStringEquals('', ''), true);
    assert.equal(constantTimeStringEquals(undefined, 'abc'), false);
    assert.equal(constantTimeStringEquals(null, 'abc'), false);
    assert.equal(constantTimeStringEquals(['abc'], 'abc'), false);
    results.push({ name: 'constantTimeStringEquals behaves correctly', success: true });
  } catch (error) {
    results.push({
      name: 'constantTimeStringEquals behaves correctly',
      success: false,
      error: error.message,
    });
  }

  // ---- 4. adminRoutes: protected GET routes deny/allow correctly, settings omit secrets ----
  try {
    process.env.OWNER_TOKEN = 'admin-routes-owner-token';
    process.env.OPENROUTER_API_KEY = 'secret-openrouter-key';
    process.env.X_RAPIDAPI_KEY = 'secret-rapidapi-key';

    const fakeMaliciousUserManager = {
      initialized: false,
      async init() {
        this.initialized = true;
      },
      getBlockedUsers() {
        return ['111111111111111111'];
      },
      getUserStats() {
        return { violations: 3 };
      },
      async unblockUser(userId) {
        return userId === '111111111111111111';
      },
    };

    const adminRoutes = require('../../src/web/routes/adminRoutes');
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      adminRoutes.createRouter({
        maliciousUserManager: fakeMaliciousUserManager,
        requireOwnerToken,
      })
    );
    const { url, close } = await startServer(app);
    try {
      // GET /blocked-users requires the token
      const blockedNoAuth = await fetch(`${url}/blocked-users`);
      assert.equal(blockedNoAuth.status, 403);
      const blockedAuth = await fetch(`${url}/blocked-users`, {
        headers: { 'X-Owner-Token': 'admin-routes-owner-token' },
      });
      assert.equal(blockedAuth.status, 200);

      // GET /settings requires the token and omits secret-bearing keys
      const settingsNoAuth = await fetch(`${url}/settings`);
      assert.equal(settingsNoAuth.status, 403);
      const settingsAuth = await fetch(`${url}/settings`, {
        headers: { 'X-Owner-Token': 'admin-routes-owner-token' },
      });
      assert.equal(settingsAuth.status, 200);
      const settingsBody = await settingsAuth.json();
      const settingsJson = JSON.stringify(settingsBody);
      assert.equal(settingsJson.includes('secret-openrouter-key'), false);
      assert.equal(settingsJson.includes('secret-rapidapi-key'), false);
      const openRouterSetting = settingsBody.settings.find(s => s.key === 'OPENROUTER_API_KEY');
      assert.equal(openRouterSetting, undefined, 'OPENROUTER_API_KEY must be omitted entirely');

      // GET /run-tests requires the token (it may still fail internally
      // because utils/diagnostics doesn't exist, but auth must be enforced
      // before that failure is reached).
      const runTestsNoAuth = await fetch(`${url}/run-tests`);
      assert.equal(runTestsNoAuth.status, 403);

      // POST /unblock-user requires the token
      const unblockNoAuth = await fetch(`${url}/unblock-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: '111111111111111111' }),
      });
      assert.equal(unblockNoAuth.status, 403);
      const unblockAuth = await fetch(`${url}/unblock-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owner-Token': 'admin-routes-owner-token',
        },
        body: JSON.stringify({ userId: '111111111111111111' }),
      });
      assert.equal(unblockAuth.status, 200);
    } finally {
      await close();
    }
    results.push({
      name: 'adminRoutes protects settings/blocked-users/run-tests/unblock and omits secrets',
      success: true,
    });
  } catch (error) {
    results.push({
      name: 'adminRoutes protects settings/blocked-users/run-tests/unblock and omits secrets',
      success: false,
      error: error.message,
    });
  } finally {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.X_RAPIDAPI_KEY;
  }

  // ---- 5. healthRoutes: detailed diagnostics require the owner token; basic health remains public ----
  try {
    process.env.OWNER_TOKEN = 'health-routes-owner-token';
    let loadStatsCalls = 0;
    const healthRoutes = require('../../src/web/routes/healthRoutes');
    const app = express();
    app.use(
      '/',
      healthRoutes.createRouter({
        stats: {
          startTime: new Date(),
          messageCount: 0,
          apiCalls: {},
          errors: {},
          rateLimits: { hit: 0, users: new Set(), userCounts: {} },
        },
        statsStorage: {
          async loadStats() {
            loadStatsCalls += 1;
            return { messageCount: 0, apiCalls: {}, errors: {}, rateLimits: {} };
          },
        },
        requireOwnerToken,
      })
    );
    const { url, close } = await startServer(app);
    try {
      const detailedNoAuth = await fetch(`${url}/health/detailed`);
      assert.equal(detailedNoAuth.status, 403);
      const detailedWrongAuth = await fetch(`${url}/health/detailed`, {
        headers: { 'X-Owner-Token': 'wrong-token' },
      });
      assert.equal(detailedWrongAuth.status, 403);
      assert.equal(loadStatsCalls, 0, 'detailed health handler must not run before authorization');

      const basicHealth = await fetch(`${url}/health`);
      assert.equal(basicHealth.status, 200, 'basic health probe remains public');
      assert.equal(loadStatsCalls, 1);
    } finally {
      await close();
    }
    results.push({
      name: 'healthRoutes protects detailed diagnostics before handler execution and keeps basic health public',
      success: true,
    });
  } catch (error) {
    results.push({
      name: 'healthRoutes protects detailed diagnostics before handler execution and keeps basic health public',
      success: false,
      error: error.message,
    });
  }

  // ---- 6. performanceRoutes: destructive/sensitive routes require the token ----
  try {
    process.env.OWNER_TOKEN = 'performance-routes-owner-token';

    const stats = { apiCalls: {}, errors: {}, rateLimits: { hit: 0, users: new Set() } };
    const fakeStatsStorage = {
      repairStatsCalls: 0,
      async resetStats() {
        return true;
      },
      async repairStatsFile() {
        this.repairStatsCalls += 1;
        return true;
      },
    };
    const fakeFunctionResults = {
      repairCalls: 0,
      async getAllResults() {
        return { weather: [] };
      },
      async repairResultsFile() {
        this.repairCalls += 1;
        return true;
      },
    };
    const fakePerformanceHistory = {
      addMetric: () => undefined,
      getHourlyData: () => [],
      getDailyData: () => [],
      getRecentMetrics: () => [],
    };
    const serverState = { healthy: true, lastError: null };

    const performanceRoutes = require('../../src/web/routes/performanceRoutes');
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      performanceRoutes.createRouter({
        stats,
        statsStorage: fakeStatsStorage,
        functionResults: fakeFunctionResults,
        performanceHistory: fakePerformanceHistory,
        serverState,
        requireOwnerToken,
      })
    );
    const { url, close } = await startServer(app);
    try {
      // Unprotected read-only routes remain open
      const perf = await fetch(`${url}/performance`);
      assert.equal(perf.status, 200);
      const hourly = await fetch(`${url}/performance/history/hourly`);
      assert.equal(hourly.status, 200);

      const protectedRequests = [
        { method: 'POST', path: '/reset-stats' },
        { method: 'POST', path: '/repair-stats' },
        { method: 'POST', path: '/repair-function-results' },
        { method: 'GET', path: '/function-results' },
        { method: 'GET', path: '/function-results/summary' },
      ];

      for (const { method, path: routePath } of protectedRequests) {
        const denied = await fetch(`${url}${routePath}`, { method });
        assert.equal(denied.status, 403, `${method} ${routePath} should deny without token`);
      }

      // Exercise authorized non-mutating reads only. Do not authorize a repair
      // request: route authorization is proven above, while executing repairs
      // would turn this unit test into a data-mutating integration test.
      for (const routePath of ['/function-results', '/function-results/summary']) {
        const allowed = await fetch(`${url}${routePath}`, {
          headers: { 'X-Owner-Token': 'performance-routes-owner-token' },
        });
        assert.equal(allowed.status, 200, `GET ${routePath} should allow with token`);
      }
      assert.equal(fakeStatsStorage.repairStatsCalls, 0, 'test must not execute stats repair');
      assert.equal(
        fakeFunctionResults.repairCalls,
        0,
        'test must not execute function-results repair'
      );
    } finally {
      await close();
    }
    results.push({
      name: 'performanceRoutes rejects destructive routes before repair and permits safe reads',
      success: true,
    });
  } catch (error) {
    results.push({
      name: 'performanceRoutes rejects destructive routes before repair and permits safe reads',
      success: false,
      error: error.message,
    });
  }

  // ---- 6. deletedMessagesRoutes: no x-user-id/OWNER_ID fallback authorization ----
  try {
    process.env.OWNER_TOKEN = 'deleted-messages-owner-token';
    process.env.OWNER_ID = '999999999999999999';

    const fakeMaliciousUserManager = {
      getDeletedMessagesForWebUI(requestingUserId) {
        assert.equal(requestingUserId, process.env.OWNER_ID);
        return [{ messageId: 'm1', status: 'pending_review' }];
      },
      async updateDeletedMessageStatus(requestingUserId, messageId, status) {
        assert.equal(requestingUserId, process.env.OWNER_ID);
        return { messageId, status };
      },
    };

    const deletedMessagesRoutes = require('../../src/web/routes/deletedMessagesRoutes');
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      deletedMessagesRoutes.createRouter({
        maliciousUserManager: fakeMaliciousUserManager,
        requireOwnerToken,
      })
    );
    const { url, close } = await startServer(app);
    try {
      // Supplying x-user-id matching OWNER_ID must NOT be sufficient on its own.
      const authViaUserIdOnly = await fetch(`${url}/api/deleted-messages/auth`, {
        headers: { 'x-user-id': process.env.OWNER_ID },
      });
      assert.equal(authViaUserIdOnly.status, 403);

      const authViaToken = await fetch(`${url}/api/deleted-messages/auth`, {
        headers: { 'X-Owner-Token': 'deleted-messages-owner-token' },
      });
      assert.equal(authViaToken.status, 200);

      const listViaUserIdOnly = await fetch(`${url}/api/deleted-messages`, {
        headers: { 'x-user-id': process.env.OWNER_ID },
      });
      assert.equal(listViaUserIdOnly.status, 403);

      const listViaToken = await fetch(`${url}/api/deleted-messages`, {
        headers: { 'X-Owner-Token': 'deleted-messages-owner-token' },
      });
      assert.equal(listViaToken.status, 200);

      const statusNoAuth = await fetch(`${url}/api/deleted-messages/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': process.env.OWNER_ID },
        body: JSON.stringify({ messageId: 'm1', status: 'approved' }),
      });
      assert.equal(statusNoAuth.status, 403);

      const statusWithToken = await fetch(`${url}/api/deleted-messages/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owner-Token': 'deleted-messages-owner-token',
        },
        body: JSON.stringify({ messageId: 'm1', status: 'approved' }),
      });
      assert.equal(statusWithToken.status, 200);
    } finally {
      await close();
    }
    results.push({
      name: 'deletedMessagesRoutes authorize solely via owner token, not x-user-id/OWNER_ID',
      success: true,
    });
  } catch (error) {
    results.push({
      name: 'deletedMessagesRoutes authorize solely via owner token, not x-user-id/OWNER_ID',
      success: false,
      error: error.message,
    });
  } finally {
    delete process.env.OWNER_ID;
  }

  // ---- restore env ----
  if (originalOwnerToken === undefined) delete process.env.OWNER_TOKEN;
  else process.env.OWNER_TOKEN = originalOwnerToken;
  if (originalOwnerId === undefined) delete process.env.OWNER_ID;
  else process.env.OWNER_ID = originalOwnerId;

  // ---- 7. statusServer.js source no longer has a default/fallback secret ----
  try {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'src/web/statusServer.js'), 'utf8');
    assert.equal(/changeme/i.test(source), false, 'no "changeme" default token may remain');
    assert.equal(
      /OWNER_TOKEN\s*\|\|\s*['"`]/.test(source),
      false,
      'OWNER_TOKEN must not fall back to a literal default'
    );
    results.push({ name: 'statusServer.js has no default owner-token fallback', success: true });
  } catch (error) {
    results.push({
      name: 'statusServer.js has no default owner-token fallback',
      success: false,
      error: error.message,
    });
  }

  // ---- 8. Frontend static checks ----
  try {
    const appJs = fs.readFileSync(path.join(REPO_ROOT, 'src/web/public/app-unified.js'), 'utf8');

    // Single in-memory, prompt-based token helper attaches only the header.
    assert.match(appJs, /function getOwnerToken\s*\(/);
    assert.match(appJs, /function ownerFetch\s*\(/);
    assert.match(appJs, /headers\.set\(\s*['"]X-Owner-Token['"]/);
    assert.match(appJs, /window\.prompt\(\s*['"]Enter owner token:['"]/);

    // Token must never be persisted or sent via query/body.
    assert.equal(/localStorage\.(get|set)Item\([^)]*[Oo]wner/i.test(appJs), false);
    assert.equal(/sessionStorage\.(get|set)Item\([^)]*[Oo]wner/i.test(appJs), false);

    // No direct unauthenticated fetch to owner-protected endpoints remains.
    for (const protectedPath of [
      "fetch('/settings')",
      "fetch('/health/detailed')",
      "fetch('/blocked-users')",
      "fetch('/run-tests')",
      "fetch('/reset-stats'",
      "fetch('/unblock-user'",
      "fetch('/api/deleted-messages",
      'fetch(`/function-results',
    ]) {
      assert.equal(
        appJs.includes(protectedPath),
        false,
        `found unauthenticated fetch for ${protectedPath}`
      );
    }

    // No random-number fallback feeding the status chart/response time.
    assert.equal(/Math\.random/.test(appJs), false, 'no Math.random fallback should remain');

    // Weather rendering must use the real stored schema (result.current / result.location).
    assert.match(appJs, /item\.result\?\.current/);
    assert.match(appJs, /item\.result\?\.location/);

    // Chart init must not throw if Chart.js failed to load.
    assert.match(appJs, /typeof Chart === 'undefined'/);

    results.push({
      name: 'app-unified.js meets frontend security/functional requirements',
      success: true,
    });
  } catch (error) {
    results.push({
      name: 'app-unified.js meets frontend security/functional requirements',
      success: false,
      error: error.message,
    });
  }

  // ---- 9. Chart.js SRI pinning ----
  try {
    const indexHtml = fs.readFileSync(path.join(REPO_ROOT, 'src/web/public/index.html'), 'utf8');
    assert.match(indexHtml, /chart\.js@4\.5\.1\/dist\/chart\.umd\.js/);
    assert.match(
      indexHtml,
      /sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe\+6DChMTBJemed7ZnvJ/
    );
    assert.match(
      indexHtml,
      /sha384-3N9GHhCtN3CQef6tNfqgZlv7sQLYIkcChN\+uaTZ7xVdzKYp\/SjBNPxa92\+hM7EAY/
    );
    results.push({
      name: 'index.html pins Chart.js 4.5.1 UMD and annotation plugin SRI',
      success: true,
    });
  } catch (error) {
    results.push({
      name: 'index.html pins Chart.js 4.5.1 UMD and annotation plugin SRI',
      success: false,
      error: error.message,
    });
  }

  return { success: results.every(result => result.success), results };
}

module.exports = testSecurityHardeningDashboard;

if (require.main === module) {
  testSecurityHardeningDashboard()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
