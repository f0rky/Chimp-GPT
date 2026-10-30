#!/usr/bin/env node
// Opt-in live cache smoke. --include-chat adds one paid Luna request. No Discord messages.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = process.argv[2];
const includeChat = process.argv[3] === '--include-chat';
if (!output || process.argv.length > 4 || (process.argv[3] && !includeChat)) {
  console.error('Usage: node scripts/smokeWeatherCache.js <output.json> [--include-chat]');
  process.exit(1);
}
const envFile = path.join(root, '.env');
const env = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
Object.assign(process.env, env, { LOG_LEVEL: 'fatal', NODE_ENV: 'production' });
process.chdir(root);
const load = file => require(path.join(root, file));
const { weatherService } = load('src/services/weatherClient');
const api = load('src/services/weatherLookup');
const { getWeatherResponse } = load('src/services/simplified-weather');
const report = {
  startedAt: new Date().toISOString(),
  provider: 'open-meteo',
  includeChat,
  checks: [],
};
const insist = (condition, message) => {
  if (!condition) throw new Error(message);
};
async function check(name, action) {
  const started = performance.now();
  try {
    const details = await action();
    report.checks.push({ name, passed: true, ms: performance.now() - started, details });
  } catch (error) {
    report.checks.push({
      name,
      passed: false,
      ms: performance.now() - started,
      error: error.code || error.name,
      detail: error.message,
    });
  }
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.checks.at(-1)));
}
(async () => {
  let current;
  await check('20 concurrent cold lookups share one geocode and one weather request', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => api.lookupWeather('Auckland, New Zealand'))
    );
    insist(
      results.every(result => result.success && result.data.source === 'open-meteo'),
      'A live weather request failed'
    );
    current = results[0];
    const counts = weatherService.getStats();
    insist(
      counts.geocodingRequests === 1 && counts.forecastRequests === 1,
      'Unexpected duplicate upstream request'
    );
    return {
      ...counts,
      location: current.data.location.name,
      temperatureC: current.data.current.temp_c,
      forecastDays: current.data.forecast.forecastday.length,
    };
  });
  await check(
    '25 warm current/forecast/format/plugin calls make no additional requests',
    async () => {
      const plugin = load('src/plugins/weather-plugin');
      const before = weatherService.getStats();
      for (let i = 0; i < 5; i++) {
        const result = await api.lookupWeather(' AUCKLAND,   NEW ZEALAND ');
        insist(result.success, 'Warm lookup failed');
        insist(
          (await api.lookupExtendedForecast('Auckland, New Zealand', 2)).data.forecast.forecastday
            .length === 2,
          'Forecast day count mismatch'
        );
        const formatted = await getWeatherResponse('Auckland, New Zealand', 'weather?', current);
        insist(formatted.formattedSummary.includes('Open-Meteo'), 'Attribution missing');
        await getWeatherResponse('Auckland, New Zealand', 'tomorrow forecast');
        const data = await plugin.functions.lookupWeather('Auckland, New Zealand');
        insist(data.source === 'open-meteo', 'Plugin source mismatch');
      }
      const after = weatherService.getStats();
      insist(
        after.geocodingRequests === before.geocodingRequests &&
          after.forecastRequests === before.forecastRequests,
        'Warm callers made an upstream request'
      );
      return { calls: 25, upstreamRequestIncrease: 0, counts: after };
    }
  );
  if (includeChat)
    await check(
      'Actual Luna weather flow preserves provider attribution and uses the warm cache',
      async () => {
        const { client } = load('src/services/openaiConfig');
        client.maxRetries = 0;
        client.timeout = 20000;
        const Simple = load('src/conversation/flow/SimpleChimpGPTFlow');
        const before = weatherService.getStats();
        const result = await Simple.prototype.handleWeatherRequest.call(
          { openaiClient: client, weatherService: { getWeatherResponse } },
          { get: () => 'You are Solvis, a concise friendly bot. Preserve supplied weather facts.' },
          {
            message: { content: 'weather in Auckland, New Zealand?', author: { id: 'smoke-test' } },
          }
        );
        insist(
          result.success && result.weatherData.source === 'open-meteo',
          'Luna weather flow failed'
        );
        insist(
          result.response.includes('https://open-meteo.com/'),
          'Attribution missing from final response'
        );
        insist(
          weatherService.getStats().forecastRequests === before.forecastRequests,
          'Luna weather flow refetched weather'
        );
        return {
          model: load('src/services/chatModel').CHAT_MODEL,
          responseCharacters: result.response.length,
          upstreamRequestIncrease: 0,
        };
      }
    );
  report.completedAt = new Date().toISOString();
  report.passed = report.checks.every(result => result.passed);
  report.finalCounts = weatherService.getStats();
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  weatherService.close();
  process.exit(report.passed ? 0 : 1);
})().catch(error => {
  console.error(error.code || error.name);
  process.exit(1);
});
