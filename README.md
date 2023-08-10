
# Chimp-GPT Discord Bot

Chimp-GPT is a Discord bot powered by OpenAI's API. The bot is designed to interact with users, provide weather information, and tell the current time, among other functionalities.

## Features

- **Interactive Conversations**: Engage in dynamic conversations with the bot.
- **Weather Lookup**: Ask the bot about current weather conditions.
- **Time Inquiry**: Find out the current time by asking the bot.

## Prerequisites

- Node.js and npm installed.
- An OpenAI API key.
- A Discord bot token.
- A RapidAPI key for weather lookups.

## Setup and Installation

1. **Clone the Repository**:
    ```bash
    git clone [<repository-url>](https://github.com/f0rky/Chimp-GPT)
    cd Chimp-GPT
    ```

2. **Install Dependencies**:
    ```bash
    npm install
    ```

3. **Set Up Environment Variables**:
   Create a `.env` file in the root directory and set up the following environment variables:
    ```
    OPENAI_API_KEY=your_openai_api_key
    TOKEN=your_discord_bot_token
    X_RAPIDAPI_KEY=your_rapidapi_key
    ```
   
4. **Set Up Bot Personality**:
   Modify the `BOT_PERSONALITY` variable in the code to define the personality and behavior of the bot as you see fit.

5. **Set Discord Channel ID**:
   Modify the `CHANNEL_ID` variable in the code to specify the Discord channel where the bot will operate.

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

3. **Time Inquiry**:
    Ask the bot for the current time, like: "What time is it?"

## Contributing

If you'd like to contribute to the development of Chimp-GPT, please fork the repository and submit a pull request.

## License

This project is licensed under the MIT License.

