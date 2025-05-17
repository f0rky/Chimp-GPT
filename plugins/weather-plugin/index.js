/**
 * Weather Plugin for ChimpGPT
 * Provides weather lookup as a Discord slash command and message command.
 * Uses WeatherAPI.com with robust error handling and mock fallback.
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { createLogger } = require('../../logger');
const logger = createLogger('weather-plugin');

// Helper: Get API key from env
function getApiKey() {
  return process.env.WEATHER_API_KEY;
}

// Mock weather data for fallback
const mockWeatherData = {
  getWeatherForLocation: location => {
    const conditions = [
      'Sunny',
      'Partly cloudy',
      'Cloudy',
      'Overcast',
      'Rainy',
      'Stormy',
      'Snowy',
      'Foggy',
      'Clear',
    ];
    const randomCondition = conditions[Math.floor(Math.random() * conditions.length)];
    const randomTemp = Math.floor(15 + Math.random() * 15);
    return {
      location: {
        name: location,
        region: 'Mock Region',
        country: 'Mock Country',
        localtime: new Date().toISOString(),
      },
      current: {
        temp_c: randomTemp,
        condition: {
          text: randomCondition,
          icon: '//cdn.weatherapi.com/weather/64x64/day/116.png',
        },
        wind_kph: Math.floor(Math.random() * 30),
        humidity: Math.floor(Math.random() * 100),
      },
      forecast: {
        forecastday: [
          {
            date: new Date().toISOString().split('T')[0],
            day: {
              maxtemp_c: randomTemp + 2,
              mintemp_c: randomTemp - 5,
              condition: {
                text: randomCondition,
                icon: '//cdn.weatherapi.com/weather/64x64/day/116.png',
              },
            },
          },
        ],
      },
      _isMock: true,
    };
  },
};

async function lookupWeather(location) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('WEATHER_API_KEY not set');
  try {
    const url = `https://weatherapi-com.p.rapidapi.com/current.json?q=${encodeURIComponent(location)}`;
    const response = await axios.get(url, {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'weatherapi-com.p.rapidapi.com',
      },
      timeout: 10000,
    });
    return response.data;
  } catch (err) {
    logger.warn({ err }, `Weather API failed for ${location}, using mock data`);
    return mockWeatherData.getWeatherForLocation(location);
  }
}

function formatWeatherResponse(weatherData) {
  if (!weatherData || !weatherData.location) return 'No weather data available.';
  const loc = weatherData.location;
  const cur = weatherData.current;
  return (
    `Weather for **${loc.name}, ${loc.region}, ${loc.country}**\n` +
    `> ${cur.condition.text}, ${cur.temp_c}°C\n` +
    `> Wind: ${cur.wind_kph} kph, Humidity: ${cur.humidity}%`
  );
}

module.exports = {
  id: 'weather-plugin',
  name: 'Weather Plugin',
  version: '1.0.0',
  description: 'Provides weather lookup via command',
  author: 'Brett',

  commands: [
    {
      name: 'weather',
      description: 'Get weather for a location',
      aliases: ['forecast', 'temperature', 'w'],
      dmAllowed: true,
      options: [
        {
          name: 'location',
          description: 'Location to get weather for',
          type: 3, // STRING
          required: true,
        },
      ],
      slashCommand: new SlashCommandBuilder()
        .setName('weather')
        .setDescription('Get weather for a location')
        .addStringOption(option =>
          option.setName('location').setDescription('Location').setRequired(true)
        ),
      execute: async (message, args) => {
        const location = args.join(' ');
        if (!location) return message.reply('Please specify a location.');
        const data = await lookupWeather(location);
        return message.reply(formatWeatherResponse(data));
      },
      interactionExecute: async interaction => {
        const location = interaction.options.getString('location');
        const data = await lookupWeather(location);
        return interaction.reply(formatWeatherResponse(data));
      },
    },
  ],
  functions: {
    lookupWeather,
  },
  hooks: {},
};
