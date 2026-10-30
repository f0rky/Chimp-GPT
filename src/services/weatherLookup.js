/** Shared current weather and real five-day forecasts from Open-Meteo. */
const { weatherService } = require('./weatherClient');
const { weather: weatherLogger } = require('../core/logger');
const functionResults = require('../core/functionResults');

async function lookup(location, days) {
  try {
    if (!Number.isInteger(days) || days < 1 || days > 5) {
      const error = new Error('Forecast days must be an integer from 1 to 5.');
      error.code = 'WEATHER_INVALID_DAYS';
      throw error;
    }
    const data = await weatherService.getWeather(location);
    data.forecast.forecastday = data.forecast.forecastday.slice(0, days);
    // Status storage is best-effort; a storage error must not trigger another
    // upstream request or turn valid cached weather into a failed lookup.
    try {
      await functionResults.storeResult(
        'weather',
        { location, days },
        {
          ...data,
          formatted: `Weather in ${data.location.name}: ${data.current.condition.text}, ${data.current.temp_c}°C`,
        }
      );
    } catch (error) {
      weatherLogger.warn({ code: error.code }, 'Unable to store weather result');
    }
    return { success: true, data };
  } catch (error) {
    weatherLogger.warn({ code: error.code, status: error.status }, 'Weather lookup unavailable');
    return { success: false, error, data: null };
  }
}

function lookupWeather(location) {
  return lookup(location, 5);
}

function lookupExtendedForecast(location, days = 5) {
  return lookup(location, Number(days));
}

module.exports = { lookupWeather, lookupExtendedForecast };
