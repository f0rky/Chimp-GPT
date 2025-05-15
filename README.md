
# Chimp-GPT Discord Bot

**Bot Version:** 1.0.0 <!-- BOT_VERSION -->

Chimp-GPT is a modular, extensible Discord bot powered by OpenAI's API. It supports a robust plugin system, weather and time lookups, Quake Live server stats, image generation, and more. The bot is designed for reliability, maintainability, and easy community contributions.

## Features

### Error Resilience for External APIs

OpenAI API calls are now protected by a retry mechanism with exponential backoff (up to 3 attempts) and a circuit breaker. If 5 consecutive failures occur, the circuit breaker will block further calls for 2 minutes and log the outage. This improves reliability and prevents API abuse during outages.


- **Plugin System**: Easily extend the bot with custom plugins for new commands, functions, and hooks. See [Plugin System](#plugin-system) below.
- **Interactive Conversations**: Engage in dynamic conversations using natural language (powered by GPT-3.5/4).
- **Weather Lookup**: Reliable weather info with robust error handling and fallback mechanisms.
- **Time Inquiry**: Ask for the current time in any location.
- **Quake Live Server Stats**: View real-time Quake Live server stats with compact, configurable display.
  - Emoji toggles and ELO display modes are fully configurable via environment variables.
  - Supports compact formatting to fit Discord's character limits and improved team/spectator presentation.
- **Image Generation**: Use DALL-E (2 & 3) to generate images directly from Discord, with a gallery view on the status page.
  - Gallery includes modal viewer, prompt context, keyboard/mouse/touch navigation, and robust error handling.
- **Wolfram Alpha Integration**: Ask factual or computational questions.
- **Status Page**: Real-time dashboard with stats, error logs, and an image gallery for generated images.
- **Comprehensive Error Handling & Logging**: All error handling and logging are now standardized across all major modules using Pino-based loggers. This ensures detailed, structured logs for easier debugging, monitoring, and reliability.
- **Slash Commands**: Full support for Discord slash commands, including plugin-provided commands.

## Plugin System

Chimp-GPT supports a powerful plugin architecture:
- Plugins are placed in the `plugins/` directory, each in its own folder.
- Each plugin exports metadata, commands, functions, and hooks.
- Example plugins and a template are provided in `plugins/README.md`.
- Plugins can add slash commands, message commands, and respond to bot lifecycle events.

### Creating a Plugin
1. Copy the template in `plugins/README.md`.
2. Create a new folder in `plugins/` and add your `index.js`.
3. Export an object with required fields (`id`, `name`, `version`) and optional `commands`, `functions`, and `hooks`.
4. Restart the bot to load your plugin.

### Plugin Validation
- Plugins are validated for required metadata and structure.
- See the [windsurf.config.js](#windsurf-configjs) for plugin validation rules.

## Status Page & Image Gallery
- Accessible via the configurable `STATUS_HOSTNAME` and `STATUS_PORT` (see Environment Variables below).
- Supports multi-instance deployment with automatic port fallback and remote access.
- The status page displays:
  - Bot uptime and live online/offline state
  - API call statistics and error logs
  - Image gallery with modal viewer, prompt display, and mobile support
  - Quake server stats, including emoji and ELO display options
- Responsive design and mobile-friendly, with robust error handling for all UI elements.

## Error Handling & Logging
- All API integrations feature robust error handling and fallbacks.
- Errors are logged using Pino-based structured loggers and shown on the status page.
- Logging is now standardized across all main modules (see checklist for logger migration progress).
- Graceful shutdown and recovery are implemented throughout the codebase.
- Test/CLI files may use console.error, but should be reviewed for consistency.

## Documentation & Type Safety
- Comprehensive JSDoc/type coverage across all major modules and plugin interfaces.
- Improved maintainability, developer onboarding, and static analysis.
- Please review and update the [`CHECKLIST.md`](./CHECKLIST.md) as you work on the project.

## Code Quality & Linting
- The project uses ESLint and Prettier for code quality.
- Linting and formatting rules are enforced via [windsurf.config.js](#windsurf-configjs).
- Security checks prevent secrets from being committed.
- Husky/pre-commit hooks and Prettier config are recommended (see checklist).

## windsurf.config.js

A `windsurf.config.js` file is provided at the project root to enforce code quality, plugin validation, and optional deployment rules. These are automatically checked in CI/CD and pre-commit hooks if configured:

## Environment Variables

The bot is configured via environment variables (see `.env.example`). Below is a summary of key variables and their defaults:

| Variable                  | Default        | Description                                                        |
|---------------------------|----------------|--------------------------------------------------------------------|
| BOT_NAME                  | CircuitChimp   | Name displayed on the status page and in Discord                   |
| STATUS_HOSTNAME           | localhost      | Hostname for the status page server                                |
| STATUS_PORT               | 3000           | Port for the status page server (auto-fallback for multiple bots)  |
| SHOW_TEAM_EMOJIS          | false          | Show team emojis in Quake stats player names                       |
| SHOW_SERVER_STATS_EMOJIS  | false          | Show emojis in Quake server info headers                           |
| ELO_DISPLAY_MODE          | 0              | ELO display: 0=off, 1=categorized, 2=actual values                |
| ...                       |                | See .env.example for full list and documentation                   |

- All environment variables are validated at startup.
- For multi-instance deployments, ports are automatically selected and hostname can be set for remote access.
- Emoji toggles and ELO display modes are configurable for Quake stats.

```js
// windsurf.config.js
module.exports = {
  lint: {
    enabled: true,
    tool: 'eslint',
    configFile: '.eslintrc.js',
    failOnError: true,
    include: ['**/*.js'],
    exclude: ['node_modules', 'archive', 'plugins/README.md']
  },
  prettier: {
    enabled: true,
    configFile: '.prettierrc',
    include: ['**/*.js', '**/*.json', '**/*.md'],
    exclude: ['node_modules', 'archive']
  },
  security: {
    checkSecrets: true,
    failOnSecret: true,
    exclude: ['.env.example', 'archive']
  },
  deploy: {
    enabled: false, // Set to true if using Windsurf for deployment
    provider: '', // e.g., 'netlify', 'vercel', or leave blank
    buildCommand: 'npm run build',
    publishDir: 'dist',
    env: ['DISCORD_TOKEN', 'OPENAI_API_KEY', 'X_RAPIDAPI_KEY', 'BOT_PERSONALITY', 'STATUS_HOSTNAME', 'STATUS_PORT']
  },
  plugins: {
    validate: true,
    pluginDir: 'plugins',
    requireId: true,
    requireVersion: true,
    requireDescription: false
  }
};
```

- **Linting**: ESLint is enforced on all JS files except excluded folders/files.
- **Formatting**: Prettier is run on JS, JSON, and Markdown files.
- **Security**: Checks for secrets in the codebase (excluding `.env.example` and `archive`).
- **Plugin Validation**: All plugins in the `plugins/` directory are checked for required fields and structure.
- **Deployment**: (Optional) Can be enabled for CI/CD deployment with supported providers.

## Implementation Checklist

A detailed implementation checklist is maintained in [`CHECKLIST.md`](./CHECKLIST.md). This tracks high, medium, and low priority tasks for code structure, security, performance, testing, developer experience, and deployment. Please review and update this file as you work on the project.

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
   Create a `.env` file in the root directory and set up the following environment variables (refer to `.env.example`).

4. **Linting & Code Quality**:
    - Before building or deploying, run the linter and fix all errors:
    ```bash
    npx eslint . --ext .js --max-warnings=0
    ```
    - The build/deploy process requires a successful lint (no errors).

5. **Run the Bot**:
    ```bash
    # Using PM2 (recommended)
    pm2 start chimpGPT.js --name chimpGPT --env development
    # Or for production
    pm2 start chimpGPT.js --name chimpGPT --env production
    ```

6. **Access the Status Page**:
    - Open your browser to `http://<STATUS_HOSTNAME>:<STATUS_PORT>`

## Contributing
- Contributions are welcome! Please follow the plugin template and code style guidelines.
- All PRs are automatically linted and checked for plugin validity.

## License
MIT

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
   LOG_LEVEL = "info" # Logging level (fatal, error, warn, info, debug, trace)
   # NODE_ENV = "production" # Uncomment in production to disable pretty printing
   ```

4. **Set Up Bot Personality**:
   Modify the `BOT_PERSONALITY` variable in the code to define the personality and behavior of the bot as you see fit. (protip ChatGPT to create a persona!)

5. **Set Discord Channel ID**:
   Modify the `CHANNEL_ID` variable in the code to specify the Discord channel where the bot will operate in, this can be multiple (comma seperated)

6. **Run the Bot**:
    ```bash
    # Using PM2 (recommended for all deployments)
    # For development environment
    pm2 start combined.js --name chimpGPT --env development
    
    # For production environment
    pm2 start combined.js --name chimpGPT --env production
    
    # Or use the ecosystem.config.js file
    pm2 start ecosystem.config.js
    
    # Save the PM2 configuration
    pm2 save
    
    # Check status
    pm2 status
    ```

The bot should now be running and ready to interact in your Discord server.

## Usage

1. **General Interaction**:
    Simply send a message in a channel where the bot is present to engage in a conversation. The bot implements a rate limiter that allows 30 requests per 30 seconds, with a 5-second cooldown after hitting the limit.

2. **Weather Inquiry**:
    Ask the bot about the weather, for example: "What's the weather like in New York?"
    And it will use OpenAI's GPT-3.5 to provide a natural response using the RapidAPI accurate weather information.

3. **Time Inquiry**:
    Ask the bot for the current time, like: "Whats the time in New York?"
    And it will use OpenAI's GPT-3.5 to provide a natural response including the time.

4. **Quake Server Stats**:
    Use the command `!serverstats` or `/serverstats` or ask about Quake servers to get detailed information about active Quake Live servers, including player counts, maps, and ELO ratings.

5. **Wolfram Alpha Queries**:
    Ask factual or computational questions, and the bot will use Wolfram Alpha to provide accurate answers.

6. **Slash Commands**:
    The bot supports Discord's slash commands. Type `/` to see available commands:
    - `/help` - Display information about available commands
    - `/ping` - Check if the bot is responding
    - `/serverstats` - Display Quake Live server statistics

## Recent Updates

- **Improved Weather API Integration**: Fixed issues with weather API authentication and implemented robust error handling with fallback mechanisms
- **Enhanced Rate Limiting**: Adjusted rate limits to 30 requests per 30 seconds with a 5-second cooldown
- **Fixed Server Count Detection**: Improved Quake server count detection for more accurate status updates
- **Added Timeout Protection**: Implemented timeout protection for OpenAI API calls to prevent the bot from getting stuck
- **Added Comprehensive Testing Tools**: Created test scripts for diagnosing and verifying API integrations
- Added support for Discord's slash commands
- Improved error handling and logging
- Enhanced Quake Live server stats display
- Added Wolfram Alpha integration

## Contributing

If you'd like to contribute to the development of Chimp-GPT, please fork the repository and submit a pull request.

## File Structure

### Core Files
- `chimpGPT.js` - Main Discord bot file
- `openaiConfig.js` - OpenAI API configuration
- `configValidator.js` - Environment variable validation
- `logger.js` - Structured logging configuration using Pino
- `rateLimiter.js` - Rate limiting for API calls
- `healthCheck.js` - Bot health monitoring system

### Feature Modules
- `quakeLookup.js` - Quake Live server stats functionality
- `timeLookup.js` - Time lookup functionality
- `weatherLookup.js` - Weather lookup functionality
- `wolframLookup.js` - Wolfram Alpha integration

### Command System
- `commands/commandHandler.js` - Command registration and routing
- `commands/deploySlashCommands.js` - Slash command deployment
- `commands/modules/` - Individual command implementations

### Utility Directories
- `utils/` - Utility scripts for maintenance and debugging
- `archive/` - Archived files for reference

## Configuration Options

### Logging

The bot uses Pino for structured JSON logging. You can configure the logging level in the `.env` file:

```env
# Available log levels: fatal, error, warn, info, debug, trace
LOG_LEVEL="info"

# Environment mode - set to 'production' or 'development'
NODE_ENV="development"
```

In development, logs are formatted with colors for better readability. In production (when `NODE_ENV` is set to "production"), logs are output as JSON for better integration with log management systems.

### Port Configuration

The bot uses different ports for its status and health endpoints based on the environment:

```env
# Server port configuration
# Production port (used when NODE_ENV=production)
PROD_PORT=3000
# Development port (used when NODE_ENV=development)
DEV_PORT=3001
```

This allows you to run multiple instances (development and production) on the same machine without port conflicts. The status page and health check endpoints will automatically use the appropriate port based on the `NODE_ENV` setting.

Each component of the application has its own logger instance for better organization and filtering:

- `discord` - Discord client events and interactions
- `openai` - OpenAI API requests and responses
- `quake` - Quake server stats functionality
- `weather` - Weather lookup functionality
- `wolfram` - Wolfram Alpha integration
- `time` - Time lookup functionality

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
