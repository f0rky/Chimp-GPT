const axios = require('axios');

async function lookupWeather(location) {

  const options = {
    method: 'GET',
    url: 'https://weatherapi-com.p.rapidapi.com/forecast.json',
    params: {
      q: location,
      days: '3'
    },
    headers: {
      'X-RapidAPI-Key': process.env.X_RAPIDAPI_KEY,
    '  X-RapidAPI-Host': 'weatherapi-com.p.rapidapi.com'
    }
  };

  try {
    const response = await axios.request(options);
    //console.log(response.data);
    let weather = response.data;
    //const currentTemp = weather.current.temp_f;
    //console.log(currentTemp);
    const weatherForecast = `Location: ${weather.location.name} \
    Current Temperature: ${weather.current.temp_c} \
    Condition: ${weather.current.condition.text}. \
    Low Today: ${weather.forecast.forecastday[0].day.mintemp_c} \
    High Today: ${weather.forecast.forecastday[0].day.maxtemp_c}`;
    return weatherForecast;
  } catch (error) {
    console.error(error);
    return "No forecast found";
  }
}

module.exports = lookupWeather;

