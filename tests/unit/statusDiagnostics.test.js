const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');

const loggerId = require.resolve('../../src/core/logger');
require.cache[loggerId] = {
  id: loggerId,
  filename: loggerId,
  loaded: true,
  exports: { createLogger: () => ({ info() {}, error() {} }) },
};
const { runCorsTests, runRateLimiterTests } = require('../../src/utils/statusDiagnostics');

async function withServer(handler, run) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('diagnostics accept loopback HTTP and verify allowed and blocked CORS origins', async () => {
  await withServer(
    (req, res) => {
      assert.equal(req.url, '/api');
      if (['http://localhost', 'http://127.0.0.1'].includes(req.headers.origin)) {
        res.setHeader('access-control-allow-origin', req.headers.origin);
      }
      res.end('{}');
    },
    async base => {
      const result = await runCorsTests(base);
      assert.equal(result.success, true);
      assert.equal(result.details.length, 4);
    }
  );
});

test('CORS diagnostics reject wildcard access for a disallowed origin', async () => {
  await withServer(
    (_req, res) => {
      res.setHeader('access-control-allow-origin', '*');
      res.end('{}');
    },
    async base => {
      const result = await runCorsTests(base);
      assert.equal(result.success, false);
      assert.equal(result.details.find(item => item.name === 'Disallowed Origin').success, false);
    }
  );
});

test('diagnostics reject non-loopback HTTP and embedded credentials before sending requests', async () => {
  for (const run of [runCorsTests, runRateLimiterTests]) {
    assert.match((await run('http://example.com')).error, /require HTTPS/);
    assert.match((await run('https://user:password@example.com')).error, /credentials/);
  }
});

test('rate diagnostics skip bursts outside development and report burst HTTP failures', async () => {
  const previous = process.env.NODE_ENV;
  try {
    let requests = 0;
    await withServer(
      (_req, res) => {
        requests++;
        res.statusCode = requests === 4 ? 429 : 200;
        res.end('{}');
      },
      async base => {
        process.env.NODE_ENV = 'production';
        const production = await runRateLimiterTests(base);
        assert.equal(production.success, true);
        assert.equal(production.details[1].skipped, true);
        assert.equal(requests, 1);
        process.env.NODE_ENV = 'development';
        const development = await runRateLimiterTests(base);
        assert.equal(development.success, false);
        assert.equal(development.details[1].requestCount, 5);
        assert.equal(development.details[1].successCount, 4);
        assert.equal(requests, 7);
      }
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('diagnostics return connection failures as unsuccessful results', async () => {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => server.close(resolve));
  const result = await runCorsTests(base);
  assert.equal(result.success, false);
  assert.ok(result.details.every(item => item.error));
});
