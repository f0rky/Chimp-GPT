/**
 * Demo Data Generator
 *
 * This module provides functions to generate mock data for demo mode.
 * It creates realistic-looking data for the status page without requiring
 * actual API calls or Discord connections.
 *
 * @module DemoDataGenerator
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../logger');
const logger = createLogger('demoData');

// Sample data for generating realistic mock responses
const SAMPLE_DATA = {
  locations: [
    'New York',
    'London',
    'Tokyo',
    'Sydney',
    'Paris',
    'Berlin',
    'Moscow',
    'Beijing',
    'Cairo',
    'Rio de Janeiro',
  ],
  weatherConditions: [
    'Sunny',
    'Partly cloudy',
    'Cloudy',
    'Overcast',
    'Light rain',
    'Heavy rain',
    'Thunderstorm',
    'Snowing',
    'Foggy',
    'Clear',
  ],
  temperatures: { min: -10, max: 40 },
  quakeServers: [
    { name: 'The Campgrounds', map: 'dm6', players: 6, spectators: 2 },
    { name: 'Longest Yard', map: 'q3dm17', players: 8, spectators: 1 },
    { name: 'Lost World', map: 'dm7', players: 4, spectators: 0 },
  ],
  wolframQueries: [
    'population of France',
    'distance from Earth to Moon',
    'solve x^2 + 5x + 6 = 0',
    'boiling point of water',
    'GDP of Japan',
  ],
  imagePrompts: [
    'A futuristic city with flying cars',
    'A peaceful mountain landscape at sunset',
    'A cyberpunk cat wearing VR goggles',
    'An underwater civilization with mermaids',
  ],
};

/**
 * Generate a random number between min and max (inclusive)
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Random number
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Pick a random item from an array
 * @param {Array} array - Array to pick from
 * @returns {*} Random item
 */
function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Generate mock weather data
 * @returns {Object} Mock weather data
 */
function generateWeatherData() {
  const location = randomItem(SAMPLE_DATA.locations);
  const condition = randomItem(SAMPLE_DATA.weatherConditions);
  const temperature = randomInt(SAMPLE_DATA.temperatures.min, SAMPLE_DATA.temperatures.max);
  const humidity = randomInt(30, 90);
  const windSpeed = randomInt(0, 30);

  return {
    location,
    current: {
      condition: { text: condition },
      temp_c: temperature,
      humidity,
      wind_kph: windSpeed,
      last_updated: new Date().toISOString(),
    },
    forecast: {
      forecastday: Array(3)
        .fill()
        .map((_, i) => ({
          date: new Date(Date.now() + i * 86400000).toISOString().split('T')[0],
          day: {
            condition: { text: randomItem(SAMPLE_DATA.weatherConditions) },
            maxtemp_c: temperature + randomInt(-5, 5),
            mintemp_c: temperature + randomInt(-10, 0),
            daily_chance_of_rain: randomInt(0, 100),
          },
        })),
    },
  };
}

/**
 * Generate mock Quake server data
 * @returns {Array} Array of mock Quake servers
 */
function generateQuakeData() {
  return SAMPLE_DATA.quakeServers.map(server => {
    const redScore = randomInt(0, 10);
    const blueScore = randomInt(0, 10);

    return {
      ...server,
      redScore,
      blueScore,
      status:
        redScore > blueScore
          ? 'Red team leading'
          : blueScore > redScore
            ? 'Blue team leading'
            : 'Teams tied',
      players: Array(server.players)
        .fill()
        .map((_, i) => ({
          name: `Player${i + 1}`,
          score: randomInt(0, 20),
          ping: randomInt(10, 150),
          team: i % 2 === 0 ? 'red' : 'blue',
          elo: randomInt(800, 1600),
        })),
      spectators: Array(server.spectators)
        .fill()
        .map((_, i) => ({
          name: `Spectator${i + 1}`,
        })),
    };
  });
}

/**
 * Generate mock Wolfram Alpha data
 * @returns {Object} Mock Wolfram Alpha response
 */
function generateWolframData() {
  const query = randomItem(SAMPLE_DATA.wolframQueries);
  const answers = {
    'population of France':
      'The population of France is approximately 67.75 million people (2023 estimate).',
    'distance from Earth to Moon':
      'The average distance from Earth to the Moon is 384,400 kilometers (238,855 miles).',
    'solve x^2 + 5x + 6 = 0': 'The solutions are x = -2 and x = -3.',
    'boiling point of water':
      'The boiling point of water at standard pressure (1 atm) is 100°C (212°F).',
    'GDP of Japan': 'The GDP of Japan is approximately $5.38 trillion USD (2023 estimate).',
  };

  return {
    query,
    answer: answers[query] || `Result for ${query}: ${randomInt(1000, 9999)}`,
  };
}

/**
 * Generate mock image generation data
 * @returns {Object} Mock image generation result
 */
function generateImageData() {
  const prompt = randomItem(SAMPLE_DATA.imagePrompts);
  return {
    prompt,
    model: randomInt(0, 1) === 0 ? 'dall-e-2' : 'dall-e-3',
    size: randomItem(['256x256', '512x512', '1024x1024']),
    url: `https://example.com/mock-image-${Date.now()}.png`,
    created: Date.now(),
  };
}

/**
 * Generate a set of mock function results for demo mode
 * @returns {Object} Mock function results
 */
function generateFunctionResults() {
  return {
    weather: Array(randomInt(3, 8))
      .fill()
      .map(() => ({
        input: { location: randomItem(SAMPLE_DATA.locations) },
        result: generateWeatherData(),
        timestamp: Date.now() - randomInt(0, 86400000),
      })),
    quake: Array(randomInt(2, 5))
      .fill()
      .map(() => ({
        input: { serverFilter: '' },
        result: generateQuakeData(),
        timestamp: Date.now() - randomInt(0, 86400000),
      })),
    wolfram: Array(randomInt(3, 7))
      .fill()
      .map(() => ({
        input: { query: randomItem(SAMPLE_DATA.wolframQueries) },
        result: generateWolframData(),
        timestamp: Date.now() - randomInt(0, 86400000),
      })),
    dalle: Array(randomInt(2, 6))
      .fill()
      .map(() => ({
        input: { prompt: randomItem(SAMPLE_DATA.imagePrompts) },
        result: generateImageData(),
        timestamp: Date.now() - randomInt(0, 86400000),
      })),
  };
}

/**
 * Generate mock stats data for demo mode
 * @returns {Object} Mock stats data
 */
function generateStatsData() {
  // Create a start time between 1-7 days ago
  const startTime = new Date(Date.now() - randomInt(1, 7) * 86400000);

  return {
    startTime,
    messageCount: randomInt(100, 5000),
    apiCalls: {
      openai: randomInt(500, 3000),
      weather: randomInt(50, 300),
      time: randomInt(20, 100),
      wolfram: randomInt(30, 200),
      quake: randomInt(100, 500),
      dalle: randomInt(10, 100),
    },
    errors: {
      openai: randomInt(0, 20),
      discord: randomInt(0, 5),
      weather: randomInt(0, 10),
      time: randomInt(0, 5),
      wolfram: randomInt(0, 8),
      quake: randomInt(0, 15),
      dalle: randomInt(0, 7),
      other: randomInt(0, 10),
    },
    rateLimits: {
      hit: randomInt(0, 50),
      users: new Set(
        Array(randomInt(1, 10))
          .fill()
          .map((_, i) => `User${i + 1}`)
      ),
    },
    lastRestart: new Date(Date.now() - randomInt(0, 86400000)),
    pluginErrors: {
      'dad-jokes': {
        count: randomInt(0, 5),
        hooks: {
          onMessageReceived: randomInt(0, 3),
        },
      },
      version: {
        count: randomInt(0, 2),
        hooks: {},
      },
    },
  };
}

/**
 * Initialize demo mode with mock data
 * @param {Object} stats - Stats object to populate with mock data
 * @param {Object} functionResults - Function results object to populate with mock data
 */
function initDemoMode(stats, functionResults) {
  logger.info('Initializing demo mode with mock data');

  // Generate mock stats
  const mockStats = generateStatsData();

  // Copy mock stats to the real stats object
  Object.assign(stats, mockStats);

  // Set up periodic updates for demo mode
  setInterval(() => {
    // Increment message count
    stats.messageCount += randomInt(1, 5);

    // Randomly increment API calls
    const apiTypes = Object.keys(stats.apiCalls);
    const randomApi = randomItem(apiTypes);
    stats.apiCalls[randomApi] += 1;

    // Occasionally add an error
    if (randomInt(1, 20) === 1) {
      const errorTypes = Object.keys(stats.errors);
      const randomError = randomItem(errorTypes);
      stats.errors[randomError] += 1;
    }

    // Occasionally add a rate limit hit
    if (randomInt(1, 50) === 1) {
      stats.rateLimits.hit += 1;
      stats.rateLimits.users.add(`User${randomInt(1, 20)}`);
    }

    logger.debug('Updated demo stats');
  }, 5000);

  // Generate mock function results and add them to the store
  const mockResults = generateFunctionResults();

  // Add mock function results
  Object.keys(mockResults).forEach(type => {
    mockResults[type].forEach(result => {
      functionResults.storeResult(type, result.input, result.result, result.timestamp);
    });
  });

  // Set up periodic additions of new function results
  setInterval(() => {
    const functionTypes = Object.keys(mockResults);
    const randomType = randomItem(functionTypes);

    let mockResult;
    switch (randomType) {
      case 'weather':
        mockResult = {
          input: { location: randomItem(SAMPLE_DATA.locations) },
          result: generateWeatherData(),
        };
        break;
      case 'quake':
        mockResult = {
          input: { serverFilter: '' },
          result: generateQuakeData(),
        };
        break;
      case 'wolfram':
        mockResult = {
          input: { query: randomItem(SAMPLE_DATA.wolframQueries) },
          result: generateWolframData(),
        };
        break;
      case 'dalle':
        mockResult = {
          input: { prompt: randomItem(SAMPLE_DATA.imagePrompts) },
          result: generateImageData(),
        };
        break;
      default:
        logger.warn(`Unexpected function type: ${randomType}`);
        return; // Skip this iteration if the type is unknown
    }

    if (mockResult) {
      functionResults.storeResult(randomType, mockResult.input, mockResult.result);
      logger.debug(`Added new mock ${randomType} result`);
    }
  }, 30000);

  logger.info('Demo mode initialized successfully');
}

module.exports = {
  initDemoMode,
  generateWeatherData,
  generateQuakeData,
  generateWolframData,
  generateImageData,
  generateStatsData,
};
