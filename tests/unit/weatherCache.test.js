const assert = require('node:assert/strict');
const test = require('node:test');
const clientModule = require('../../src/services/weatherClient');
const { createWeatherService, CURRENT_TTL_MS, GEOCODING_TTL_MS } = clientModule;

function forecast() {
  return {
    timezone: 'Pacific/Auckland',
    current_units: { temperature_2m: '°C', relative_humidity_2m: '%', wind_speed_10m: 'km/h' },
    daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C' },
    current: {
      time: '2026-10-30T13:30',
      temperature_2m: 18,
      relative_humidity_2m: 50,
      wind_speed_10m: 12,
      weather_code: 2,
    },
    daily: {
      time: ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'],
      weather_code: [2, 61, 3, 0, 51],
      temperature_2m_max: [19, 17, 20, 21, 18],
      temperature_2m_min: [12, 11, 13, 14, 10],
    },
  };
}

function harness(options = {}) {
  let clock = Date.parse('2026-10-30T00:30:00Z');
  const calls = [];
  let responder = async (url, config) =>
    url.includes('geocoding-api')
      ? {
          status: 200,
          data: {
            results: [
              {
                name: config.params.name,
                latitude: -36.84853,
                longitude: 174.76349,
                country: 'New Zealand',
                admin1: 'Auckland',
              },
            ],
          },
        }
      : { status: 200, data: forecast() };
  const service = createWeatherService({
    now: () => clock,
    httpGet: async (url, config) => {
      calls.push({ url, params: config.params, timeout: config.timeout });
      return responder(url, config);
    },
    ...options,
  });
  return {
    service,
    calls,
    advance: ms => {
      clock += ms;
    },
    respond: fn => {
      responder = fn;
    },
  };
}

function facades(service, storeResult = async () => {}) {
  const stub = (name, exports) => {
    const id = require.resolve(name);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  };
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  stub('../../src/core/logger', { createLogger: () => log, weather: log });
  stub('../../src/core/functionResults', { storeResult });
  require.cache[require.resolve('../../src/services/weatherClient')].exports = {
    ...clientModule,
    weatherService: service,
  };
  for (const name of [
    '../../src/services/weatherLookup',
    '../../src/services/simplified-weather',
    '../../src/plugins/weather-plugin',
  ])
    delete require.cache[require.resolve(name)];
  return {
    ...require('../../src/services/weatherLookup'),
    ...require('../../src/services/simplified-weather'),
    plugin: require('../../src/plugins/weather-plugin'),
  };
}

test('normalized repeated locations cache one validated forecast and isolate caller mutations', async () => {
  const h = harness();
  const first = await h.service.getWeather(' Auckland,   New Zealand ');
  first.current.temp_c = 999;
  first.forecast.forecastday.length = 0;
  const second = await h.service.getWeather('AUCKLAND,New Zealand');
  assert.equal(second.current.temp_c, 18);
  assert.equal(second.forecast.forecastday.length, 5);
  assert.equal(second._isMock, undefined);
  assert.equal(second.source, 'open-meteo');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].timeout, 8000);
  assert.equal(h.calls[1].params.forecast_days, 5);
  assert.equal(h.calls[1].params.timezone, 'auto');
});

test('twenty simultaneous requests join the same geocoding and forecast work', async () => {
  const h = harness();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => h.service.getWeather('Auckland'))
  );
  assert.equal(results.length, 20);
  assert.equal(h.calls.length, 2);
  assert.ok(h.service.getStats().inFlightJoins >= 19);
});

test('location aliases share weather by coordinates while qualifiers keep distinct geocoding keys', async () => {
  const h = harness();
  await h.service.getWeather('Auckland');
  await h.service.getWeather('Auckland, New Zealand');
  assert.deepEqual(
    h.calls.map(call => call.params.name || 'forecast'),
    ['Auckland', 'forecast', 'Auckland, New Zealand']
  );
  assert.equal(h.service.getStats().forecastRequests, 1);
});

test('expiry refreshes weather on demand and retains geocoding until its own TTL', async () => {
  const h = harness();
  await h.service.getWeather('Auckland');
  h.advance(CURRENT_TTL_MS - 1);
  await h.service.getWeather('Auckland');
  assert.equal(h.calls.length, 2);
  h.advance(1);
  await h.service.getWeather('Auckland');
  assert.equal(h.calls.length, 3);
  assert.equal(h.service.getStats().geocodingRequests, 1);
  h.advance(GEOCODING_TTL_MS);
  await h.service.getWeather('Auckland');
  assert.equal(h.calls.length, 5);
});

test('malformed/null weather is never served or cached as success, and recovery retries only after cooldown', async () => {
  for (const invalid of [
    null,
    { ...forecast(), current: { ...forecast().current, temperature_2m: null } },
    { ...forecast(), current: { ...forecast().current, time: '2026-10-30T25:90' } },
    { ...forecast(), current_units: { ...forecast().current_units, temperature_2m: '°F' } },
    { ...forecast(), timezone: 'Unknown/Invalid' },
    { ...forecast(), daily: { ...forecast().daily, temperature_2m_max: [20] } },
  ]) {
    const h = harness();
    h.respond(async url =>
      url.includes('geocoding-api')
        ? { status: 200, data: { results: [{ name: 'Auckland', latitude: -36, longitude: 174 }] } }
        : { status: 200, data: invalid }
    );
    await assert.rejects(h.service.getWeather('Auckland'), { code: 'WEATHER_INVALID_RESPONSE' });
    await assert.rejects(h.service.getWeather('Auckland'), { code: 'WEATHER_INVALID_RESPONSE' });
    assert.equal(h.calls.length, 2);
    h.advance(30000);
    h.respond(async () => ({ status: 200, data: forecast() }));
    const recovered = await h.service.getWeather('Auckland');
    assert.equal(recovered.current.temp_c, 18);
    assert.equal(h.calls.length, 3);
  }
});

test('a 403 failure is not retried automatically or repeatedly polled', async () => {
  const h = harness();
  h.respond(async () => {
    const error = new Error('forbidden');
    error.response = { status: 403 };
    throw error;
  });
  await assert.rejects(h.service.getWeather('Auckland'), { code: 'WEATHER_UPSTREAM_ERROR' });
  await assert.rejects(h.service.getWeather('Auckland'), { code: 'WEATHER_UPSTREAM_ERROR' });
  assert.equal(h.calls.length, 1);
  h.advance(30000);
  await assert.rejects(h.service.getWeather('Auckland'));
  assert.equal(h.calls.length, 2);
});

test('expired data is not silently served when refresh fails', async () => {
  const h = harness();
  await h.service.getWeather('Auckland');
  h.advance(CURRENT_TTL_MS);
  h.respond(async () => {
    throw new Error('network unavailable');
  });
  await assert.rejects(h.service.getWeather('Auckland'), { code: 'WEATHER_UPSTREAM_ERROR' });
  await assert.rejects(h.service.getWeather('Auckland'), { code: 'WEATHER_UPSTREAM_ERROR' });
  assert.equal(h.calls.length, 3);
});

test('429 suppresses new locations globally while still serving fresh cached weather', async () => {
  const h = harness();
  await h.service.getWeather('Auckland');
  h.respond(async () => {
    const error = new Error('limited');
    error.response = { status: 429 };
    throw error;
  });
  await assert.rejects(h.service.getWeather('London'));
  const before = h.calls.length;
  await assert.rejects(h.service.getWeather('Tokyo'), { code: 'WEATHER_RATE_LIMITED' });
  assert.equal(h.calls.length, before);
  assert.equal((await h.service.getWeather('Auckland')).current.temp_c, 18);
});

test('invalid/missing location data never proceeds to the forecast endpoint', async () => {
  for (const data of [
    { results: [] },
    { results: [{ name: 'Invalid', latitude: null, longitude: 100 }] },
  ]) {
    const h = harness();
    h.respond(async () => ({ status: 200, data }));
    await assert.rejects(h.service.getWeather('Invalid'));
    await assert.rejects(h.service.getWeather('Invalid'));
    assert.equal(h.calls.length, 1);
  }
  const h = harness();
  for (const input of ['', null, 'A', 'City\nName', 'a'.repeat(121)])
    await assert.rejects(h.service.getWeather(input));
  assert.equal(h.calls.length, 0);
});

test('current, forecast, formatter and plugin all share the cache; prefetched wrappers never refetch', async () => {
  const h = harness();
  let lookups = 0;
  const getWeather = h.service.getWeather;
  h.service.getWeather = location => {
    lookups++;
    return getWeather(location);
  };
  const api = facades(h.service);
  const current = await api.lookupWeather('Auckland');
  const wrapped = await api.getWeatherResponse('Auckland', 'weather?', current);
  const direct = await api.getWeatherResponse('Auckland', 'weather?', current.data);
  assert.equal(lookups, 1);
  assert.equal(wrapped.weatherData.current.temp_c, 18);
  assert.equal(direct.weatherData.current.temp_c, 18);
  assert.match(direct.formattedSummary, /Open-Meteo/);
  const tomorrow = await api.lookupExtendedForecast('Auckland', 2);
  assert.equal(tomorrow.data.forecast.forecastday[1].day.maxtemp_c, 17);
  assert.equal(tomorrow.data.forecast.forecastday[1].day.condition.text, 'Slight rain');
  assert.equal(
    (await api.lookupExtendedForecast('Auckland', 5)).data.forecast.forecastday.length,
    5
  );
  assert.equal((await api.lookupWeather('Auckland')).data.forecast.forecastday.length, 5);
  assert.equal((await api.plugin.functions.lookupWeather('Auckland')).current.temp_c, 18);
  await api.getWeatherResponse('Auckland', 'five-day forecast');
  assert.equal(h.calls.length, 2);
});

test('failed prefetched lookups and mock data fail honestly without a second endpoint call', async () => {
  const h = harness();
  const api = facades(h.service);
  await assert.rejects(
    api.getWeatherResponse('Auckland', '', { success: false, error: new Error('unavailable') }),
    /unavailable/
  );
  await assert.rejects(api.getWeatherResponse('Auckland', '', { _isMock: true }), /Valid weather/);
  assert.equal(h.calls.length, 0);
  for (const days of [0, 6, 'invalid'])
    assert.equal((await api.lookupExtendedForecast('Auckland', days)).success, false);
  assert.equal(h.calls.length, 0);
});

test('status storage failure does not refetch, invalidate valid data, or fabricate weather', async () => {
  const h = harness();
  const api = facades(h.service, async () => {
    throw new Error('disk unavailable');
  });
  assert.equal((await api.lookupWeather('Auckland')).success, true);
  assert.equal((await api.lookupWeather('Auckland')).success, true);
  assert.equal(h.calls.length, 2);
});

test('bounded caches evict older locations without background traffic', async () => {
  const h = harness({ maxEntries: 2 });
  h.respond(async (url, config) =>
    url.includes('geocoding-api')
      ? {
          status: 200,
          data: {
            results: [
              {
                name: config.params.name,
                latitude: { Auckland: -36.8, Wellington: -41.3, Christchurch: -43.5 }[
                  config.params.name
                ],
                longitude: 174,
              },
            ],
          },
        }
      : { status: 200, data: forecast() }
  );
  for (const city of ['Auckland', 'Wellington', 'Christchurch']) await h.service.getWeather(city);
  const before = h.calls.length;
  await h.service.getWeather('Auckland');
  assert.equal(h.calls.length, before + 2);
  assert.equal(h.service.getStats().forecastRequests, 4);
});

test('both function processors unwrap weather once and pass prefetched data to formatting', async () => {
  const h = harness();
  facades(h.service);
  const stub = (name, exports) => {
    const id = require.resolve(name);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  };
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  stub('../../src/core/logger', { createLogger: () => log, weather: log, discord: log });
  stub('../../src/services/timeLookup', async () => 'time');
  stub('../../src/services/wolframLookup', {});
  stub('../../src/handlers/quakeStatsHandler', {});
  stub('../../src/handlers/imageGenerationHandler', {});
  stub('../../src/services/webSearch', {});
  stub('../../src/middleware/performanceMonitor', { startTimer: () => 'timer', stopTimer() {} });
  stub('../../src/middleware/rateLimiter', {
    checkUserRateLimit: async () => ({ limited: false }),
    constants: { IMAGE_GEN_POINTS: 3 },
  });
  stub('../../src/core/healthCheck', { trackApiCall() {}, trackError() {}, trackRateLimit() {} });
  delete require.cache[require.resolve('../../src/core/processors/pocketFlowFunctionProcessor')];
  delete require.cache[require.resolve('../../src/core/processors/functionCallProcessor')];
  const Processor = require('../../src/core/processors/pocketFlowFunctionProcessor');
  const processor = new Processor();
  const current = await processor.handleWeatherLookup({ location: 'Auckland' });
  assert.equal(current.temperature, '18°C');
  const extended = await processor.handleExtendedForecast({ location: 'Auckland', days: 2 });
  assert.equal(extended.forecast.length, 2);
  assert.equal(extended.forecast[1].maxTemp, '17°C');
  const { handleFunctionCall } = require('../../src/core/processors/functionCallProcessor');
  for (const functionName of ['lookupWeather', 'lookupExtendedForecast']) {
    const edits = [];
    const conversation = [{ role: 'user', content: 'weather forecast?' }];
    await handleFunctionCall(
      { functionName, parameters: { location: 'Auckland', days: 2 } },
      { edit: async content => edits.push(content) },
      conversation,
      'offline-user',
      Date.now(),
      { apiCalls: {} },
      null,
      '',
      { trackWeatherLookup() {} }
    );
    assert.equal(typeof edits.at(-1), 'string');
    assert.match(edits.at(-1), /Open-Meteo/);
    assert.equal(typeof conversation.at(-1).content, 'string');
  }
  assert.equal(h.calls.length, 2);
});
