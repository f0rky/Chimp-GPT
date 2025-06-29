# Chimp-GPT Discord Bot

**Bot Version:** 1.8.1 <!-- BOT_VERSION --> (defined in [package.json](./package.json))

Chimp-GPT is a modular, extensible Discord bot powered by OpenAI's API. It supports a robust plugin system, weather and time lookups, Quake Live server stats, image generation, and more. The bot is designed for reliability, maintainability, and easy community contributions.

## Features

### Docker & CI/CD Support

ChimpGPT now includes Docker support for easy deployment and GitHub Actions workflows for CI/CD:

- **Docker Integration**: Complete with Dockerfile and docker-compose.yml for containerized deployment
- **GitHub Actions**: Automated testing, linting, and Docker image building/publishing
- **Deployment Documentation**: Comprehensive guide for Docker-based deployment

See [Docker Deployment](#docker-deployment) for more details.

### Flexible Run Modes

ChimpGPT supports multiple run modes via command-line arguments:

- **Production Mode**: Optimized for production environments with minimal logging
- **Development Mode**: Enhanced debugging and verbose logging for development
- **Test Mode**: Runs the test suite without starting the bot or status server
- **Demo Mode**: Generates mock data for the status page without requiring API keys

Additional options include component-specific startup (bot-only, status-only), debug logging, and quiet mode. See [Run Modes](#run-modes) for more details.

### Enhanced Status Updates

ChimpGPT features a dynamic status system that provides real-time feedback on bot activities:

- **Contextual Status**: Bot status updates based on current activities and conversations
- **Progressive Updates**: Status changes to reflect ongoing operations and their progress
- **Rate-Limited Updates**: Optimized update frequency to avoid Discord API rate limits
- **Owner Privileges**: Special rate limit exemptions for bot owners

### Reply Context Enhancement

ChimpGPT now includes an intelligent reply context feature that makes conversations more natural and contextually aware:

- **Message Reference Resolution**: Automatically detects when users reply to messages and follows the reply chain
- **Context Extraction**: Extracts conversation context from referenced messages to maintain conversation flow
- **Configurable Depth**: Control how far back the bot looks for context in message reply chains
- **Intelligent Pruning**: Maintains conversation length limits while preserving important context

This feature makes the bot more conversationally aware, allowing it to understand ongoing discussions even when they involve multiple messages or users.

### Blended Conversation Mode

ChimpGPT supports a unique blended conversation mode that enhances group interactions:

- **Multi-User Context**: Combines messages from multiple users in a channel into a shared conversation context
- **Per-User Message Limits**: Each user's last 5 messages are retained to prevent any single user from dominating the conversation
- **Chronological Ordering**: Messages are organized chronologically across all users for natural conversation flow
- **Individual DMs**: Direct messages remain private and maintain individual conversation contexts
- **Configurable**: Toggle between blended and individual modes via environment variables

This feature creates a more natural group conversation experience where the bot can understand context from multiple users interacting together in the same channel.

### Conversation Mode Configuration

ChimpGPT's conversation behavior is controlled by two key settings that work together:

#### **Setting Interaction Matrix**

| `USE_BLENDED_CONVERSATIONS` | `ENABLE_REPLY_CONTEXT` | **Result Mode** | **Description** |
|------------------------------|------------------------|-----------------|-----------------|
| `true` | `true` | **Blended with Reply Context** | Group conversations + reply chain following |
| `true` | `false` | **Blended Only** | Group conversations without reply context |
| `false` | `true` | **Individual with Reply Context** | 1-on-1 conversations + reply chains |
| `false` | `false` | **Individual Only** | Traditional individual bot conversations |

#### **Setting Details**

- **`USE_BLENDED_CONVERSATIONS`**: When enabled, combines messages from ALL users in a channel into shared context (max 5 messages per user to prevent dominance)
- **`ENABLE_REPLY_CONTEXT`**: When enabled, bot follows Discord reply chains to understand conversation context and thread relationships

#### **Mode Visibility**

The current conversation mode is displayed across all status pages:
- **Main Status Page**: Header shows mode with hover details (e.g., "💬 Blended with Reply Context")
- **Performance Dashboard**: Header displays mode with configuration tooltip
- **Settings Dashboard**: Shows detailed conversation configuration
- **Startup Logs**: Bot logs current mode configuration on startup
- **API Endpoints**: `/health` includes `conversationMode` object for monitoring

### Recent Improvements (v1.7.0)

- **Circuit Breaker Pattern**: Implemented across all external API integrations for enhanced resilience and automatic failure recovery
- **Unified Dashboard**: Merged all dashboards into a single tabbed interface with Status, Performance, Functions, and Settings tabs
- **Pre-moderation for Images**: Client-side content filtering prevents waiting for slow API moderation responses
- **Image Generation Timeout**: Added 30-second timeout to prevent indefinite waiting on slow image generation
- **Dashboard Response Time Fix**: Fixed API response time display issues in the performance dashboard
- **Content Policy Handling**: Improved handling of violations with instant feedback instead of long waits

### Circuit Breaker Pattern for External APIs

All external API calls are protected by a comprehensive circuit breaker pattern with retry mechanisms:

- **OpenAI API**: Up to 3 retry attempts with circuit breaker opening after 5 consecutive failures (2-minute timeout)
- **Weather API**: Up to 2 retry attempts with circuit breaker opening after 5 consecutive failures (2-minute timeout)  
- **Wolfram Alpha API**: Up to 2 retry attempts with circuit breaker opening after 5 consecutive failures (2-minute timeout)
- **Time API**: Up to 2 retry attempts with circuit breaker opening after 5 consecutive failures (2-minute timeout)
- **Quake Server Stats API**: Up to 2 retry attempts with circuit breaker opening after 5 consecutive failures (3-minute timeout)
- **Image Generation**: Up to 1 retry attempt with circuit breaker opening after 5 consecutive failures (2-minute timeout)
  - Includes 30-second timeout for individual requests
  - Pre-moderation to reject problematic content instantly

When a circuit breaker opens, it blocks further calls for the specified timeout period and logs the outage. This improves reliability, prevents cascading failures, and provides automatic recovery when services come back online.

- **Plugin System**: Easily extend the bot with custom plugins for new commands, functions, and hooks. See [Plugin System](#plugin-system) below.
- **Circuit Breaker Pattern**: All external APIs protected with automatic failure detection and recovery:
  - Prevents cascading failures when services are down
  - Automatic recovery after timeout period
  - Configurable retry attempts and backoff strategies
  - Per-service configuration (OpenAI, Weather, Wolfram, Image Generation, etc.)
- **Interactive Conversations**: Engage in dynamic conversations using natural language (powered by GPT o4-mini).
- **Weather Lookup**: Reliable weather info with robust error handling and fallback mechanisms.
- **Time Inquiry**: Ask for the current time in any location.
- **Quake Live Server Stats**: View real-time Quake Live server stats with compact, configurable display.
  - Emoji toggles and ELO display modes are fully configurable via environment variables.
  - Supports compact formatting to fit Discord's character limits and improved team/spectator presentation.
- **Image Generation**: Use GPT Image-1 to generate high-quality images directly from Discord, with a gallery view on the status page.
  - Graceful fallback to text descriptions when image generation is disabled
  - Configurable via `ENABLE_IMAGE_GENERATION` environment variable
  - Real-time progress tracking with elapsed time reporting
  - Comprehensive error handling for content policy violations
  - Gallery includes modal viewer, prompt context, keyboard/mouse/touch navigation, and robust error handling.
- **Wolfram Alpha Integration**: Ask factual or computational questions.
- **Status Page**: Real-time dashboard with stats, error logs, and an image gallery for generated images.
- **Comprehensive Error Handling & Logging**: All error handling and logging are now standardized across all major modules using Pino-based loggers. This ensures detailed, structured logs for easier debugging, monitoring, and reliability.
- **Persistent Conversation History**: Conversations are now saved to disk and loaded when the bot restarts, ensuring continuity across restarts.
  - Automatic pruning of old conversations to manage storage efficiently
  - Backup and recovery mechanisms for corrupted conversation files
  - Status reporting via the health endpoint for monitoring
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

### Dashboard Features & Performance Optimizations

The status dashboard has been extensively optimized for bandwidth efficiency and user experience:

#### **Bandwidth Optimization (99.99% Reduction)**
- **Before**: ~300 Mbps bandwidth usage (47MB data transfers every 2-5 seconds)
- **After**: ~6 Kbps bandwidth usage (efficient summary data every 10 seconds)
- **Function Results**: Smart summary display with on-demand detail loading
- **Update Intervals**: Optimized from 2-5 seconds to 10-15 seconds

#### **Unified Dashboard (`/dashboard/`)**
- **Single tabbed interface** combining all dashboards:
  - **Status Tab**: Bot uptime, API statistics, and system health
  - **Performance Tab**: Real-time metrics with interactive charts  
  - **Functions Tab**: Function call summaries and image gallery
  - **Settings Tab**: Configuration validation with security masking
- **Mobile-responsive design** with optimized touch interactions
- **Dark/light theme toggle** with persistent user preferences
- **Blocked user management** with owner-authenticated unblock functionality
- **Smart polling**: Different update frequencies for different data types
- **Debug console** at bottom left for troubleshooting
- **Conversation mode display** across all pages with detailed tooltips

#### **Efficient Data Display**
- **Summary View**: Shows function call counts and last usage times by default
- **Details on Demand**: "📋 View Details" buttons load full data only when needed
- **Image Gallery**: Optimized image loading with modal viewer
- **Performance History**: Hourly and daily aggregated performance data

#### **Settings Dashboard (`/dashboard/` → Settings Tab)**
- **Configuration Validation**: Shows all environment variables with validation status
- **Security Masking**: Sensitive data (API keys, tokens) displayed as `●●●●●●●●` but shows if valid
- **Status Indicators**: Required vs Optional badges, Set/Missing/Invalid/Default status
- **Interactive Filtering**: Filter by All/Required/Optional/Issues for focused troubleshooting
- **Configuration Drift Detection**: Identifies unused or deprecated environment variables
- **Real-time Validation**: Shows which variables are actually being used by the code

## Error Handling & Logging

- All API integrations feature robust error handling and fallbacks.
- Errors are logged using Pino-based structured loggers and shown on the status page.
- Logging is now standardized across all main modules (see checklist for logger migration progress).
- Graceful shutdown and recovery are implemented throughout the codebase.
- Test/CLI files may use console.error, but should be reviewed for consistency.

## Documentation & Type Safety

- Comprehensive JSDoc/type coverage across all major modules and plugin interfaces.
- Improved maintainability, developer onboarding, and static analysis.
- Please review and update the [`CHECKLIST.md`](./docs/CHECKLIST.md) as you work on the project.

## Code Quality & Linting

- The project uses ESLint and Prettier for code quality.
- Linting and formatting rules are enforced via [windsurf.config.js](#windsurf-configjs).
- Security checks prevent secrets from being committed.
- Husky/pre-commit hooks and Prettier config are recommended (see checklist).

## windsurf.config.js

A `windsurf.config.js` file is provided at the project root to enforce code quality, plugin validation, and optional deployment rules. These are automatically checked in CI/CD and pre-commit hooks if configured:

## Environment Variables

The bot is configured via environment variables (see `.env.example`). Below is a summary of key variables and their defaults:

| Variable                 | Default      | Description                                                       |
| ------------------------ | ------------ | ----------------------------------------------------------------- |
| BOT_NAME                 | CircuitChimp | Name displayed on the status page and in Discord                  |
| STATUS_HOSTNAME          | localhost    | Hostname for the status page server                               |
| STATUS_PORT              | 3000         | Port for the status page server (auto-fallback for multiple bots) |
| SHOW_TEAM_EMOJIS         | false        | Show team emojis in Quake stats player names                      |
| SHOW_SERVER_STATS_EMOJIS | false        | Show emojis in Quake server info headers                          |
| ELO_DISPLAY_MODE         | 0            | ELO display: 0=off, 1=categorized, 2=actual values                |
| ENABLE_IMAGE_GENERATION  | true         | Enable/disable image generation (falls back to text descriptions)  |
| DISABLE_PLUGINS          | true         | Set to 'false' to enable plugins or 'true' to disable them        |
| WEATHER_API_KEY          | (required)   | API key for weather lookups via weatherapi.com                    |
| WOLFRAM_APP_ID           | (required)   | Wolfram Alpha App ID for computational queries                     |
| USE_BLENDED_CONVERSATIONS| true         | Enable blended conversation mode for group chats                   |
| MAX_MESSAGES_PER_USER_BLENDED | 5      | Maximum messages per user in blended conversation mode             |
| ...                      |              | See .env.example for full list and documentation                  |

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
    exclude: ['node_modules', 'archive', 'plugins/README.md'],
  },
  prettier: {
    enabled: true,
    configFile: '.prettierrc',
    include: ['**/*.js', '**/*.json', '**/*.md'],
    exclude: ['node_modules', 'archive'],
  },
  security: {
    checkSecrets: true,
    failOnSecret: true,
    exclude: ['.env.example', 'archive'],
  },
  deploy: {
    enabled: false, // Set to true if using Windsurf for deployment
    provider: '', // e.g., 'netlify', 'vercel', or leave blank
    buildCommand: 'npm run build',
    publishDir: 'dist',
    env: [
      'DISCORD_TOKEN',
      'OPENAI_API_KEY',
      'X_RAPIDAPI_KEY',
      'BOT_PERSONALITY',
      'STATUS_HOSTNAME',
      'STATUS_PORT',
    ],
  },
  plugins: {
    validate: true,
    pluginDir: 'plugins',
    requireId: true,
    requireVersion: true,
    requireDescription: false,
  },
};
```

- **Linting**: ESLint is enforced on all JS files except excluded folders/files.
- **Formatting**: Prettier is run on JS, JSON, and Markdown files.
- **Security**: Checks for secrets in the codebase (excluding `.env.example` and `archive`).
- **Plugin Validation**: All plugins in the `plugins/` directory are checked for required fields and structure.
- **Deployment**: (Optional) Can be enabled for CI/CD deployment with supported providers.

## Implementation Checklist

A detailed implementation checklist is maintained in [`CHECKLIST.md`](./docs/CHECKLIST.md). This tracks high, medium, and low priority tasks for code structure, security, performance, testing, developer experience, and deployment. Please review and update this file as you work on the project.

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
   npm run lint
   ```

   - The build/deploy process requires a successful lint (no errors).

5. **Run the Bot**:

   ```bash
   # Using the start.sh script (recommended)
   chmod +x start.sh  # Make sure it's executable

   # Start in development mode (default)
   ./start.sh

   # Start in production mode
   ./start.sh -m production

   # Start only the status server
   ./start.sh -c status

   # Start only the Discord bot
   ./start.sh -c bot

   # Start in demo mode (no API keys needed)
   ./start.sh --demo
   ```

6. **Access the Status Page**:
   - Open your browser to `http://<STATUS_HOSTNAME>:<STATUS_PORT>` (default: http://localhost:3002 for development mode, http://localhost:3000 for production)

## Docker Deployment

ChimpGPT can be easily deployed using Docker:

1. **Prerequisites**:

   - Docker and Docker Compose installed
   - Valid `.env` file with required environment variables

2. **Quick Start**:

   ```bash
   # Clone the repository
   git clone https://github.com/yourusername/Chimp-GPT.git
   cd Chimp-GPT

   # Create .env file
   cp .env.example .env
   nano .env  # Edit with your API keys and settings

   # Build and start the container
   docker-compose up -d
   ```

   > **Note about environment variables**: The Docker setup mounts your local `.env` file directly into the container, so it will use the same environment variables you've set for development. This makes it easy to switch between local and containerized deployment without changing your configuration.

3. **Access the Status Page**:

   - Open your browser to `http://localhost:3000` (or the port specified in your `.env` file)

4. **View Logs**:
   ```bash
   docker-compose logs -f
   ```

For more details, see the [Docker Deployment Guide](docs/DOCKER_DEPLOYMENT.md).

## Run Modes

ChimpGPT supports different run modes via the included `start.sh` script:

```bash
# Start in development mode (default)
./start.sh

# Start in production mode
./start.sh -m production

# Start only the status server in demo mode
./start.sh -c status --demo

# Run tests
./start.sh -m test

# Start with debug logging
./start.sh --debug
```

Available options:

- `-m, --mode MODE`: Set run mode (production, development, test, demo)
- `-c, --component COMP`: Component to run (all, bot, status)
- `-d, --demo`: Enable demo mode (generates mock data)
- `--debug`: Enable debug logging
- `-q, --quiet`: Minimize logging (errors only)

### Performance Configuration

The bot includes several optimizations to ensure responsive performance, controlled via environment variables:

- `DISABLE_PLUGINS`: Set to 'false' to enable plugins or 'true' to disable them (default: true - plugins disabled)

  Disabling plugins significantly improves responsiveness (reducing message processing time by ~60%) and
  makes the "Thinking..." message appear much faster. Enable plugins only if you need their functionality.

For VSCode users, debugging configurations are available in the `.vscode/launch.json` file.

## Contributing

- Contributions are welcome! Please follow the plugin template and code style guidelines.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.
- All PRs are automatically linted and checked for plugin validity.

## License

MIT


## PM2 Management & Performance Monitoring

ChimpGPT is designed to be managed using PM2, which provides advanced process management capabilities. This section covers how to monitor and debug performance issues using PM2.

### Basic PM2 Commands

```bash
# View all running processes
pm2 status

# Start ChimpGPT
pm2 start combined.js --name chimpGPT

# Restart the bot
pm2 restart chimpGPT

# Stop the bot
pm2 stop chimpGPT

# View logs (most recent 100 lines)
pm2 logs chimpGPT --lines 100

# Monitor resource usage in real-time
pm2 monit
```

### Troubleshooting Slow Reaction Times

If you experience slow reactions from ChimpGPT, use these steps to diagnose and resolve the issue:

1. **Check Resource Usage**:

   ```bash
   # View real-time resource metrics
   pm2 monit
   ```

   Look for high CPU or memory usage which may indicate bottlenecks.

2. **Examine Logs for Delays**:

   ```bash
   # View error logs
   pm2 logs chimpGPT --err --lines 100

   # Search logs for timeout errors
   pm2 logs chimpGPT --lines 1000 | grep -i "timeout"
   ```

3. **Monitor API Response Times**:
   Access the performance dashboard at `http://localhost:3000/performance.html` to view detailed timing metrics for all operations.

4. **Identify API Bottlenecks**:
   The most common causes of slow reactions are:

   - OpenAI API delays (most common)
   - External API timeouts (weather, Wolfram Alpha)
   - Large conversation context sizes
   - Plugin execution overhead

5. **Adjust Timeouts**:
   You can modify timeouts in `.env`:

   ```
   # Add these to your .env file
   OPENAI_TIMEOUT_MS=15000
   EXTERNAL_API_TIMEOUT_MS=10000
   ```

6. **Reset the Bot**:
   If ChimpGPT becomes unresponsive:
   ```bash
   pm2 reload chimpGPT --update-env
   ```
   This will restart the process and reload environment variables.

### PM2 Log Management

Logs are stored in the `~/.pm2/logs/` directory:

- `chimpGPT-out.log` - Standard output logs
- `chimpGPT-error.log` - Error logs

```bash
# View only error logs
tail -f ~/.pm2/logs/chimpGPT-error.log

# Search logs for specific error patterns
grep -i "error" ~/.pm2/logs/chimpGPT-out.log
```

### Performance Monitoring Dashboard

The built-in performance monitoring dashboard provides insights into bot operations:

1. **Access**: Navigate to `http://localhost:3002/performance.html` (development mode) or `http://localhost:3000/performance.html` (production mode)
2. **Features**:
   - API response time charts
   - Processing time breakdowns
   - Detailed operation metrics
   - Recent calls with timing information

This dashboard is particularly useful for identifying which operations are causing slow reactions.

# Save the PM2 configuration

pm2 save

# Check status

pm2 status

````

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


## Contributing

If you'd like to contribute to the development of Chimp-GPT, please fork the repository and submit a pull request.

## File Structure

ChimpGPT follows a clean, modular architecture with clear separation of concerns:

```
chimp-gpt/
├── 📁 src/                          # Core application source code
│   ├── 📁 core/                     # Main bot components
│   │   ├── chimpGPT.js              # Core Discord bot implementation
│   │   ├── combined.js              # Main entry point (bot + status server)
│   │   ├── logger.js                # Structured logging configuration
│   │   ├── configValidator.js       # Environment variable validation
│   │   └── healthCheck.js           # Bot health monitoring system
│   │
│   ├── 📁 services/                 # External API integrations
│   │   ├── openaiConfig.js          # OpenAI API configuration
│   │   ├── weatherLookup.js         # Weather API service
│   │   ├── timeLookup.js           # Time lookup functionality
│   │   ├── wolframLookup.js        # Wolfram Alpha integration
│   │   ├── quakeLookup.js          # Quake Live server stats
│   │   └── imageGeneration.js      # GPT Image-1 generation
│   │
│   ├── 📁 conversation/             # Conversation management
│   │   ├── conversationManager.js
│   │   ├── blendedConversationManager.js
│   │   ├── conversationStorage.js
│   │   └── optimizationPatch.js
│   │
│   ├── 📁 middleware/               # Bot middleware & utilities
│   │   ├── rateLimiter.js          # Rate limiting for API calls
│   │   ├── circuitBreaker.js       # Circuit breaker pattern
│   │   └── performanceMonitor.js   # Performance tracking
│   │
│   ├── 📁 web/                      # Web interface & status server
│   │   ├── statusServer.js         # Status page HTTP server
│   │   ├── statusManager.js        # Status management
│   │   └── performanceHistory.js   # Performance data storage
│   │
│   └── 📁 plugins/                  # Plugin system
│       └── pluginManager.js        # Plugin loading and management
│
├── 📁 src/commands/                 # Discord commands  
│   ├── commandHandler.js           # Command registration and routing
│   ├── deploySlashCommands.js      # Slash command deployment
│   └── modules/                    # Individual command implementations
│
├── 📁 src/errors/                   # Custom error classes
│   ├── ChimpError.js               # Base error class
│   ├── ApiError.js                 # API-related errors
│   └── [other error types]
│
├── 📁 src/tools/                    # Development tools
│   ├── testConversationStatus.js   # Conversation testing utility
│   └── testReplyContext.js         # Reply context testing
│
├── 📁 utils/                        # Utility functions
│   ├── apiKeyManager.js            # API key management
│   ├── retryWithBreaker.js         # Retry logic with circuit breaker
│   └── [other utilities]
│
├── 📁 tests/                        # All test files
│   ├── 📁 unit/                     # Unit tests
│   ├── 📁 integration/              # Integration tests
│   └── 📁 fixtures/                 # Test fixtures
│
├── 📁 scripts/                      # Build & deployment scripts
│   ├── start.sh                    # Main startup script
│   └── [other scripts]
│
├── 📁 assets/                       # Generated content & resources
│   ├── 📁 pfp/                      # Profile pictures
│   └── 📁 logs/                     # Log files
│
├── 📁 docs/                         # Documentation (consolidated)
│   ├── CLAUDE.md                   # Claude Code instructions
│   ├── CHECKLIST.md                # Development checklist
│   └── [other documentation]
│
├── 📁 data/                         # Runtime data
├── 📁 scripts/                      # Build & deployment scripts  
└── 📁 archive/                      # Legacy/backup files
```

### Architecture Benefits

- **Clear separation of concerns**: Core, services, web, middleware are logically separated
- **Easier navigation**: Related files are grouped together
- **Better maintainability**: New developers can quickly understand the structure
- **Scalable**: Easy to add new services or features in appropriate directories
- **Standard conventions**: Follows Node.js project best practices

## Configuration Options

### Logging

The bot uses Pino for structured JSON logging. You can configure the logging level in the `.env` file:

```env
# Available log levels: fatal, error, warn, info, debug, trace
LOG_LEVEL="info"

# Environment mode - set to 'production' or 'development'
NODE_ENV="development"
````

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

## Profile Picture (PFP) Management

Chimp-GPT can automatically update its profile picture using AI-generated images. To enable this feature, ensure the following requirements are met:

### Bot Permissions
1. **OAuth2 Scopes**: The bot must be invited with these scopes:
   - `bot`
   - `applications.commands`

2. **Server Permissions**: The bot's role needs:
   - `Change Nickname` permission

3. **Discord Limitations**:
   - The bot can only change its avatar if it's in fewer than 100 servers
   - Avatar changes are rate-limited by Discord (recommended: no more than 1-2 changes per 10 minutes)

### Configuration
By default, the bot will:
- Save generated images to the `pfp/` directory (not tracked in git)
- Rotate the profile picture every 10 minutes
- Keep a maximum of 50 most recent images

### Troubleshooting
If the bot doesn't update its avatar:
1. Check the logs for permission-related errors
2. Verify the bot has the correct permissions in the server
3. Ensure the bot is not in more than 100 servers
4. Check if the `pfp/` directory exists and is writable

### Quake Server Stats

You can configure the ELO display mode in `quakeLookup.js` by changing the `eloMode` value in the CONFIG object:

```javascript
const CONFIG = {
  // ELO display mode:
  // 0 = Off (don't show ELO)
  // 1 = Categorized (Scrub/Mid/Pro)
  // 2 = Actual ELO value
  eloMode: 1,
  maxServers: 3,
};
```

## License

This project is licensed under the MIT License.
