
# Chimp-GPT Discord Bot

Chimp-GPT is a Discord bot powered by OpenAI's API. The bot is designed to interact with users, provide weather information, tell the current time, and more.

## Features

- **Interactive Conversations**: Engage in dynamic conversations with the bot using natural language.
  Example: ask "Tell me a joke," and the bot will respond with a joke using GPT3.5.
- **Weather Lookup**: Ask the bot about current weather conditions for a location.
  Example: "What's the weather like in New York?"
- **Time Inquiry**: Find out the current time of a location by asking the bot
  Example: "What time is it in London?"

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
   Create a `.env` file in the root directory and set up the following environment variables (refer to `.env_example`):
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
    npm start
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

## Contributing

If you'd like to contribute to the development of Chimp-GPT, please fork the repository and submit a pull request.

## License

This project is licensed under the MIT License.

