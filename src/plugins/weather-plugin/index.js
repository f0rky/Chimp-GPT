/**
 * Weather Plugin for ChimpGPT
 * Provides weather lookup as a Discord slash command and message command.
 * Uses the shared Open-Meteo service and validated response cache.
 */

const { SlashCommandBuilder } = require('discord.js');
const { lookupWeather: lookupSharedWeather } = require('../../services/weatherLookup');

async function lookupWeather(location) {
  const result = await lookupSharedWeather(location);
  if (!result.success) throw result.error;
  return result.data;
}

function formatWeatherResponse(weatherData) {
  if (!weatherData || !weatherData.location) return 'No weather data available.';
  const loc = weatherData.location;
  const cur = weatherData.current;
  return (
    `Weather for **${loc.name}, ${loc.region}, ${loc.country}**\n` +
    `> ${cur.condition.text}, ${cur.temp_c}°C\n` +
    `> Wind: ${cur.wind_kph} kph, Humidity: ${cur.humidity}%\n${weatherData.attribution}`
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
        try {
          const data = await lookupWeather(location);
          return message.reply(formatWeatherResponse(data));
        } catch {
          return message.reply('Weather is temporarily unavailable. Please try again later.');
        }
      },
      interactionExecute: async interaction => {
        const location = interaction.options.getString('location');
        await interaction.deferReply();
        try {
          const data = await lookupWeather(location);
          return interaction.editReply(formatWeatherResponse(data));
        } catch {
          return interaction.editReply(
            'Weather is temporarily unavailable. Please try again later.'
          );
        }
      },
    },
  ],
  functions: {
    lookupWeather,
  },
  hooks: {},
};
