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

async function lookupExtendedForecast(location) {

  const options = {
    method: 'GET',
    url: 'https://weatherapi-com.p.rapidapi.com/forecast.json',
    params: {
      q: location,
      days: '5'  // Looking up forecast for the next 5 days
    },
    headers: {
      'X-RapidAPI-Key': process.env.X_RAPIDAPI_KEY,
      'X-RapidAPI-Host': 'weatherapi-com.p.rapidapi.com'
    }
  };

  try {
    const response = await axios.request(options);
    let weather = response.data;

    // Format the forecast for each day
    let forecasts = [];
    for (let day of weather.forecast.forecastday) {
      forecasts.push(`Date: ${day.date} - Low: ${day.day.mintemp_c}C, High: ${day.day.maxtemp_c}C, Condition: ${day.day.condition.text}`);
    }
    return `Location: ${weather.location.name}\n` + forecasts.join('\n');

  } catch (error) {
    console.error(error);
    return "No extended forecast found";
  }
}


module.exports = {
    lookupWeather,
    lookupExtendedForecast
};

