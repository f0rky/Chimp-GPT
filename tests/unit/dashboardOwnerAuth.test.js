/**
 * Dashboard owner authentication regression tests.
 *
 * Hermetic by construction:
 * - Project modules are loaded through a vm-based CommonJS loader that injects a
 *   fixture `process` (in-memory env only) and explicit stubs. Any project module
 *   that is not stubbed or explicitly allowed throws instead of loading, so no
 *   real config, storage, Discord, or network module can be pulled in.
 * - HTTP requests are dispatched in-process through real Express apps using an
 *   unconnected socket; no port is opened.
 *
 * Usage:
 *   node tests/unit/dashboardOwnerAuth.test.js [--selftest]
 *   node --test tests/unit/dashboardOwnerAuth.test.js
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const SELFTEST = process.argv.includes('--selftest');

const OWNER_ID = '111111111111111111';
const OWNER_TOKEN = 'f3a9c1e7b2d84a6095c7e1f0a3b5d7c9e2f4a6b8c0d1e3f5a7b9c2d4e6f8a0b1';
const WRONG_TOKEN = `${OWNER_TOKEN.slice(0, -1)}2`;

const ALLOWED_PACKAGES = new Set(['express']);

// ─── Hermetic loader ──────────────────────────────────────────────────────────

function makeLogs() {
  const entries = [];
  const make = name => {
    const log = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      log[level] = (...args) => entries.push({ name, level, args });
    }
    log.child = () => log;
    return log;
  };
  return { entries, stub: { createLogger: make } };
}

function resolveProjectPath(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return `${base}.js`;
}

function projectKey(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/').replace(/\.js$/, '');
}

/**
 * @param {{ env: Object, stubs: Object, isolated: string[] }} options
 */
function createLoader({ env, stubs = {}, isolated = [] }) {
  const cache = new Map();
  const isolatedSet = new Set(isolated);
  const intervals = [];
  const fakeProcess = {
    env,
    argv: [],
    platform: process.platform,
    version: process.version,
    versions: process.versions,
    memoryUsage: () => process.memoryUsage(),
    cpuUsage: () => process.cpuUsage(),
    uptime: () => 42,
    on: () => fakeProcess,
    exit: code => {
      throw new Error(`Hermetic loader: unexpected process.exit(${code})`);
    },
  };
  const fakeSetInterval = (fn, ms) => {
    intervals.push({ fn, ms });
    return { unref() {} };
  };

  function load(absPath) {
    if (cache.has(absPath)) return cache.get(absPath).exports;
    const mod = { exports: {}, filename: absPath };
    cache.set(absPath, mod);
    const source = fs.readFileSync(absPath, 'utf8');
    const wrapper = vm.runInThisContext(
      `(function (exports, require, module, __filename, __dirname, process, setInterval) {${source}\n})`,
      { filename: absPath }
    );
    const realRequire = Module.createRequire(absPath);
    const hermeticRequire = spec => {
      if (Object.prototype.hasOwnProperty.call(stubs, spec)) return stubs[spec];
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const resolved = resolveProjectPath(absPath, spec);
        const key = projectKey(resolved);
        if (Object.prototype.hasOwnProperty.call(stubs, key)) return stubs[key];
        if (isolatedSet.has(key)) return load(resolved);
        throw new Error(`Hermetic loader: unstubbed project module "${key}"`);
      }
      if (Module.isBuiltin(spec) || ALLOWED_PACKAGES.has(spec)) return realRequire(spec);
      throw new Error(`Hermetic loader: package "${spec}" is not allowed`);
    };
    wrapper.call(
      mod.exports,
      mod.exports,
      hermeticRequire,
      mod,
      absPath,
      path.dirname(absPath),
      fakeProcess,
      fakeSetInterval
    );
    return mod.exports;
  }

  return {
    load: key => load(path.join(ROOT, `${key}.js`)),
    intervals,
  };
}

// ─── In-process HTTP dispatch ────────────────────────────────────────────────

function dispatch(app, { method = 'GET', url, headers = {}, body, remoteAddress = '203.0.113.5' }) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: remoteAddress });
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = url;
    const lowered = {};
    for (const [key, value] of Object.entries(headers)) lowered[key.toLowerCase()] = String(value);
    let payload = null;
    if (body !== undefined) {
      payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      lowered['content-type'] = lowered['content-type'] || 'application/json';
      lowered['content-length'] = String(payload.length);
    }
    req.headers = lowered;
    req.rawHeaders = Object.entries(lowered).flat();

    const res = new http.ServerResponse(req);
    const chunks = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`No response for ${method} ${url}`));
    }, 2000);
    res.write = chunk => {
      if (chunk) chunks.push(Buffer.from(chunk));
      return true;
    };
    res.end = (chunk, encoding) => {
      if (chunk && typeof chunk !== 'function') {
        chunks.push(Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
      }
      clearTimeout(timer);
      socket.destroy();
      const text = Buffer.concat(chunks).toString('utf8');
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      resolve({ status: res.statusCode, headers: res.getHeaders(), text, body: json });
      return res;
    };

    app(req, res);
    if (payload) req.push(payload);
    req.push(null);
  });
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Overrides with an undefined value remove that key (simulates an unset variable)
function makeEnv(overrides = {}) {
  const env = { OWNER_ID, OWNER_TOKEN, ...overrides };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  return env;
}

function makeManager(env) {
  const calls = [];
  const manager = {
    calls,
    // Mirrors production semantics: compares against env.OWNER_ID, so when OWNER_ID is
    // unset, isOwner(undefined) is true — the hazard routes must not reach.
    isOwner: userId => userId === env.OWNER_ID,
    getDeletedMessagesForWebUI(requestingUserId, filters) {
      calls.push(['list', requestingUserId, filters]);
      if (!manager.isOwner(requestingUserId)) throw new Error('Access denied');
      return [{ messageId: 'm1', status: 'pending_review', isRapidDeletion: false }];
    },
    async updateDeletedMessageStatus(requestingUserId, messageId, status, notes) {
      calls.push(['update', requestingUserId, messageId, status, notes]);
      return { messageId, status };
    },
    async init() {
      calls.push(['init']);
    },
    getBlockedUsers() {
      calls.push(['getBlockedUsers']);
      return ['222222222222222222'];
    },
    getUserStats: () => ({ deletions: 1 }),
    async unblockUser(userId) {
      calls.push(['unblock', userId]);
      return true;
    },
  };
  return manager;
}

function makeStores() {
  const calls = [];
  const stats = {
    startTime: new Date(0),
    messageCount: 99,
    apiCalls: { openai: 5 },
    errors: { openai: 1 },
    rateLimits: { hit: 3, users: new Set(['x']) },
  };
  const statsStorage = {
    async resetStats() {
      calls.push('resetStats');
      return true;
    },
    async repairStatsFile() {
      calls.push('repairStatsFile');
      return true;
    },
    async loadStats() {
      return { messageCount: 99 };
    },
  };
  const functionResults = {
    async getAllResults() {
      calls.push('getAllResults');
      return { weather: [{ timestamp: 1 }], lastUpdated: 'fixture' };
    },
    async repairResultsFile() {
      calls.push('repairResultsFile');
      return true;
    },
  };
  const performanceHistory = {
    addMetric: () => undefined,
    getRecentMetrics: () => [],
    getHourlyData: () => [],
    getDailyData: () => [],
    initialize: async () => undefined,
    shutdown: async () => undefined,
  };
  return { calls, stats, statsStorage, functionResults, performanceHistory };
}

function makeConfigStub() {
  return {
    CONFIG_SCHEMA: {
      BOT_NAME: { description: 'Bot name', required: false },
      OWNER_ID: { description: 'Owner', required: true },
      OWNER_TOKEN: { description: 'Dashboard token', required: false },
      DISCORD_TOKEN: { description: 'Discord token', required: true },
      OPENROUTER_API_KEY: { description: 'OpenRouter key', required: false },
      FIXTURE_SERVICE_API_KEY: { description: 'Generic service key', required: false },
      PORT: { description: 'Status port', required: false },
    },
    BOT_NAME: 'FixtureBot',
    OWNER_ID,
    OWNER_TOKEN,
    DISCORD_TOKEN: 'discord-fixture-secret-value',
    OPENROUTER_API_KEY: 'openrouter-fixture-secret-value',
    FIXTURE_SERVICE_API_KEY: 'generic-fixture-secret-value',
    PORT: 3999,
  };
}

function baseStubs(logs, stores) {
  return {
    'src/core/logger': logs.stub,
    'src/core/errors': {
      getSafeErrorDetails: error => ({
        statusCode: 500,
        message: error.message,
        timestamp: 'fixture',
      }),
    },
    'src/core/configValidator': makeConfigStub(),
    'src/core/functionResults': stores.functionResults,
    'src/middleware/performanceMonitor': {
      getAllTimingStats: () => ({ openai: { count: 1, avg: 10, p95: 12, max: 15 } }),
    },
  };
}

const ROUTE_MODULES = [
  'src/web/middleware/ownerAuth',
  'src/web/routes/deletedMessagesRoutes',
  'src/web/routes/performanceRoutes',
  'src/web/routes/adminRoutes',
  'src/web/routes/healthRoutes',
  'src/web/routes/discoveryRoutes',
];

function buildRouteApp(routeKey, envOverrides = {}) {
  const express = require('express');
  const env = makeEnv(envOverrides);
  const logs = makeLogs();
  const stores = makeStores();
  const manager = makeManager(env);
  const loader = createLoader({ env, stubs: baseStubs(logs, stores), isolated: ROUTE_MODULES });
  const deps = {
    stats: stores.stats,
    statsStorage: stores.statsStorage,
    functionResults: stores.functionResults,
    performanceHistory: stores.performanceHistory,
    maliciousUserManager: manager,
    serverState: { healthy: true, lastError: null },
  };
  const router = loader.load(routeKey).createRouter(deps);
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return { app, env, logs, stores, manager, loader };
}

function rejectionCases() {
  return [
    { name: 'no token', headers: {}, status: 401 },
    { name: 'forged x-user-id only', headers: { 'x-user-id': OWNER_ID }, status: 401 },
    { name: 'wrong same-length token', headers: { 'x-owner-token': WRONG_TOKEN }, status: 403 },
    { name: 'wrong short token', headers: { 'x-owner-token': 'nope' }, status: 403 },
    { name: 'query-string token', query: `token=${OWNER_TOKEN}`, headers: {}, status: 401 },
    { name: 'body token', bodyExtra: { token: OWNER_TOKEN }, headers: {}, status: 401 },
    {
      name: 'localhost client without token',
      headers: {},
      remoteAddress: '127.0.0.1',
      status: 401,
    },
  ];
}

function withQuery(url, query) {
  if (!query) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

async function assertRejectsAll(routeKey, { method, url, body }, getMutations) {
  for (const testCase of rejectionCases()) {
    const ctx = buildRouteApp(routeKey);
    const requestBody =
      testCase.bodyExtra || body ? { ...(body || {}), ...(testCase.bodyExtra || {}) } : undefined;
    const res = await dispatch(ctx.app, {
      method,
      url: withQuery(url, testCase.query),
      headers: testCase.headers,
      body: requestBody,
      remoteAddress: testCase.remoteAddress,
    });
    assert.equal(
      res.status,
      testCase.status,
      `${method} ${url} [${testCase.name}] expected ${testCase.status}, got ${res.status}: ${res.text}`
    );
    assert.deepEqual(
      getMutations(ctx),
      [],
      `${method} ${url} [${testCase.name}] reached the store before auth`
    );
    const serializedLogs = JSON.stringify(ctx.logs.entries);
    assert.ok(!serializedLogs.includes(OWNER_TOKEN), 'logs must never contain the owner token');
    assert.ok(!serializedLogs.includes(WRONG_TOKEN), 'logs must never contain a presented token');
  }
}

const authHeader = { 'x-owner-token': OWNER_TOKEN };

// ─── Shared middleware ───────────────────────────────────────────────────────

function loadOwnerAuth(envOverrides = {}) {
  const env = makeEnv(envOverrides);
  const logs = makeLogs();
  const loader = createLoader({
    env,
    stubs: { 'src/core/logger': logs.stub },
    isolated: ['src/web/middleware/ownerAuth'],
  });
  return { ownerAuth: loader.load('src/web/middleware/ownerAuth'), env, logs };
}

function appWithMiddleware(middlewares) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.all('/probe', ...middlewares, (req, res) =>
    res.json({ ok: true, ownerId: res.locals.ownerId })
  );
  return app;
}

test('ownerAuth fails closed (503) when OWNER_TOKEN is unset, blank, placeholder, or short', async () => {
  const badConfigs = [
    ['unset', undefined],
    ['blank', ''],
    ['whitespace', '    '],
    ['changeme', 'changeme'],
    ['31 chars', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d'],
    ['long placeholder', 'changeme-changeme-changeme-changeme'],
    ['example placeholder', 'your_dashboard_owner_token_goes_here'],
    ['low entropy', 'a'.repeat(40)],
  ];
  for (const [label, value] of badConfigs) {
    const { ownerAuth } = loadOwnerAuth({ OWNER_TOKEN: value });
    const app = appWithMiddleware([ownerAuth.requireOwnerToken]);
    const presented = value && value.trim() ? value : 'changeme';
    const res = await dispatch(app, {
      method: 'POST',
      url: '/probe',
      headers: { 'x-owner-token': presented },
    });
    assert.equal(res.status, 503, `config "${label}" should fail closed, got ${res.status}`);
    assert.equal(res.body.code, 'OWNER_AUTH_NOT_CONFIGURED');
    assert.ok(!res.text.includes(presented), 'response must not echo the presented token');
  }
});

test('ownerAuth accepts only the X-Owner-Token header and compares digests', async () => {
  const { ownerAuth, logs } = loadOwnerAuth();
  const app = appWithMiddleware([ownerAuth.requireOwnerToken]);

  const missing = await dispatch(app, { url: '/probe' });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.code, 'OWNER_TOKEN_REQUIRED');

  const empty = await dispatch(app, { url: '/probe', headers: { 'x-owner-token': '' } });
  assert.equal(empty.status, 401, 'empty X-Owner-Token is treated as missing');
  assert.equal(empty.body.code, 'OWNER_TOKEN_REQUIRED');

  const wrong = await dispatch(app, { url: '/probe', headers: { 'x-owner-token': WRONG_TOKEN } });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, 'OWNER_TOKEN_INVALID');

  const query = await dispatch(app, { url: `/probe?token=${OWNER_TOKEN}` });
  assert.equal(query.status, 401);

  const body = await dispatch(app, { method: 'POST', url: '/probe', body: { token: OWNER_TOKEN } });
  assert.equal(body.status, 401);

  const bodyless = await dispatch(app, { method: 'POST', url: '/probe' });
  assert.equal(bodyless.status, 401, 'bodyless request must not TypeError');

  const ok = await dispatch(app, { url: '/probe', headers: authHeader });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);

  assert.ok(!JSON.stringify(logs.entries).includes(OWNER_TOKEN));
  assert.ok(!JSON.stringify(logs.entries).includes(WRONG_TOKEN));
});

test('ownerAuth reads OWNER_TOKEN dynamically at request time', async () => {
  const { ownerAuth, env } = loadOwnerAuth({ OWNER_TOKEN: '' });
  const app = appWithMiddleware([ownerAuth.requireOwnerToken]);
  const before = await dispatch(app, { url: '/probe', headers: authHeader });
  assert.equal(before.status, 503);
  env.OWNER_TOKEN = OWNER_TOKEN;
  const after = await dispatch(app, { url: '/probe', headers: authHeader });
  assert.equal(after.status, 200);
});

test('configured OWNER_TOKEN with surrounding whitespace still matches after trim', async () => {
  const { ownerAuth } = loadOwnerAuth({ OWNER_TOKEN: `  ${OWNER_TOKEN}\n` });
  const app = appWithMiddleware([ownerAuth.requireOwnerToken]);
  const ok = await dispatch(app, { url: '/probe', headers: authHeader });
  assert.equal(ok.status, 200, ok.text);
  const wrong = await dispatch(app, { url: '/probe', headers: { 'x-owner-token': WRONG_TOKEN } });
  assert.equal(wrong.status, 403);
});

test('OWNER_ID with surrounding whitespace resolves server-side and the real isOwner agrees', async () => {
  const env = makeEnv({ OWNER_ID: `  ${OWNER_ID}\n` });
  const logs = makeLogs();
  const forbidden = name =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          throw new Error(`Hermetic test: ${name}.${String(prop)} must not be used`);
        },
      }
    );
  class StubError extends Error {}
  const loader = createLoader({
    env,
    stubs: {
      fs: { promises: forbidden('fs.promises') },
      'src/core/logger': logs.stub,
      'src/utils/humanCircuitBreaker': forbidden('humanCircuitBreaker'),
      'src/utils/contextExtractionService': {
        contextExtractionService: forbidden('contextExtraction'),
      },
      'src/core/errors': { AuthorizationError: StubError, NotFoundError: StubError },
      'src/utils/inputValidator': { validateStatusUpdateData: forbidden('inputValidator') },
    },
    isolated: ['src/web/middleware/ownerAuth', 'src/utils/maliciousUserManager'],
  });
  const ownerAuth = loader.load('src/web/middleware/ownerAuth');
  const realManager = loader.load('src/utils/maliciousUserManager');
  const app = appWithMiddleware([ownerAuth.requireOwnerToken, ownerAuth.requireOwnerIdentity]);
  const res = await dispatch(app, { url: '/probe', headers: authHeader });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.ownerId, OWNER_ID);
  assert.equal(realManager.isOwner(res.body.ownerId), true, 'real isOwner must accept it');
  assert.equal(realManager.isOwner(undefined), false);
});

test('requireOwnerIdentity resolves OWNER_ID server-side and fails closed when missing', async () => {
  const { ownerAuth } = loadOwnerAuth();
  const app = appWithMiddleware([ownerAuth.requireOwnerToken, ownerAuth.requireOwnerIdentity]);
  const ok = await dispatch(app, {
    url: '/probe',
    headers: { ...authHeader, 'x-user-id': '999999999999999999' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ownerId, OWNER_ID, 'caller cannot choose the acting owner');

  for (const badOwner of [undefined, '', 'YOUR_DISCORD_USER_ID']) {
    const loaded = loadOwnerAuth({ OWNER_ID: badOwner });
    const badApp = appWithMiddleware([
      loaded.ownerAuth.requireOwnerToken,
      loaded.ownerAuth.requireOwnerIdentity,
    ]);
    const res = await dispatch(badApp, { url: '/probe', headers: authHeader });
    assert.equal(res.status, 503, `OWNER_ID=${JSON.stringify(badOwner)} should fail closed`);
  }
});

// ─── Deleted messages routes ─────────────────────────────────────────────────

const DELETED = 'src/web/routes/deletedMessagesRoutes';

test('deleted-messages auth/read/status reject missing, forged, wrong, query and body credentials', async () => {
  const managerCalls = ctx => ctx.manager.calls;
  await assertRejectsAll(
    DELETED,
    { method: 'GET', url: '/api/deleted-messages/auth' },
    managerCalls
  );
  await assertRejectsAll(DELETED, { method: 'GET', url: '/api/deleted-messages' }, managerCalls);
  await assertRejectsAll(
    DELETED,
    {
      method: 'POST',
      url: '/api/deleted-messages/status',
      body: { messageId: 'm1', status: 'approved' },
    },
    managerCalls
  );
});

test('deleted-messages /auth returns authenticated:true without revealing the owner ID', async () => {
  const ctx = buildRouteApp(DELETED);
  const res = await dispatch(ctx.app, { url: '/api/deleted-messages/auth', headers: authHeader });
  assert.equal(res.status, 200);
  assert.equal(res.body.authenticated, true);
  assert.equal(res.body.userId, undefined);
  assert.ok(!res.text.includes(OWNER_ID), '/auth must not reveal the owner ID');
});

test('deleted-messages list/update act as the server-side owner, ignoring forged x-user-id', async () => {
  const ctx = buildRouteApp(DELETED);
  const forged = { ...authHeader, 'x-user-id': '999999999999999999' };

  const list = await dispatch(ctx.app, { url: '/api/deleted-messages', headers: forged });
  assert.equal(list.status, 200, list.text);
  assert.equal(list.body.stats.total, 1);

  const update = await dispatch(ctx.app, {
    method: 'POST',
    url: '/api/deleted-messages/status',
    headers: forged,
    body: { messageId: 'm1', status: 'approved', notes: 'ok' },
  });
  assert.equal(update.status, 200, update.text);

  assert.deepEqual(ctx.manager.calls, [
    ['list', OWNER_ID, {}],
    ['update', OWNER_ID, 'm1', 'approved', 'ok'],
  ]);
});

test('deleted-messages never authorize an undefined owner when OWNER_ID is unset', async () => {
  const ctx = buildRouteApp(DELETED, { OWNER_ID: undefined });
  delete ctx.env.OWNER_ID;
  for (const [method, url, body] of [
    ['GET', '/api/deleted-messages/auth'],
    ['GET', '/api/deleted-messages'],
    ['POST', '/api/deleted-messages/status', { messageId: 'm1', status: 'approved' }],
  ]) {
    const res = await dispatch(ctx.app, { method, url, headers: authHeader, body });
    assert.equal(res.status, 503, `${method} ${url} expected 503, got ${res.status}: ${res.text}`);
  }
  assert.deepEqual(ctx.manager.calls, []);
});

test('deleted-messages status update without a body returns 400, not a TypeError', async () => {
  const ctx = buildRouteApp(DELETED);
  const res = await dispatch(ctx.app, {
    method: 'POST',
    url: '/api/deleted-messages/status',
    headers: authHeader,
  });
  assert.equal(res.status, 400, res.text);
  assert.deepEqual(ctx.manager.calls, []);
});

// ─── Performance routes ──────────────────────────────────────────────────────

const PERF = 'src/web/routes/performanceRoutes';

test('reset/repair mutations and function-results reads reject bad credentials before the store', async () => {
  const storeCalls = ctx => ctx.stores.calls;
  for (const url of ['/reset-stats', '/repair-stats', '/repair-function-results']) {
    await assertRejectsAll(PERF, { method: 'POST', url }, storeCalls);
  }
  for (const url of ['/function-results', '/function-results/summary']) {
    await assertRejectsAll(PERF, { method: 'GET', url }, storeCalls);
  }
});

test('reset-stats with no credentials leaves in-memory stats untouched', async () => {
  const ctx = buildRouteApp(PERF);
  const res = await dispatch(ctx.app, { method: 'POST', url: '/reset-stats' });
  assert.equal(res.status, 401);
  assert.equal(ctx.stores.stats.messageCount, 99);
  assert.equal(ctx.stores.stats.rateLimits.hit, 3);
});

test('correct token runs reset/repair (bodyless) and reads function results', async () => {
  const ctx = buildRouteApp(PERF);
  for (const url of ['/reset-stats', '/repair-stats', '/repair-function-results']) {
    const res = await dispatch(ctx.app, { method: 'POST', url, headers: authHeader });
    assert.equal(res.status, 200, `${url}: ${res.text}`);
    assert.equal(res.body.success, true);
  }
  assert.equal(ctx.stores.stats.messageCount, 0);
  const summary = await dispatch(ctx.app, {
    url: '/function-results/summary',
    headers: authHeader,
  });
  assert.equal(summary.status, 200);
  assert.equal(summary.body.weather.count, 1);
  const list = await dispatch(ctx.app, { url: '/function-results?limit=1', headers: authHeader });
  assert.equal(list.status, 200);
  assert.deepEqual(ctx.stores.calls, [
    'resetStats',
    'repairStatsFile',
    'repairResultsFile',
    'getAllResults',
    'getAllResults',
  ]);
});

test('ordinary performance metrics stay public', async () => {
  const ctx = buildRouteApp(PERF);
  for (const url of [
    '/performance',
    '/performance/history/recent',
    '/performance/history/hourly',
    '/performance/history/daily',
  ]) {
    const res = await dispatch(ctx.app, { url });
    assert.equal(res.status, 200, `${url}: ${res.text}`);
    assert.equal(res.body.success, true);
  }
});

// ─── Admin routes ────────────────────────────────────────────────────────────

const ADMIN = 'src/web/routes/adminRoutes';

test('blocked-users, settings, run-tests and unblock-user reject bad credentials before the manager', async () => {
  const managerCalls = ctx => ctx.manager.calls;
  for (const url of ['/blocked-users', '/settings', '/run-tests']) {
    await assertRejectsAll(ADMIN, { method: 'GET', url }, managerCalls);
  }
  await assertRejectsAll(
    ADMIN,
    { method: 'POST', url: '/unblock-user', body: { userId: '222222222222222222' } },
    managerCalls
  );
});

test('admin routes work with the correct token and keep secrets out of /settings', async () => {
  const ctx = buildRouteApp(ADMIN);
  const blocked = await dispatch(ctx.app, { url: '/blocked-users', headers: authHeader });
  assert.equal(blocked.status, 200, blocked.text);
  assert.equal(blocked.body.count, 1);

  const settings = await dispatch(ctx.app, { url: '/settings', headers: authHeader });
  assert.equal(settings.status, 200, settings.text);
  const keys = settings.body.settings.map(s => s.key);
  assert.ok(!keys.includes('OWNER_TOKEN'));
  assert.ok(!keys.includes('OWNER_ID'));
  assert.ok(!keys.includes('DISCORD_TOKEN'));
  assert.ok(!settings.text.includes(OWNER_TOKEN));
  assert.ok(!settings.text.includes(OWNER_ID));
  assert.ok(!keys.includes('OPENROUTER_API_KEY'));
  assert.ok(!keys.includes('FIXTURE_SERVICE_API_KEY'), 'generic *_API_KEY must be skipped');
  assert.ok(!settings.text.includes('openrouter-fixture-secret-value'));
  assert.ok(!settings.text.includes('generic-fixture-secret-value'));
  const byKey = Object.fromEntries(settings.body.settings.map(s => [s.key, s]));
  assert.equal(byKey.BOT_NAME.displayValue, 'FixtureBot');
  assert.equal(byKey.PORT.displayValue, '3999');

  const unblock = await dispatch(ctx.app, {
    method: 'POST',
    url: '/unblock-user',
    headers: authHeader,
    body: { userId: '222222222222222222' },
  });
  assert.equal(unblock.status, 200, unblock.text);

  const bodyless = await dispatch(ctx.app, {
    method: 'POST',
    url: '/unblock-user',
    headers: authHeader,
  });
  assert.equal(bodyless.status, 400, `bodyless unblock should be 400: ${bodyless.text}`);

  assert.deepEqual(ctx.manager.calls, [
    ['init'],
    ['getBlockedUsers'],
    ['unblock', '222222222222222222'],
  ]);
});

test('run-tests reports diagnostics as unavailable (501) after auth instead of claiming success', async () => {
  const ctx = buildRouteApp(ADMIN);
  const res = await dispatch(ctx.app, { url: '/run-tests', headers: authHeader });
  assert.equal(res.status, 501, res.text);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'DIAGNOSTICS_UNAVAILABLE');
});

// ─── statusServer mount ──────────────────────────────────────────────────────

async function startStatusServer(envOverrides = {}) {
  const realExpress = require('express');
  const env = makeEnv(envOverrides);
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
  }
  const logs = makeLogs();
  const stores = makeStores();
  const manager = makeManager(env);
  let capturedApp = null;
  const fakeExpress = Object.assign((...args) => {
    const app = realExpress(...args);
    app.listen = (_port, callback) => {
      capturedApp = app;
      const server = new (require('node:events').EventEmitter)();
      server.close = done => done && done();
      setImmediate(callback);
      return server;
    };
    return app;
  }, realExpress);

  const stubs = {
    ...baseStubs(logs, stores),
    express: fakeExpress,
    dotenv: { config: () => ({ parsed: {} }) },
    'src/core/getBotVersion': {
      getDetailedVersionInfo: () => ({ version: '0.0.0-fixture', name: 'fixture', memory: 0 }),
      formatUptime: () => '0s',
    },
    'src/core/statsStorage': stores.statsStorage,
    'src/web/performanceHistory': stores.performanceHistory,
    'src/utils/maliciousUserManager': manager,
    'src/utils/statusDiagnostics': {
      runCorsTests: async () => ({ success: true }),
      runRateLimiterTests: async () => ({ success: true }),
    },
    'src/middleware/rateLimiter': { createRateLimiter: () => ({ consume: async () => null }) },
    'src/conversation/conversationManagerSelector': {
      getConversationStorageStatus: () => ({ mode: 'fixture' }),
    },
    'src/commands/statusReport': {
      detectLLMProviders: () => ({
        primary: { configured: true },
        imageGeneration: { configured: false },
        searchEngines: [],
      }),
      getServiceHealth: async () => ({}),
      getEnvironmentConfig: () => ({}),
    },
    'src/web/utils/botDiscovery': {
      discoverPM2Bots: async () => [],
      discoverDockerBots: async () => [],
      checkBotHealth: async () => ({}),
    },
  };
  const loader = createLoader({
    env,
    stubs,
    isolated: ['src/web/statusServer', ...ROUTE_MODULES],
  });
  const statusServer = loader.load('src/web/statusServer');
  await statusServer.initStatusServer();
  assert.ok(capturedApp, 'status server app was not captured');
  return { app: capturedApp, statusServer, loader, stores, manager, env, logs };
}

test('statusServer keeps the shared requireOwnerToken export', async () => {
  const ctx = await startStatusServer();
  const ownerAuth = ctx.loader.load('src/web/middleware/ownerAuth');
  assert.equal(typeof ctx.statusServer.requireOwnerToken, 'function');
  assert.equal(ctx.statusServer.requireOwnerToken, ownerAuth.requireOwnerToken);
  assert.equal(typeof ctx.statusServer.initStatusServer, 'function');
  assert.equal(typeof ctx.statusServer.shutdownGracefully, 'function');
});

test('statusServer rejects the old known-default "changeme" token when OWNER_TOKEN is unset', async () => {
  const ctx = await startStatusServer({ OWNER_TOKEN: undefined });
  const res = await dispatch(ctx.app, {
    method: 'POST',
    url: '/unblock-user',
    headers: { 'x-owner-token': 'changeme' },
    body: { userId: '222222222222222222' },
  });
  assert.equal(res.status, 503, res.text);
  assert.deepEqual(ctx.manager.calls, []);
});

test('statusServer mounted routes: query token, bodyless and unauthenticated mutations are rejected', async () => {
  const ctx = await startStatusServer();
  const query = await dispatch(ctx.app, {
    method: 'POST',
    url: `/unblock-user?token=${OWNER_TOKEN}`,
    body: { userId: '222222222222222222' },
  });
  assert.equal(query.status, 401, query.text);

  const bodyless = await dispatch(ctx.app, { method: 'POST', url: '/unblock-user' });
  assert.equal(bodyless.status, 401, `bodyless should be 401, not TypeError: ${bodyless.text}`);

  const reset = await dispatch(ctx.app, { method: 'POST', url: '/reset-stats' });
  assert.equal(reset.status, 401, reset.text);

  const deleted = await dispatch(ctx.app, { url: '/api/deleted-messages' });
  assert.equal(deleted.status, 401, deleted.text);

  assert.deepEqual(ctx.manager.calls, []);
  assert.deepEqual(ctx.stores.calls, []);

  const authorized = await dispatch(ctx.app, {
    method: 'POST',
    url: '/reset-stats',
    headers: authHeader,
  });
  assert.equal(authorized.status, 200, authorized.text);
});

test('statusServer public health, api index, version and performance need no credentials', async () => {
  const ctx = await startStatusServer({ OWNER_TOKEN: undefined });
  for (const url of ['/health', '/api', '/version', '/performance']) {
    const res = await dispatch(ctx.app, { url });
    assert.equal(res.status, 200, `${url}: ${res.text}`);
  }
});

test('statusServer detailed health diagnostics are owner-only and fail closed', async () => {
  const unconfigured = await startStatusServer({ OWNER_TOKEN: undefined });
  const closed = await dispatch(unconfigured.app, { url: '/health/detailed' });
  assert.equal(closed.status, 503, closed.text);

  const ctx = await startStatusServer();
  const missing = await dispatch(ctx.app, { url: '/health/detailed' });
  assert.equal(missing.status, 401, missing.text);
  const wrong = await dispatch(ctx.app, {
    url: '/health/detailed',
    headers: { 'x-owner-token': WRONG_TOKEN },
  });
  assert.equal(wrong.status, 403, wrong.text);
  const ok = await dispatch(ctx.app, { url: '/health/detailed', headers: authHeader });
  assert.equal(ok.status, 200, ok.text);
});

// ─── Browser client ──────────────────────────────────────────────────────────

const PUBLIC_DIR = path.join(ROOT, 'src/web/public');
const CLIENT_HELPER = path.join(PUBLIC_DIR, 'owner-auth.js');

function fakeResponse(status, body) {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    clone: () => response,
  };
  return response;
}

function loadClientHelper({ answers = [], respond = () => fakeResponse(200, {}) } = {}) {
  const session = new Map();
  const prompts = [];
  const fetches = [];
  const localStorageAccess = [];
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    sessionStorage: {
      getItem: key => (session.has(key) ? session.get(key) : null),
      setItem: (key, value) => session.set(key, String(value)),
      removeItem: key => session.delete(key),
    },
    localStorage: new Proxy(
      {},
      {
        get(_target, prop) {
          localStorageAccess.push(prop);
          return () => null;
        },
      }
    ),
    prompt: message => {
      prompts.push(message);
      return answers.length ? answers.shift() : null;
    },
    fetch: (url, options) => {
      fetches.push({ url, options });
      return Promise.resolve(respond(url, options));
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CLIENT_HELPER, 'utf8'), sandbox, { filename: CLIENT_HELPER });
  return { api: sandbox.OwnerAuth, session, prompts, fetches, localStorageAccess };
}

test('client helper never prompts or fetches on load and refuses protected calls while locked', async () => {
  const client = loadClientHelper();
  assert.ok(client.api, 'window.OwnerAuth must be defined');
  assert.equal(client.prompts.length, 0);
  assert.equal(client.api.isUnlocked(), false);
  await assert.rejects(client.api.ownerFetch('/settings'), err => err.code === 'OWNER_LOCKED');
  assert.equal(client.fetches.length, 0);
  assert.equal(client.prompts.length, 0, 'protected calls must not auto-prompt');
});

test('client helper prompts once on unlock and attaches X-Owner-Token header only', async () => {
  const client = loadClientHelper({ answers: [`  ${OWNER_TOKEN}  `] });
  const states = [];
  client.api.onChange(status => states.push(status.state));
  assert.equal(client.api.unlock(), true);
  assert.equal(client.prompts.length, 1);
  assert.equal(client.api.isUnlocked(), true);

  await client.api.ownerFetch('/reset-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  await client.api.ownerFetch('/settings');
  assert.equal(client.prompts.length, 1, 'token is solicited once');
  for (const call of client.fetches) {
    assert.equal(call.options.headers['X-Owner-Token'], OWNER_TOKEN);
    assert.ok(!call.url.includes(OWNER_TOKEN), 'token must never be put in the URL');
    assert.ok(!String(call.options.body || '').includes(OWNER_TOKEN));
  }
  assert.equal(client.fetches[0].options.headers['Content-Type'], 'application/json');
  assert.equal(client.fetches[0].options.method, 'POST');
  assert.deepEqual(client.localStorageAccess, [], 'token must not touch localStorage');
  assert.ok(states.includes('unlocked'));

  client.api.lock();
  assert.equal(client.api.isUnlocked(), false);
  assert.equal(client.session.size, 0, 'lock clears sessionStorage');
  await assert.rejects(client.api.ownerFetch('/settings'), err => err.code === 'OWNER_LOCKED');
  assert.equal(client.fetches.length, 2);
});

test('client helper locks on 401/403 and reports 503 config failures without retry loops', async () => {
  for (const status of [401, 403]) {
    const client = loadClientHelper({
      answers: [OWNER_TOKEN],
      respond: () => fakeResponse(status, { code: 'OWNER_TOKEN_INVALID' }),
    });
    client.api.unlock();
    await assert.rejects(
      client.api.ownerFetch('/blocked-users'),
      err => err.code === 'OWNER_TOKEN_REJECTED'
    );
    assert.equal(client.api.isUnlocked(), false);
    assert.equal(client.session.size, 0);
    await assert.rejects(
      client.api.ownerFetch('/blocked-users'),
      err => err.code === 'OWNER_LOCKED'
    );
    assert.equal(client.fetches.length, 1, 'no retry after rejection');
    assert.equal(client.prompts.length, 1, 'no automatic re-prompt');
  }

  const noOwnerId = loadClientHelper({
    answers: [OWNER_TOKEN],
    respond: () => fakeResponse(503, { code: 'OWNER_ID_NOT_CONFIGURED' }),
  });
  noOwnerId.api.unlock();
  await assert.rejects(
    noOwnerId.api.ownerFetch('/api/deleted-messages'),
    err => err.code === 'OWNER_ID_NOT_CONFIGURED' && err.status === 503
  );
  assert.equal(noOwnerId.api.getStatus().state, 'unconfigured');
  assert.match(noOwnerId.api.getStatus().message, /OWNER_ID/);
  assert.equal(noOwnerId.fetches.length, 1);
  assert.equal(noOwnerId.prompts.length, 1, 'no automatic re-prompt');

  const unconfigured = loadClientHelper({
    answers: [OWNER_TOKEN],
    respond: () => fakeResponse(503, { code: 'OWNER_AUTH_NOT_CONFIGURED' }),
  });
  unconfigured.api.unlock();
  await assert.rejects(
    unconfigured.api.ownerFetch('/settings'),
    err => err.code === 'OWNER_AUTH_NOT_CONFIGURED'
  );
  assert.equal(unconfigured.api.getStatus().state, 'unconfigured');
  assert.match(unconfigured.api.getStatus().message, /OWNER_TOKEN/);
  assert.equal(unconfigured.fetches.length, 1);

  const cancelled = loadClientHelper({ answers: [null] });
  assert.equal(cancelled.api.unlock(), false);
  assert.equal(cancelled.api.isUnlocked(), false);
});

test('dashboard loads the helper first and routes every protected call through it', () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  const helperIndex = scripts.indexOf('owner-auth.js');
  assert.ok(helperIndex >= 0, 'index.html must load owner-auth.js');
  assert.ok(helperIndex < scripts.indexOf('bot-navigation.js'));
  assert.ok(helperIndex < scripts.indexOf('app-unified.js'));
  assert.match(html, /id="owner-auth-toggle"/);
  assert.match(html, /id="owner-auth-status"/);

  const source = fs.readFileSync(path.join(PUBLIC_DIR, 'app-unified.js'), 'utf8');
  const protectedPaths = [
    '/health/detailed',
    '/reset-stats',
    '/repair-stats',
    '/repair-function-results',
    '/function-results',
    '/blocked-users',
    '/unblock-user',
    '/settings',
    '/run-tests',
    '/api/deleted-messages',
  ];
  const publicPaths = ['/health', '/performance'];
  const calls = [...source.matchAll(/([\w.]*fetch)\(\s*[`'"](\/[^`'"?$]*)/gi)].map(m => ({
    callee: m[1],
    url: m[2],
  }));
  assert.ok(calls.length > 0);
  for (const call of calls) {
    const isProtected = protectedPaths.some(p => call.url === p || call.url.startsWith(`${p}/`));
    const isPublic = publicPaths.some(p => call.url === p || call.url.startsWith(`${p}/`));
    if (isProtected) {
      assert.equal(
        call.callee,
        'OwnerAuth.ownerFetch',
        `${call.url} must use OwnerAuth.ownerFetch`
      );
    } else if (isPublic) {
      assert.equal(call.callee, 'fetch', `${call.url} must stay a credential-free public fetch`);
    }
  }
  assert.ok(calls.some(c => c.url === '/health' && c.callee === 'fetch'));
  assert.ok(!/x-user-id/i.test(source), 'client must not send caller identity headers');
  assert.ok(!/prompt\(\s*['"`]Enter owner token/i.test(source), 'no ad-hoc token prompts');
  assert.ok(!/localStorage[^\n]*token/i.test(source), 'token must not be stored in localStorage');
  assert.equal(
    (source.match(/OwnerAuth\.unlock\(/g) || []).length,
    1,
    'only the explicit admin control may solicit the token'
  );
});

if (SELFTEST) {
  process.on('exit', code => {
    if (code === 0) {
      console.log('SELFTEST PASS: dashboard owner auth is header-only, fail-closed and hermetic');
    } else {
      console.error(`SELFTEST FAIL: dashboard owner auth regression tests failed (exit ${code})`);
    }
  });
}
