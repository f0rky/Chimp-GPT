'use strict';

const axios = require('axios');
const https = require('node:https');

const CURRENT_TTL_MS = 10 * 60 * 1000;
const GEOCODING_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 30 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const FORECAST_DAYS = 5;
const ATTRIBUTION =
  'Source: [Open-Meteo](https://open-meteo.com/) · [GeoNames](https://www.geonames.org/)';
const WEATHER_CODES = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

function weatherError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizedLocation(location) {
  if (typeof location !== 'string' || location.length > 120 || /\p{Cc}/u.test(location)) {
    throw weatherError('WEATHER_INVALID_LOCATION', 'Please provide a valid city or location.');
  }
  const query = location
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .split(',')
    .map(part => part.trim())
    .join(', ');
  if (query.length < 2) {
    throw weatherError('WEATHER_INVALID_LOCATION', 'Please provide a valid city or location.');
  }
  return { query, key: query.toLowerCase() };
}

const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const knownCode = value => Number.isInteger(value) && Object.hasOwn(WEATHER_CODES, value);

function withWeatherAttribution(text, attribution) {
  if (!attribution || text?.includes(attribution)) return text;
  return `${text}\n${attribution}`;
}
const validDate = value =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

function validatePlace(response) {
  const place = response?.results?.[0];
  if (!place) {
    throw weatherError(
      'WEATHER_LOCATION_NOT_FOUND',
      'Location not found. Please include a city and country.'
    );
  }
  if (
    typeof place.name !== 'string' ||
    !place.name.trim() ||
    !inRange(place.latitude, -90, 90) ||
    !inRange(place.longitude, -180, 180)
  ) {
    throw weatherError(
      'WEATHER_INVALID_RESPONSE',
      'The weather location service returned invalid data.'
    );
  }
  return place;
}

function validTimezone(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function toWeatherData(response, place, fetchedAt) {
  const current = response?.current;
  const daily = response?.daily;
  const arrays = [
    daily?.time,
    daily?.weather_code,
    daily?.temperature_2m_max,
    daily?.temperature_2m_min,
  ];
  const validCurrent =
    current &&
    typeof current.time === 'string' &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(current.time) &&
    validDate(current.time.slice(0, 10)) &&
    inRange(current.temperature_2m, -100, 70) &&
    inRange(current.relative_humidity_2m, 0, 100) &&
    inRange(current.wind_speed_10m, 0, 500) &&
    knownCode(current.weather_code);
  if (
    !validCurrent ||
    !validTimezone(response.timezone) ||
    response.current_units?.temperature_2m !== '°C' ||
    response.current_units?.wind_speed_10m !== 'km/h' ||
    response.current_units?.relative_humidity_2m !== '%' ||
    response.daily_units?.temperature_2m_max !== '°C' ||
    response.daily_units?.temperature_2m_min !== '°C' ||
    !arrays.every(values => Array.isArray(values) && values.length === FORECAST_DAYS) ||
    daily.time[0] !== current.time.slice(0, 10) ||
    !daily.time.every(
      (date, index) =>
        validDate(date) &&
        (!index || Date.parse(date) - Date.parse(daily.time[index - 1]) === 86400000) &&
        knownCode(daily.weather_code[index]) &&
        inRange(daily.temperature_2m_min[index], -100, 70) &&
        inRange(daily.temperature_2m_max[index], -100, 70) &&
        daily.temperature_2m_min[index] <= daily.temperature_2m_max[index]
    )
  ) {
    throw weatherError(
      'WEATHER_INVALID_RESPONSE',
      'The weather service returned incomplete or invalid data.'
    );
  }
  return {
    source: 'open-meteo',
    attribution: ATTRIBUTION,
    fetchedAt: new Date(fetchedAt).toISOString(),
    location: {
      name: place.name,
      region: place.admin1 || '',
      country: place.country || place.country_code || '',
      lat: place.latitude,
      lon: place.longitude,
      timezone: response.timezone,
      localtime: current.time,
    },
    current: {
      temp_c: current.temperature_2m,
      humidity: current.relative_humidity_2m,
      wind_kph: current.wind_speed_10m,
      last_updated: current.time,
      condition: { text: WEATHER_CODES[current.weather_code], code: current.weather_code },
    },
    forecast: {
      forecastday: daily.time.map((date, index) => ({
        date,
        day: {
          maxtemp_c: daily.temperature_2m_max[index],
          mintemp_c: daily.temperature_2m_min[index],
          condition: {
            text: WEATHER_CODES[daily.weather_code[index]],
            code: daily.weather_code[index],
          },
        },
      })),
    },
  };
}

/**
 * One shared, demand-driven source for every weather caller in this process.
 * Cache validated data only; join in-flight requests and briefly suppress failed
 * requests separately. There is no background refresh and no automatic retry.
 */
function createWeatherService({
  httpGet = axios.get.bind(axios),
  now = Date.now,
  currentTtlMs = CURRENT_TTL_MS,
  geocodingTtlMs = GEOCODING_TTL_MS,
  failureCooldownMs = FAILURE_COOLDOWN_MS,
  maxEntries = 500,
} = {}) {
  const places = new Map();
  const forecasts = new Map();
  const failures = new Map();
  const pending = new Map();
  let rateLimitedUntil = 0;
  let agent;
  const counters = {
    geocodingRequests: 0,
    forecastRequests: 0,
    cacheHits: 0,
    inFlightJoins: 0,
    cooldownRejections: 0,
  };

  function put(cache, key, value, ttl) {
    cache.delete(key);
    cache.set(key, { value, expiresAt: now() + ttl });
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  function get(cache, key) {
    const entry = cache.get(key);
    if (!entry) return undefined;
    cache.delete(key);
    if (entry.expiresAt <= now()) return undefined;
    cache.set(key, entry);
    return entry.value;
  }

  async function cached(cache, key, ttl, fetchValue) {
    const value = get(cache, key);
    if (value !== undefined) {
      counters.cacheHits++;
      return value;
    }
    const failure = get(failures, key);
    if (failure) {
      counters.cooldownRejections++;
      throw failure;
    }
    if (pending.has(key)) {
      counters.inFlightJoins++;
      return pending.get(key);
    }
    if (pending.size >= maxEntries) {
      throw weatherError('WEATHER_BUSY', 'Weather service is busy. Please try again shortly.');
    }
    const pendingRequest = Promise.resolve()
      .then(fetchValue)
      .then(result => {
        put(cache, key, result, ttl);
        return result;
      })
      .catch(error => {
        put(failures, key, error, failureCooldownMs);
        throw error;
      })
      .finally(() => pending.delete(key));
    pending.set(key, pendingRequest);
    return pendingRequest;
  }

  async function request(url, params, counter) {
    if (rateLimitedUntil > now()) {
      counters.cooldownRejections++;
      throw weatherError(
        'WEATHER_RATE_LIMITED',
        'Weather service is temporarily rate limited. Please try again later.'
      );
    }
    // The geocoding host's IPv6 route times out on Solvis. Scope IPv4 to this
    // transport rather than changing global DNS or other providers' clients.
    agent ||= new https.Agent({
      family: 4,
      keepAlive: true,
      maxSockets: 4,
      maxFreeSockets: 2,
      timeout: 10000,
    });
    counters[counter]++;
    try {
      const response = await httpGet(url, { params, timeout: 8000, httpsAgent: agent });
      if (response.status !== 200)
        throw weatherError('WEATHER_UPSTREAM_ERROR', 'Weather service is temporarily unavailable.');
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      if (status === 429) rateLimitedUntil = now() + RATE_LIMIT_COOLDOWN_MS;
      if (error.code?.startsWith('WEATHER_')) throw error;
      const safe = weatherError(
        'WEATHER_UPSTREAM_ERROR',
        'Weather service is temporarily unavailable. Please try again later.'
      );
      safe.status = status;
      throw safe;
    }
  }

  async function getWeather(location) {
    const { query, key } = normalizedLocation(location);
    const place = await cached(places, `geo:${key}`, geocodingTtlMs, async () =>
      validatePlace(
        await request(
          'https://geocoding-api.open-meteo.com/v1/search',
          {
            name: query,
            count: 1,
            language: 'en',
            format: 'json',
          },
          'geocodingRequests'
        )
      )
    );
    const coordinates = `${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`;
    const data = await cached(forecasts, `forecast:${coordinates}`, currentTtlMs, async () =>
      toWeatherData(
        await request(
          'https://api.open-meteo.com/v1/forecast',
          {
            latitude: place.latitude,
            longitude: place.longitude,
            current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
            daily: 'weather_code,temperature_2m_max,temperature_2m_min',
            timezone: 'auto',
            forecast_days: FORECAST_DAYS,
            temperature_unit: 'celsius',
            wind_speed_unit: 'kmh',
          },
          'forecastRequests'
        ),
        place,
        now()
      )
    );
    return structuredClone(data);
  }

  return {
    getWeather,
    getStats: () => ({ ...counters }),
    close: () => agent?.destroy(),
  };
}

const weatherService = createWeatherService();
module.exports = {
  createWeatherService,
  weatherService,
  withWeatherAttribution,
  ATTRIBUTION,
  CURRENT_TTL_MS,
  GEOCODING_TTL_MS,
};
