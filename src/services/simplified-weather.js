/** Format shared weather data without issuing a second upstream request. */
const { lookupWeather } = require('./weatherLookup');
const { withWeatherAttribution } = require('./weatherClient');

async function getWeatherResponse(location, userQuestion, prefetchedWeatherData = null) {
  const result = prefetchedWeatherData ?? (await lookupWeather(location));
  if (result.success === false)
    throw result.error || new Error('Weather is temporarily unavailable.');
  const data = result.data || result;
  if (
    data._isMock ||
    !data.location?.name ||
    !data.current?.condition?.text ||
    !Number.isFinite(data.current.temp_c)
  ) {
    throw new Error('Valid weather data is unavailable.');
  }
  const current = data.current;
  let summary = `Weather in ${data.location.name}: ${current.condition.text}, ${current.temp_c}°C, humidity ${current.humidity}%, wind ${current.wind_kph} km/h.`;
  const forecast = data.forecast?.forecastday || [];
  if (/forecast|tomorrow|week|\b[2-5][ -]?day/i.test(userQuestion || '')) {
    summary +=
      '\nForecast: ' +
      forecast
        .map(
          ({ date, day }) =>
            `${date}: ${day.condition.text}, high ${day.maxtemp_c}°C, low ${day.mintemp_c}°C`
        )
        .join('; ');
  }
  return {
    weatherData: data,
    formattedSummary: withWeatherAttribution(summary, data.attribution),
    attribution: data.attribution,
    userQuestion,
    type: 'weather_function_result',
  };
}

module.exports = { getWeatherResponse };
