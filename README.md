
# Chimp-GPT Discord Bot

Chimp-GPT is a Discord bot powered by OpenAI's API. The bot is designed to interact with users, provide weather information, tell the current time, display Quake Live server stats, and more.

## Features

- **Interactive Conversations**: Engage in dynamic conversations with the bot using natural language.
  Example: ask "Tell me a joke," and the bot will respond with a joke using GPT3.5.
- **Weather Lookup**: Ask the bot about current weather conditions for a location.
  Example: "What's the weather like in New York?"
- **Time Inquiry**: Find out the current time of a location by asking the bot.
  Example: "What time is it in London?"
- **Quake Live Server Stats**: Check the status of Quake Live servers.
  Example: "!serverstats" or ask "What are the current Quake servers?"
- **Wolfram Alpha Integration**: Get answers to factual and computational questions.
  Example: "What is the square root of 144?"

## Prerequisites

- Node.js and npm installed.
- An OpenAI API key.
- A Discord bot token.
- A RapidAPI key for weather lookups.

## Setup and Installation

1. **Clone the Repository**:
    ```bash
    git clone https://github.com/f0rky/Chimp-GPT
    cd Chimp-GPT
    ```

2. **Install Dependencies**:
    ```bash
    npm install
    ```

3. **Set Up Environment Variables**:
   Create a `.env` file in the root directory and set up the following environment variables (refer to `.env.example`):
   ```env
   DISCORD_TOKEN = your_discord_bot_token
   OPENAI_API_KEY = your_openai_api_key
   CHANNEL_ID = your_channel_id(s) # Single or comma-separated
   X_RAPIDAPI_KEY = your_rapidapi_key
   BOT_PERSONALITY = "Your bot's personality"
   IGNORE_MESSAGE_PREFIX = "." # Prefix to ignore messages
   LOADING_EMOJI = <a:loading:1139032461712556062> # say \:emoji: on discord to get this ID
   ```

4. **Set Up Bot Personality**:
   Modify the `BOT_PERSONALITY` variable in the code to define the personality and behavior of the bot as you see fit. (protip ChatGPT to create a persona!)

5. **Set Discord Channel ID**:
   Modify the `CHANNEL_ID` variable in the code to specify the Discord channel where the bot will operate in, this can be multiple (comma seperated)

6. **Run the Bot**:
    ```bash
    # Using npm
    npm start
    
    # Using PM2 (recommended for production)
    pm2 start chimpGPT.js --name chimpGPT
    pm2 save
    ```

The bot should now be running and ready to interact in your Discord server.

## Usage

1. **General Interaction**:
    Simply send a message in a channel where the bot is present to engage in a conversation.

2. **Weather Inquiry**:
    Ask the bot about the weather, for example: "What's the weather like in New York?"
    And it will use OpenAI's GPT-3.5 to provide a natural response using the RapidAPI accurate weather information.

3. **Time Inquiry**:
    Ask the bot for the current time, like: "Whats the time in New York?"
    And it will use OpenAI's GPT-3.5 to provide a natural response including the time.

4. **Quake Server Stats**:
    Use the command `!serverstats` or ask about Quake servers to get detailed information about active Quake Live servers, including player counts, maps, and ELO ratings.

5. **Wolfram Alpha Queries**:
    Ask factual or computational questions, and the bot will use Wolfram Alpha to provide accurate answers.

## Contributing

If you'd like to contribute to the development of Chimp-GPT, please fork the repository and submit a pull request.

## File Structure

- `chimpGPT.js` - Main Discord bot file
- `discordClient.js` - Discord client configuration
- `openaiConfig.js` - OpenAI API configuration
- `quakeLookup.js` - Quake Live server stats functionality
- `timeLookup.js` - Time lookup functionality
- `weatherLookup.js` - Weather lookup functionality
- `wolframLookup.js` - Wolfram Alpha integration
- `archive/` - Archived files for reference

## Configuration Options

### Quake Server Stats

You can configure the ELO display mode in `quakeLookup.js` by changing the `eloMode` value in the CONFIG object:

```javascript
const CONFIG = {
    // ELO display mode:
    // 0 = Off (don't show ELO)
    // 1 = Categorized (Scrub/Mid/Pro)
    // 2 = Actual ELO value
    eloMode: 1,
    maxServers: 3
};
```

## License

This project is licensed under the MIT License.
