/**
 * Dad Jokes Plugin for ChimpGPT
 *
 * This plugin adds dad joke functionality to the ChimpGPT Discord bot.
 * It includes a slash command to get random dad jokes and can also
 * respond with dad jokes when users mention certain keywords.
 *
 * @version 1.0.0
 * @author Brett
 */

const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { createLogger } = require('../../core/logger');
const retryWithBreaker = require('../../../utils/retryWithBreaker');

// Create a logger for this plugin
const logger = createLogger('dad-jokes-plugin');

// Circuit breaker configuration for dad jokes API
const DAD_JOKES_BREAKER_CONFIG = {
  maxRetries: 2,
  breakerLimit: 5, // Open breaker after 5 consecutive failures
  breakerTimeoutMs: 120000, // 2 minutes timeout
  onBreakerOpen: error => {
    logger.error({ error }, 'Dad jokes API circuit breaker opened');
  },
};

// Dad joke trigger phrases (lowercase)
const DAD_JOKE_TRIGGERS = [
  "i'm hungry",
  'i am hungry',
  "i'm tired",
  'i am tired',
  "i'm bored",
  'i am bored',
  "i'm sad",
  'i am sad',
  "i'm happy",
  'i am happy',
];

/**
 * Fetch a random dad joke from the icanhazdadjoke API
 *
 * @returns {Promise<string>} A random dad joke
 */
async function getRandomDadJoke() {
  try {
    logger.debug('Using retryWithBreaker for dad joke API request');
    const response = await retryWithBreaker(async () => {
      logger.debug('Making dad joke API request');
      return await axios.get('https://icanhazdadjoke.com/', {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ChimpGPT Discord Bot (https://github.com/f0rky/Chimp-GPT)',
        },
      });
    }, DAD_JOKES_BREAKER_CONFIG);

    if (response.data && response.data.joke) {
      return response.data.joke;
    }

    return 'I had a joke, but I forgot it. Must be getting old!';
  } catch (error) {
    logger.error({ error }, 'Error fetching dad joke');
    return 'My joke generator is taking a nap. Try again later!';
  }
}

/**
 * Search for dad jokes based on a query
 *
 * @param {string} query - The search query
 * @returns {Promise<Array<string>>} An array of matching jokes
 */
async function searchDadJokes(query) {
  try {
    logger.debug('Using retryWithBreaker for dad joke search API request');
    const response = await retryWithBreaker(async () => {
      logger.debug('Making dad joke search API request');
      return await axios.get(`https://icanhazdadjoke.com/search`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ChimpGPT Discord Bot (https://github.com/f0rky/Chimp-GPT)',
        },
        params: {
          term: query,
          limit: 5,
        },
      });
    }, DAD_JOKES_BREAKER_CONFIG);

    if (response.data && response.data.results && response.data.results.length > 0) {
      return response.data.results.map(result => result.joke);
    }

    return ["I couldn't find any jokes about that. That's the real joke!"];
  } catch (error) {
    logger.error({ error }, 'Error searching for dad jokes');
    return ['My joke search engine is broken. No joke!'];
  }
}

/**
 * Check if a message contains a dad joke trigger
 *
 * @param {string} content - The message content
 * @returns {string|null} The matching trigger or null if no match
 */
function checkForDadJokeTrigger(content) {
  const lowerContent = content.toLowerCase();

  for (const trigger of DAD_JOKE_TRIGGERS) {
    if (lowerContent.includes(trigger)) {
      return trigger;
    }
  }

  return null;
}

/**
 * Generate a dad joke response for a trigger phrase
 *
 * @param {string} trigger - The trigger phrase
 * @returns {Promise<string>} The dad joke response
 */
async function generateDadJokeResponse(trigger) {
  // Extract the adjective from the trigger (e.g., "hungry" from "I'm hungry")
  const adjective = trigger.replace(/i['']m\s+|i\s+am\s+/i, '').trim();

  return `Hi ${adjective}, I'm ChimpGPT! 👋\n\nHere's a dad joke for you: ${await getRandomDadJoke()}`;
}

// Export the plugin
module.exports = {
  id: 'dad-jokes',
  name: 'Dad Jokes',
  version: '1.0.0',
  description: 'Adds dad joke functionality to ChimpGPT',
  author: 'Brett',

  // Register slash commands
  commands: [
    {
      name: 'dadjoke',
      description: 'Get a random dad joke',
      aliases: ['joke', 'dad', 'dadjokes'],
      dmAllowed: true,
      options: [
        {
          name: 'search',
          description: 'Search for dad jokes with a specific term',
          type: 3, // STRING type
          required: false,
        },
      ],

      // Add SlashCommandBuilder for Discord.js integration
      slashCommand: new SlashCommandBuilder()
        .setName('dadjoke')
        .setDescription('Get a random dad joke')
        .addStringOption(option =>
          option
            .setName('search')
            .setDescription('Search for dad jokes with a specific term')
            .setRequired(false)
        ),

      // Command execution for message commands
      execute: async (message, args) => {
        try {
          if (args && args.length > 0) {
            const searchQuery = args.join(' ');
            const jokes = await searchDadJokes(searchQuery);

            return message.reply(`Here's a dad joke about "${searchQuery}":\n\n${jokes[0]}`);
          }
          const joke = await getRandomDadJoke();
          return message.reply(`Here's a random dad joke:\n\n${joke}`);
        } catch (error) {
          logger.error({ error }, 'Error executing dad joke command');
          return message.reply("Failed to fetch a dad joke. That's not very punny!");
        }
      },

      // Command execution for slash commands
      interactionExecute: async interaction => {
        try {
          await interaction.deferReply();

          const searchQuery = interaction.options.getString('search');

          if (searchQuery) {
            const jokes = await searchDadJokes(searchQuery);

            return interaction.editReply({
              content: `Here's a dad joke about "${searchQuery}":\n\n${jokes[0]}`,
            });
          }
          const joke = await getRandomDadJoke();

          return interaction.editReply({
            content: `Here's a random dad joke:\n\n${joke}`,
          });
        } catch (error) {
          logger.error({ error }, 'Error executing dad joke slash command');
          return interaction.editReply({
            content: "Failed to fetch a dad joke. That's not very punny!",
          });
        }
      },
    },
  ],

  // Register functions
  functions: {
    getRandomDadJoke,
    searchDadJokes,
  },

  // Register hooks
  hooks: {
    // Process messages to look for dad joke triggers
    onMessageReceived: async message => {
      try {
        // Skip messages from bots
        if (message.author.bot) return true;

        // Check if the message contains a dad joke trigger
        const trigger = checkForDadJokeTrigger(message.content);

        if (trigger) {
          // 25% chance to respond with a dad joke
          if (Math.random() < 0.25) {
            const response = await generateDadJokeResponse(trigger);
            await message.reply(response);

            // Return false to prevent further processing
            return false;
          }
        }

        // Continue processing the message
        return true;
      } catch (error) {
        logger.error({ error }, 'Error in onMessageReceived hook');
        return true;
      }
    },
  },
};
