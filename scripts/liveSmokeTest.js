'use strict';

/**
 * Live Smoke Test
 *
 * Exercises each user-facing bot function against the REAL external APIs and
 * the running status server, printing per-function pass/fail feedback. This is
 * a runtime smoke test (not a unit test) — it confirms the deployed bot can
 * actually reach OpenAI, the weather/time/quake services, and serve /health.
 *
 * Usage: node scripts/liveSmokeTest.js
 */

// Load environment the same way the app does.
require('../src/core/configValidator');
const config = require('../src/core/configValidator');
const http = require('http');

const STATUS_PORT = process.env.ACTUAL_STATUS_PORT || process.env.PROD_PORT || 3007;

const results = [];
function snippet(value, max = 120) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '(empty)';
  return text.replace(/\s+/g, ' ').slice(0, max);
}

async function run(name, fn) {
  const start = Date.now();
  process.stdout.write(`▶ ${name} ... `);
  try {
    const detail = await fn();
    const ms = Date.now() - start;
    console.log(`✅ PASS (${ms}ms) — ${detail}`);
    results.push({ name, ok: true, ms });
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`❌ FAIL (${ms}ms) — ${err.message}`);
    results.push({ name, ok: false, ms, error: err.message });
  }
}

function getJSON(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: STATUS_PORT, path, timeout: 8000 }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

(async () => {
  console.log('\n🔬 Live Smoke Test — exercising each bot function against real APIs\n');

  // 1. Status server health
  await run('Status server /health', async () => {
    const h = await getJSON('/health');
    if (h.status !== 'ok') throw new Error(`status=${h.status}`);
    return `${h.name} v${h.version}, up ${h.formattedUptime}`;
  });

  // 2. Weather (real WeatherAPI)
  await run('Weather lookup', async () => {
    const { getWeatherResponse } = require('../src/services/simplified-weather');
    const data = await getWeatherResponse(
      'Auckland, New Zealand',
      "What's the weather in Auckland?"
    );
    if (!data) throw new Error('no weather data returned');
    const loc = data.location?.name || data.weather?.location?.name || 'response received';
    return `Auckland → ${snippet(loc, 60)}`;
  });

  // 3. Time (timezone lookup)
  await run('Time lookup', async () => {
    const lookupTime = require('../src/services/timeLookup');
    const data = await lookupTime('Tokyo');
    if (!data) throw new Error('no time data returned');
    return `Tokyo → ${snippet(data, 80)}`;
  });

  // 4. Quake server stats (real scraping)
  await run('Quake server stats', async () => {
    const lookupQuakeServer = require('../src/services/quakeLookup');
    const data = await lookupQuakeServer(null, 1);
    if (!data) throw new Error('no quake data returned');
    return `default server → ${snippet(data, 80)}`;
  });

  // 5. Conversation (direct OpenAI chat completion)
  await run('OpenAI conversation', async () => {
    const { OpenAI } = require('openai');
    // Mirror the bot: dedicated undici dispatcher (avoids node-fetch "Premature
    // close" and the discord.js global-dispatcher hijack).
    const { openaiFetch } = require('../src/core/openaiFetch');
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, fetch: openaiFetch });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Reply with exactly: SMOKE_OK' }],
      max_tokens: 10,
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty completion');
    return `model replied "${snippet(text, 40)}"`;
  });

  // 6. Image generation (real OpenAI image API — fast tier)
  await run('Image generation', async () => {
    const imageGen = require('../src/services/imageGeneration');
    const res = await imageGen.generateImage('a small friendly robot waving hello', {
      model: 'gpt-image-1-mini',
      size: '1024x1024',
      quality: 'low',
    });
    if (!res || !res.success) throw new Error(res?.error || 'generation failed');
    const img = res.images?.[0] || {};
    const kind = img.b64_json ? `b64 (${img.b64_json.length} chars)` : img.url ? 'url' : 'no data';
    if (!img.b64_json && !img.url) throw new Error('no image payload');
    const cost = res.estimatedCost != null ? ` ~$${res.estimatedCost}` : '';
    return `image returned as ${kind}${cost}`;
  });

  // Summary
  const passed = results.filter(r => r.ok).length;
  const total = results.length;
  console.log('\n────────────────────────────────────────');
  console.log(`📊 Smoke test: ${passed}/${total} functions OK`);
  for (const r of results) {
    console.log(`   ${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : ` — ${r.error}`}`);
  }
  console.log('────────────────────────────────────────\n');

  process.exit(passed === total ? 0 : 1);
})();
