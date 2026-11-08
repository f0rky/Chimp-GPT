/**
 * Discovery route authorization, scan window, and response sanitization tests.
 *
 * Loads the actual discoveryRoutes and ownerAuth sources in vm wrappers with explicit stubs.
 * discoverServices / discoverPM2Bots / discoverDockerBots / checkBotHealth are counting stubs
 * that return fixtures containing raw internals and secret markers. Requests go to a real
 * express app on an ephemeral 127.0.0.1 port. The bot-navigation client is exercised in a vm
 * with a fake DOM and a fake OwnerAuth. No real scanning, PM2, Docker, network, files, or env.
 *
 * Usage: node tests/unit/discoveryRoutesAuth.test.js [--selftest]
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

const ROUTES_PATH = path.resolve(__dirname, '../../src/web/routes/discoveryRoutes.js');
const OWNER_AUTH_PATH = path.resolve(__dirname, '../../src/web/middleware/ownerAuth.js');
const CLIENT_PATH = path.resolve(__dirname, '../../src/web/public/bot-navigation.js');
const OWNER_TOKEN = 'Tk9xQ2v8LmP4rZ7wYb1nHs6dJf3gUe5cAo0iWq';
const SECRET = 'FIXTURE_SECRET_MARKER';
const RAW_KEYS = ['allResults', 'endpointResults', 'responseData', 'headers'];

const noop = () => undefined;
const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop };

function loadSource(modulePath, stubs, env) {
  const hermeticRequire = spec => {
    if (!Object.prototype.hasOwnProperty.call(stubs, spec)) {
      throw new Error(`Hermetic test: unstubbed require "${spec}"`);
    }
    return typeof stubs[spec] === 'function' && stubs[spec].lazy ? stubs[spec]() : stubs[spec];
  };
  const source = fs.readFileSync(modulePath, 'utf8');
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname, process) {${source}\n})`,
    { filename: modulePath }
  );
  const mod = { exports: {} };
  wrapper.call(
    mod.exports,
    mod.exports,
    hermeticRequire,
    mod,
    modulePath,
    path.dirname(modulePath),
    { env }
  );
  return mod.exports;
}

function rawService(port, name) {
  return {
    port,
    host: 'localhost',
    url: `http://localhost:${port}`,
    status: 'active',
    accessible: true,
    serviceType: 'discord-bot',
    isBotService: true,
    botConfidence: 80,
    workingEndpoints: 2,
    totalEndpoints: 4,
    endpointResults: [
      { endpoint: '/health', responseData: { token: SECRET }, headers: { 'set-cookie': SECRET } },
    ],
    serviceInfo: {
      name,
      botName: name,
      instanceName: 'main',
      version: '2.0.0',
      environment: 'production',
      discordStatus: 'ok',
      discordGuilds: 3,
      uptime: 120,
      formattedUptime: '2m',
      author: SECRET,
      memoryUsage: { rss: SECRET },
      bestEndpoint: `/${SECRET}`,
      server: SECRET,
      poweredBy: SECRET,
      responseData: { apiKey: SECRET },
      headers: { authorization: SECRET },
    },
    health: { hasHealthEndpoint: true, hasApiEndpoint: false, responseTime: 12, status: 200 },
    dashboardUrl: `http://localhost:${port}/#performance`,
    responseData: { env: { OPENAI_API_KEY: SECRET } },
    headers: { cookie: SECRET },
    env: { DISCORD_TOKEN: SECRET },
  };
}

function rawLegacy(port, name) {
  return {
    name,
    type: 'pm2',
    status: 'online',
    port,
    botName: name,
    pid: 4242,
    command: `node ${SECRET}.js`,
    pm_exec_path: `/srv/${SECRET}`,
    env: { OWNER_TOKEN: SECRET },
    image: SECRET,
    ports: SECRET,
  };
}

function rawHealth(port, botName, instanceName) {
  return {
    port,
    botName,
    instanceName,
    status: 'ok',
    uptime: 300,
    formattedUptime: '5m',
    version: '2.0.0',
    accessible: true,
    url: `http://localhost:${port}`,
    dashboardUrl: `http://localhost:${port}/#performance`,
    lastChecked: '2026-11-08T00:00:00.000Z',
    responseData: { secret: SECRET },
    headers: { authorization: SECRET },
    env: { OWNER_TOKEN: SECRET },
    command: `pm2 start ${SECRET}`,
    cwd: `/home/${SECRET}`,
  };
}

function makeHarness({ env = { OWNER_TOKEN }, extraServices = [] } = {}) {
  const calls = { discoverServices: [], pm2: 0, docker: 0, health: [], currentBot: 0 };
  const botDiscovery = {
    discoverPM2Bots: async () => {
      calls.pm2 += 1;
      return [rawLegacy(3002, 'ChimpGPT-Legacy'), rawLegacy(3005, 'ChimpGPT-Main')];
    },
    discoverDockerBots: async () => {
      calls.docker += 1;
      return [];
    },
    checkBotHealth: async (port, botName, instanceName) => {
      calls.health.push(port);
      return rawHealth(port, botName, instanceName);
    },
  };
  const serviceDiscovery = {
    discoverServices: async options => {
      calls.discoverServices.push(options);
      const services = [
        rawService(3005, 'ChimpGPT-Main'),
        rawService(3007, 'ChimpGPT-Other'),
        ...extraServices,
      ];
      return {
        success: true,
        discoveryTime: 5,
        portRange: { start: options.startPort, end: options.endPort },
        totalPorts: options.endPort - options.startPort + 1,
        activePorts: services.length,
        closedPorts: 1,
        botServices: services,
        services,
        allResults: [...services, { port: 3009, endpointResults: [{ responseData: SECRET }] }],
        timestamp: '2026-11-08T00:00:00.000Z',
      };
    },
    getCurrentBotInfo: port => {
      calls.currentBot += 1;
      return { name: 'ChimpGPT', port, instanceName: 'current', isCurrent: true };
    },
  };
  const loggerModule = { createLogger: () => logger };
  const ownerAuthLoader = () =>
    loadSource(
      OWNER_AUTH_PATH,
      { crypto: require('node:crypto'), '../../core/logger': loggerModule },
      env
    );
  ownerAuthLoader.lazy = true;
  const router = loadSource(
    ROUTES_PATH,
    {
      express,
      '../../core/logger': loggerModule,
      '../utils/botDiscovery': botDiscovery,
      '../../core/configValidator': { PORT: 3001, BOT_NAME: 'ChimpGPT' },
      '../../utils/serviceDiscovery': serviceDiscovery,
      '../middleware/ownerAuth': ownerAuthLoader,
    },
    env
  ).createRouter();

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use('/', router);
  return { app, calls };
}

function totalCalls(calls) {
  return calls.discoverServices.length + calls.pm2 + calls.docker + calls.health.length;
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    return await fn(server.address().port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function request(port, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: 'GET',
        headers: {
          ...headers,
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      res => {
        let text = '';
        res.on('data', chunk => (text += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, text, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) value.forEach(item => collectKeys(item, keys));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

function assertNoLeak(response) {
  const keys = collectKeys(response.json);
  for (const raw of RAW_KEYS)
    assert.equal(keys.has(raw), false, `response must not include ${raw}`);
  assert.equal(keys.has('serviceInfo'), false, 'no serviceInfo passthrough');
  assert.equal(keys.has('env'), false, 'no env');
  assert.equal(keys.has('command'), false, 'no command');
  assert.doesNotMatch(response.text, new RegExp(SECRET), 'no fixture secret markers');
}

const AUTH = { 'X-Owner-Token': OWNER_TOKEN };
const ROUTES = ['/api/discover-services', '/api/discover-bots'];

// a
for (const route of ROUTES) {
  test(`(a) ${route} rejects missing, wrong, query, and body tokens with zero discovery calls`, async () => {
    const { app, calls } = makeHarness();
    await withServer(app, async port => {
      const cases = [
        [{}, 401],
        [{ headers: { 'X-Owner-Token': 'wrong-token-value' } }, 403],
        [{ query: `?ownerToken=${OWNER_TOKEN}&token=${OWNER_TOKEN}` }, 401],
        [{ body: { ownerToken: OWNER_TOKEN, token: OWNER_TOKEN } }, 401],
      ];
      for (const [{ headers, body, query = '' }, expected] of cases) {
        const res = await request(port, `${route}${query}`, { headers, body });
        assert.equal(res.status, expected, `${route}${query} ${JSON.stringify({ headers, body })}`);
        assert.doesNotMatch(res.text, new RegExp(OWNER_TOKEN));
      }
    });
    assert.equal(totalCalls(calls), 0, JSON.stringify(calls));
    assert.equal(calls.currentBot, 0);
  });

  test(`(a) ${route} fails closed with 503 when OWNER_TOKEN is not configured`, async () => {
    const { app, calls } = makeHarness({ env: {} });
    await withServer(app, async port => {
      const res = await request(port, route, { headers: AUTH });
      assert.equal(res.status, 503);
    });
    assert.equal(totalCalls(calls), 0);
  });
}

// b, d, e
test('(b)(d)(e) discover-services with the owner token returns safe entries for the default window', async () => {
  const { app, calls } = makeHarness();
  await withServer(app, async port => {
    const res = await request(port, '/api/discover-services', { headers: AUTH });
    assert.equal(res.status, 200, res.text);
    assertNoLeak(res);
    assert.equal(res.json.success, true);
    assert.deepEqual(calls.discoverServices, [{ startPort: 3000, endPort: 3020, maxParallel: 5 }]);
    assert.deepEqual(res.json.discovery.portRange, { start: 3000, end: 3020 });
    assert.equal(typeof res.json.timestamp, 'string');
    assert.equal(res.json.currentBot.name, 'ChimpGPT');

    const bots = res.json.botServices;
    assert.deepEqual(
      bots.map(b => b.port),
      [3005, 3007, 3002]
    );
    const main = bots.find(b => b.port === 3005);
    assert.equal(main.botName, 'ChimpGPT-Main');
    assert.equal(main.name, 'ChimpGPT-Main');
    assert.equal(main.discordStatus, 'ok');
    assert.equal(main.discordGuilds, 3);
    assert.equal(main.version, '2.0.0');
    assert.equal(main.formattedUptime, '5m');
    assert.equal(main.isBotService, true);
    assert.equal(main.botConfidence, 80);
    assert.equal(main.workingEndpoints, 2);
    assert.equal(main.totalEndpoints, 4);
    assert.equal(main.url, 'http://localhost:3005');
    assert.deepEqual(main.health, {
      hasHealthEndpoint: true,
      hasApiEndpoint: false,
      responseTime: 12,
      status: 200,
    });
    const legacy = bots.find(b => b.port === 3002);
    assert.equal(legacy.botName, 'ChimpGPT-Legacy');
    assert.equal(legacy.status, 'ok');
    assert.equal(res.json.services.length, 2);
    assert.equal(res.json.discovery.legacyBotsFound, 2);
  });
});

test('(b)(e) discover-bots with the owner token returns only display and health fields', async () => {
  const { app, calls } = makeHarness();
  await withServer(app, async port => {
    const res = await request(port, '/api/discover-bots', { headers: AUTH });
    assert.equal(res.status, 200, res.text);
    assertNoLeak(res);
    assert.equal(res.json.count, 2);
    assert.equal(res.json.totalDiscovered, 2);
    assert.deepEqual(
      res.json.bots.map(b => [b.port, b.botName, b.instanceName, b.status, b.formattedUptime]),
      [
        [3002, 'ChimpGPT-Legacy', 'ChimpGPT-Legacy', 'ok', '5m'],
        [3005, 'ChimpGPT-Main', 'ChimpGPT-Main', 'ok', '5m'],
      ]
    );
    for (const bot of res.json.bots) {
      assert.equal(bot.accessible, true);
      for (const forbiddenKey of ['pid', 'cwd', 'pm_exec_path', 'image', 'ports', 'type']) {
        assert.equal(Object.hasOwn(bot, forbiddenKey), false, forbiddenKey);
      }
    }
  });
  assert.equal(calls.pm2, 1);
  assert.equal(calls.health.length, 2);
});

// c
test('(c) out-of-window, malformed, or inverted ranges are rejected with zero scan calls', async () => {
  const { app, calls } = makeHarness();
  await withServer(app, async port => {
    for (const query of [
      '?startPort=1&endPort=100',
      '?startPort=2999',
      '?endPort=3021',
      '?startPort=22&endPort=22',
      '?startPort=8000&endPort=8050',
      '?startPort=3010&endPort=3005',
      '?startPort=abc',
      '?startPort=0',
      '?endPort=3005.5',
      '?startPort=-1',
    ]) {
      const res = await request(port, `/api/discover-services${query}`, { headers: AUTH });
      assert.equal(res.status, 400, query);
      assert.equal(res.json.success, false);
    }
  });
  assert.equal(totalCalls(calls), 0, JSON.stringify(calls));
});

test('(c) an in-window sub-range is honoured', async () => {
  const { app, calls } = makeHarness();
  await withServer(app, async port => {
    const res = await request(port, '/api/discover-services?startPort=3004&endPort=3010', {
      headers: AUTH,
    });
    assert.equal(res.status, 200, res.text);
  });
  assert.deepEqual(calls.discoverServices, [{ startPort: 3004, endPort: 3010, maxParallel: 5 }]);
});

// f
function fakeElement() {
  const classes = new Set();
  return {
    innerHTML: '',
    textContent: '',
    title: '',
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
    },
    addEventListener: noop,
    appendChild: noop,
    insertBefore: noop,
    remove: noop,
    querySelector: () => fakeElement(),
  };
}

function loadClient({ unlocked = false, responses = [] } = {}) {
  const elements = new Map();
  const byId = id => {
    if (!elements.has(id)) elements.set(id, fakeElement());
    return elements.get(id);
  };
  const current = fakeElement();
  const listeners = new Set();
  const counters = { fetch: 0, ownerFetch: [], prompt: 0, unlock: 0, intervals: [] };
  const auth = { unlocked };
  const OwnerAuth = {
    isUnlocked: () => auth.unlocked,
    unlock: () => {
      counters.unlock += 1;
      return false;
    },
    onChange: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ownerFetch: async (url, options) => {
      counters.ownerFetch.push({ url, options });
      const next = responses.length ? responses.shift() : { status: 200, body: { success: true } };
      if (next.status === 401 || next.status === 403) {
        auth.unlocked = false;
        listeners.forEach(l => l({ state: 'rejected' }));
        const error = new Error('rejected');
        error.name = 'OwnerAuthError';
        error.status = next.status;
        throw error;
      }
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        statusText: '',
        json: async () => next.body,
      };
    },
  };
  const document = {
    readyState: 'complete',
    head: fakeElement(),
    createElement: () => fakeElement(),
    addEventListener: noop,
    getElementById: byId,
    querySelector: selector => (selector === '.bot-nav-current' ? current : fakeElement()),
  };
  const window = { OwnerAuth, location: { port: '3001', href: '' }, prompt: () => {} };
  window.prompt = () => {
    counters.prompt += 1;
    return null;
  };
  const context = {
    window,
    document,
    OwnerAuth,
    console: { log: noop, warn: noop, error: noop },
    fetch: () => {
      counters.fetch += 1;
      throw new Error('raw fetch must not be used for discovery');
    },
    prompt: window.prompt,
    setInterval: (fn, ms) => {
      counters.intervals.push(fn);
      return counters.intervals.length;
    },
    clearInterval: noop,
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
    clearTimeout,
    AbortController,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(CLIENT_PATH, 'utf8'), context, { filename: CLIENT_PATH });
  const nav = vm.runInContext('_botNavigation', context);
  const emit = status => listeners.forEach(l => l(status));
  return { nav, counters, auth, emit, list: byId('bot-nav-list'), current, context };
}

const settleClient = () => new Promise(resolve => setTimeout(resolve, 20));

test('(f) client calls only /api/discover-services, via OwnerAuth.ownerFetch, and never prompts', () => {
  const source = fs.readFileSync(CLIENT_PATH, 'utf8');
  assert.equal(source.split("'/api/discover-services'").length - 1, 1, 'one discovery call site');
  assert.doesNotMatch(source, /\/api\/discover-bots/, 'client has no discover-bots path');
  assert.match(source, /window\.OwnerAuth\.ownerFetch\(url,/);
  assert.doesNotMatch(source, /(?<![.\w])fetch\(/, 'no raw fetch');
  assert.doesNotMatch(source, /\bprompt\(|\.unlock\(/, 'no prompt or unlock');
});

// Every tag in rendered markup must be a known element with only class/title/onclick attributes,
// class values limited to safe tokens and onclick limited to the numeric-port navigation call.
function assertSafeMarkup(html) {
  const tags = [...html.matchAll(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g)];
  assert.ok(tags.length > 0, 'markup rendered');
  for (const [tag, name, rest] of tags) {
    assert.ok(['button', 'div', 'i', 'span'].includes(name.toLowerCase()), `unexpected tag ${tag}`);
    const attrs = [...rest.matchAll(/\s*([a-zA-Z-]+)="([^"]*)"/g)];
    assert.equal(
      attrs.map(a => a[0]).join(''),
      rest.replace(/\s+$/, ''),
      `unparsed attribute content in ${tag}`
    );
    for (const [, attr, value] of attrs) {
      assert.ok(['class', 'title', 'onclick'].includes(attr), `unexpected attribute ${attr}`);
      if (attr === 'class') assert.match(value, /^[a-z0-9 _-]*$/, `class ${value}`);
      if (attr === 'onclick') {
        assert.match(
          value,
          /^_botNavigation\.navigateToBot\('http:\/\/localhost:\d+\/#performance'\)$/
        );
      }
    }
  }
}

const XSS_FIXTURE = {
  port: 3006,
  botName: '<img src=x onerror="window.__xss=1">',
  discordStatus: '"><script>window.__xss=1</script>',
  formattedUptime: '<svg onload=window.__xss=1>',
  version: '<b>',
};

test('(f) discovered markup in name/status/uptime/version is escaped, never injected', async () => {
  const { list, current, context } = loadClient({
    unlocked: true,
    responses: [{ status: 200, body: { success: true, botServices: [XSS_FIXTURE] } }],
  });
  await settleClient();
  const html = list.innerHTML;
  assertSafeMarkup(html);
  assert.doesNotMatch(html, /<img|<script|<svg|<b>/i);
  assert.match(html, /&lt;img src=x onerror=&quot;window\.__xss=1&quot;&gt;/);
  assert.match(html, /&lt;svg onload=window\.__xss=1&gt;/);
  assert.match(html, /&lt;b&gt;/, 'version rendered escaped');
  assert.match(html, /class="bot-nav-status unknown">unknown</, 'invalid status replaced');
  assert.doesNotMatch(html, /&quot;&gt;&lt;script/, 'raw status text never rendered');
  assert.match(html, /navigateToBot\('http:\/\/localhost:3006\/#performance'\)/);
  assert.equal(context.window.__xss, undefined);
  assert.equal(typeof current.textContent, 'string');
});

test('(f) malformed entries (non-string fields, invalid ports) are skipped without throwing', async () => {
  const { list } = loadClient({
    unlocked: true,
    responses: [
      {
        status: 200,
        body: {
          success: true,
          botServices: [
            null,
            'not-an-object',
            { port: null, botName: 'NullPort' },
            { botName: 'NoPort' },
            { port: '3008x', botName: 'BadPortString' },
            { port: 3009.5, botName: 'FractionalPort' },
            { port: 70000, botName: 'OutOfRange' },
            { port: 3010, botName: { toString: () => '<i>' }, version: 7, formattedUptime: [1] },
            { port: '3011', name: 'NumericStringPort', botName: 42, discordStatus: 'ok' },
            { port: 3012, botName: 'x'.repeat(500), discordStatus: 'online' },
          ],
        },
      },
    ],
  });
  await settleClient();
  const html = list.innerHTML;
  assertSafeMarkup(html);
  for (const skipped of ['NullPort', 'NoPort', 'BadPortString', 'FractionalPort', 'OutOfRange']) {
    assert.doesNotMatch(html, new RegExp(skipped));
  }
  const ports = [...html.matchAll(/localhost:(\d+)\//g)].map(m => Number(m[1])).sort();
  assert.deepEqual(ports, [3010, 3011, 3012]);
  assert.match(html, /Unknown Bot/);
  assert.match(html, /NumericStringPort/, 'non-string botName falls back to string name');
  assert.doesNotMatch(html, /x{101}/, 'long names are capped');
  assert.match(html, /bot-nav-status online/);
});

test('(f) showError escapes and caps its message', () => {
  const { nav, list } = loadClient({ unlocked: false });
  nav.showError('<img src=x onerror="window.__xss=1">' + 'y'.repeat(500));
  assertSafeMarkup(list.innerHTML);
  assert.doesNotMatch(list.innerHTML, /<img/);
  assert.match(list.innerHTML, /&lt;img src=x onerror=&quot;window\.__xss=1&quot;&gt;/);
  assert.doesNotMatch(list.innerHTML, /y{201}/);
  nav.showError(undefined);
  assertSafeMarkup(list.innerHTML);
});

test('(e) route sanitizer drops non-string display fields and invalid ports', async () => {
  const bad = (port, serviceInfo, extra = {}) => ({
    ...rawService(port, 'Bad'),
    serviceInfo,
    ...extra,
  });
  const { app } = makeHarness({
    extraServices: [
      bad(3010, {
        name: { nested: SECRET },
        botName: ['<b>', SECRET],
        version: 7,
        environment: true,
        discordStatus: { status: SECRET },
        formattedUptime: 12,
        uptime: 99,
        instanceName: null,
      }),
      bad(3011, { botName: `  ${'z'.repeat(500)}  `, version: '  1.2.3  ' }),
      bad('3012', { botName: 'StringPort' }),
      bad(3013.5, { botName: 'FractionalPort' }),
      bad(70000, { botName: 'OutOfRange' }),
      bad(null, { botName: 'NullPort' }),
      bad(
        3014,
        { botName: 'TypedFields' },
        { isBotService: true, botConfidence: '99', accessible: 'yes' }
      ),
    ],
  });
  await withServer(app, async port => {
    const res = await request(port, '/api/discover-services', { headers: AUTH });
    assert.equal(res.status, 200, res.text);
    assertNoLeak(res);
    const all = [...res.json.botServices, ...res.json.services];
    for (const entry of all) {
      assert.ok(Number.isInteger(entry.port) && entry.port >= 1 && entry.port <= 65535, entry.port);
      for (const field of ['name', 'botName', 'instanceName', 'version', 'environment']) {
        if (field in entry) assert.equal(typeof entry[field], 'string', `${entry.port} ${field}`);
      }
      for (const field of ['discordStatus', 'uptime', 'formattedUptime']) {
        if (field in entry) assert.equal(typeof entry[field], 'string', `${entry.port} ${field}`);
        if (field in entry) assert.ok(entry[field].length <= 200);
      }
    }
    assert.doesNotMatch(res.text, /StringPort|FractionalPort|OutOfRange|NullPort/);
    const e3010 = res.json.services.find(e => e.port === 3010);
    for (const field of [
      'name',
      'botName',
      'version',
      'environment',
      'discordStatus',
      'formattedUptime',
      'uptime',
      'instanceName',
    ]) {
      assert.equal(Object.hasOwn(e3010, field), false, `3010 ${field}`);
    }
    const e3011 = res.json.services.find(e => e.port === 3011);
    assert.equal(e3011.botName, 'z'.repeat(200));
    assert.equal(e3011.version, '1.2.3');
    const e3014 = res.json.services.find(e => e.port === 3014);
    assert.equal(e3014.isBotService, true);
    assert.equal(Object.hasOwn(e3014, 'botConfidence'), false);
    assert.equal(Object.hasOwn(e3014, 'accessible'), false);
  });
});

test('(f) locked client makes zero requests, shows a quiet locked state, and periodic refresh skips', async () => {
  const { nav, counters, list, emit } = loadClient({ unlocked: false });
  await settleClient();
  assert.equal(counters.ownerFetch.length, 0);
  assert.equal(counters.fetch, 0);
  assert.equal(counters.prompt + counters.unlock, 0);
  assert.match(list.innerHTML, /locked/i);
  assert.doesNotMatch(list.innerHTML, /bot-nav-error/);
  for (const tick of counters.intervals) await tick();
  for (const tick of counters.intervals) await tick();
  assert.equal(counters.ownerFetch.length, 0, 'periodic refresh skipped while locked');
  emit({ state: 'locked' });
  emit({ state: 'rejected' });
  await settleClient();
  assert.equal(counters.ownerFetch.length, 0, 'non-unlock state changes do not retry');
  assert.ok(nav);
});

test('(f) unlock retries discovery once; a rejected token returns to locked without looping', async () => {
  const { counters, auth, emit, list } = loadClient({
    unlocked: false,
    responses: [{ status: 403 }],
  });
  await settleClient();
  auth.unlocked = true;
  emit({ state: 'unlocked' });
  await settleClient();
  assert.equal(counters.ownerFetch.length, 1, 'exactly one retry after unlock');
  assert.equal(
    counters.ownerFetch[0].options.headers,
    undefined,
    'token header is added by ownerFetch'
  );
  assert.match(list.innerHTML, /locked/i);
  for (const tick of counters.intervals) await tick();
  await settleClient();
  assert.equal(counters.ownerFetch.length, 1, 'no further requests while locked');
  assert.equal(counters.prompt + counters.unlock, 0);
});

test('(f) 503 unconfigured response shows locked state and pauses periodic refresh', async () => {
  const { counters, list } = loadClient({
    unlocked: true,
    responses: [{ status: 503, body: { code: 'OWNER_AUTH_NOT_CONFIGURED' } }],
  });
  await settleClient();
  assert.equal(counters.ownerFetch.length, 1);
  assert.match(list.innerHTML, /locked/i);
  for (const tick of counters.intervals) await tick();
  await settleClient();
  assert.equal(counters.ownerFetch.length, 1);
});

test('(f) unlocked client renders sanitized discovery entries', async () => {
  const { counters, list } = loadClient({
    unlocked: true,
    responses: [
      {
        status: 200,
        body: {
          success: true,
          botServices: [
            {
              port: 3005,
              botName: 'ChimpGPT-Main',
              discordStatus: 'ok',
              formattedUptime: '2m',
              version: '2.0.0',
            },
          ],
        },
      },
    ],
  });
  await settleClient();
  assert.equal(counters.ownerFetch.length, 1);
  assert.equal(counters.ownerFetch[0].url, '/api/discover-services');
  assert.match(list.innerHTML, /ChimpGPT-Main/);
  assert.match(list.innerHTML, /http:\/\/localhost:3005\/#performance/);
});

if (process.argv.includes('--selftest')) {
  process.on('exit', code => {
    if (code === 0) {
      console.log('SELFTEST PASS: discovery routes are owner-only, window-bound, and sanitized');
    } else {
      console.error(`SELFTEST FAIL: discovery route tests failed (exit ${code})`);
    }
  });
}
