# Chimp-GPT

A Discord bot powered by OpenAI. Handles conversations, image generation, weather, time, Quake Live server stats, and web search. Built around a PocketFlow graph architecture for clean conversation flow and context management.

## Features

- **AI conversations** — context-aware replies using GPT, with reply chain tracking and group chat support
- **Image generation** — GPT Image-1 with HD upgrade, real-time progress, delivered as file attachments
- **Weather** — current conditions and forecasts via WeatherAPI (through RapidAPI)
- **Time lookup** — timezone-aware time queries for any location
- **Quake Live stats** — live server stats with team assignments and Glicko ratings
- **Web search** — fact-checking and general search with circuit breaker protection
- **Slash commands** — full Discord slash command support with auto-deployment
- **Plugin system** — extend with custom commands, functions, and lifecycle hooks
- **Status dashboard** — web UI with stats, image gallery, and performance metrics

## Requirements

- Node.js v18+
- A Discord bot token and application
- OpenAI API key
- RapidAPI key (for weather via WeatherAPI.com)
- Optional: Wolfram Alpha App ID

## Setup

```bash
git clone https://github.com/f0rky/Chimp-GPT.git
cd Chimp-GPT
npm install
cp .env.example .env
# Fill in your values in .env
npm start
```

### Key environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | ✅ | Discord bot token |
| `CLIENT_ID` | ✅ | Discord application ID (for slash commands) |
| `OWNER_ID` | ✅ | Your Discord user ID (owner-only commands) |
| `CHANNEL_ID` | ✅ | Channel(s) the bot responds in (comma-separated) |
| `OPENAI_API_KEY` | ✅ | OpenAI API key |
| `X_RAPIDAPI_KEY` | ✅ | RapidAPI key (weather) |
| `BOT_NAME` | ❌ | Bot display name (default: Solvis) |
| `BOT_PERSONALITY` | ❌ | System prompt personality |
| `ENABLE_IMAGE_GENERATION` | ❌ | Enable image gen (default: true) |
| `ENABLE_REPLY_CONTEXT` | ❌ | Follow Discord reply chains (default: true) |
| `LOG_LEVEL` | ❌ | Pino log level (default: info) |

See `.env.example` for the full list.

## Run modes

```bash
# Development (default, nodemon, debug port)
npm start

# Production
./start.sh -m production

# Bot only (no status server)
./start.sh -c bot

# Status server only
./start.sh -c status

# With pm2
npx pm2 start ecosystem.config.js --env production
```

## Docker

```bash
cp .env.example .env
# Edit .env with your values
docker-compose up -d
docker-compose logs -f
```

Status page available at `http://localhost:3000` (or your configured port).

See [docs/DOCKER_DEPLOYMENT.md](docs/DOCKER_DEPLOYMENT.md) for details.

## Architecture

Messages flow through `SimpleChimpGPTFlow` (PocketFlow graph architecture):

```
Message → Intent detection → Context management → Function routing → Response
```

- **`src/core/`** — bot initialisation, event handlers, config
- **`src/conversation/flow/`** — PocketFlow nodes and conversation state
- **`src/services/`** — external API integrations (weather, search, Quake, image gen)
- **`src/commands/`** — slash and prefix command modules
- **`src/plugins/`** — plugin loader and bundled plugins
- **`src/web/`** — status dashboard and API server

## Plugin system

Plugins live in `plugins/`, each in their own folder with an `index.js`. They can add commands, OpenAI function definitions, and respond to lifecycle hooks.

```js
module.exports = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  commands: { ... },
  functions: [ ... ],
  hooks: { onReady: async (client) => { ... } },
};
```

See [plugins/README.md](plugins/README.md) for the full template and API.

## Commands

| Command | Description |
|---------|-------------|
| `/help` | List available commands |
| `/ping` | Latency check |
| `/serverstats` | Quake Live server stats |
| `/image` | Generate an image |
| `/cleanupdm` | Delete bot's DM messages (owner only) |
| `/restart` | Restart the bot (owner only) |

Prefix commands also work with `!`, `?`, or `/`.

## Development

```bash
npm run lint          # ESLint
npm test              # Unit tests
npm run test:comprehensive  # Full test suite
```

Logs are written to `assets/logs/` via Pino structured logging.

## License

MIT
