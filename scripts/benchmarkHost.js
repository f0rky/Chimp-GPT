#!/usr/bin/env node
// Read-only HTTP benchmark. No Discord messages or paid API requests.
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { performance } = require('node:perf_hooks');

const base = process.argv[2] || 'http://127.0.0.1:3007';
const output = process.argv[3];
const agent = new http.Agent({ keepAlive: true, maxSockets: 5 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function request(route) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = http.get(new URL(route, base), { agent, timeout: 5000 }, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve({ ms: performance.now() - start, status: res.statusCode, body }));
      res.on('error', reject);
    });
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

async function main() {
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
  for (const route of ['/health', '/api']) {
    for (const concurrency of [1, 5]) {
      for (let i = 0; i < 10; i++) await request(route);
      const measurements = [];
      let failures = 0;
      for (let i = 0; i < 100 / concurrency; i++) {
        const responses = await Promise.all(
          Array.from({ length: concurrency }, () => request(route))
        );
        for (const response of responses) {
          measurements.push(response.ms);
          if (response.status !== 200) failures++;
        }
        await pause(50);
      }
      result.benchmarks.push({ route, concurrency, failures, ...stats(measurements) });
    }
  }
  const metrics = JSON.parse((await request('/performance')).body);
  result.taskMetrics = metrics.summary;
  result.serverHealth = metrics.serverHealth;
  result.loadAfter = os.loadavg();
  if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => agent.destroy());
