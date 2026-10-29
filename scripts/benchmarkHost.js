#!/usr/bin/env node
// Read-only loopback HTTP benchmark. No Discord messages or paid API requests.
// Usage: node scripts/benchmarkHost.js [port] > report.json
const os = require('node:os');
const http = require('node:http');
const { performance } = require('node:perf_hooks');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function parsePort(value = '3007') {
  if (!/^\d{1,5}$/.test(value)) throw new Error('Expected a local port number (1-65535)');
  const port = Number(value);
  if (port < 1 || port > 65535) throw new Error('Expected a local port number (1-65535)');
  return port;
}

function request(port, agent, route) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = http.get(
      { hostname: '127.0.0.1', port, path: route, agent, timeout: 5000 },
      res => {
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () =>
          resolve({ ms: performance.now() - start, status: res.statusCode, body })
        );
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
  });
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted[Math.ceil(sorted.length * p) - 1];
  return {
    count: sorted.length,
    median: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1),
  };
}

// Benchmarks must run serially so one scenario cannot distort another's timings.
async function repeat(count, action) {
  if (count === 0) return;
  await action();
  await repeat(count - 1, action);
}

async function benchmark(get, route, concurrency) {
  await repeat(10, () => get(route));
  const measurements = [];
  let failures = 0;
  await repeat(100 / concurrency, async () => {
    const responses = await Promise.all(Array.from({ length: concurrency }, () => get(route)));
    for (const response of responses) {
      measurements.push(response.ms);
      if (response.status !== 200) failures++;
    }
    await pause(50);
  });
  return { route, concurrency, failures, ...stats(measurements) };
}

async function main(args = process.argv.slice(2)) {
  if (args.length > 1) throw new Error('Usage: node scripts/benchmarkHost.js [port] > report.json');
  const port = parsePort(args[0]);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 5 });
  const get = route => request(port, agent, route);
  try {
    const result = {
      timestamp: new Date().toISOString(),
      host: os.hostname(),
      node: process.version,
      load: os.loadavg(),
      availableMemoryBytes: os.freemem(),
      cpuCount: os.cpus().length,
      methodology:
        '10 warmups, 100 measured requests per route/concurrency, 50ms between batches; keep-alive; milliseconds',
      benchmarks: [],
    };
    const scenarios = [
      ['/health', 1],
      ['/health', 5],
      ['/api', 1],
      ['/api', 5],
    ];
    await scenarios.reduce(
      (previous, [route, concurrency]) =>
        previous.then(async () => result.benchmarks.push(await benchmark(get, route, concurrency))),
      Promise.resolve()
    );
    const metrics = JSON.parse((await get('/performance')).body);
    result.taskMetrics = metrics.summary;
    result.serverHealth = metrics.serverHealth;
    result.loadAfter = os.loadavg();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    agent.destroy();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { parsePort, main };
