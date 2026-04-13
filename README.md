# Chimp-GPT

Discord bot with OpenAI. Conversations, image generation, weather, web search, and Quake Live stats. Runs on a PocketFlow graph for conversation flow and context management.

## Features

- AI conversations with reply chain tracking and group chat support
- Image generation — GPT Image models, HD upgrade button, progress indicators
- Weather via WeatherAPI through RapidAPI
- Timezone-aware time lookup
- Quake Live server stats with Glicko ratings
- Web search with circuit breaker
- Slash commands with auto-deployment
- Plugin system — custom commands, functions, lifecycle hooks
- Status dashboard — web UI with stats and image gallery

## Requirements

- Node.js 20+
- Discord bot token + application
- OpenAI API key
- RapidAPI key (weather)
- Optional: Wolfram Alpha App ID

## Setup

```bash
git clone https://github.com/f0rky/Chimp-GPT.git
cd Chimp-GPT
npm install
cp .env.example .env
# Fill in your values
npm start
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | ✅ | Discord bot token |
| `CLIENT_ID` | ✅ | Discord application ID |
| `OWNER_ID` | ✅ | Your Discord user ID |
| `CHANNEL_ID` | ✅ | Channel(s) to respond in (comma-separated) |
| `OPENAI_API_KEY` | ✅ | OpenAI API key |
| `X_RAPIDAPI_KEY` | ✅ | RapidAPI key (weather) |
| `BOT_NAME` | ❌ | Bot display name (default: Solvis) |
| `BOT_PERSONALITY` | ❌ | System prompt personality |
| `ENABLE_IMAGE_GENERATION` | ❌ | Enable image gen (default: true) |
| `ENABLE_REPLY_CONTEXT` | ❌ | Follow reply chains (default: true) |
| `LOG_LEVEL` | ❌ | Pino log level (default: info) |

See `.env.example` for the full list.

## Running

```bash
npm start                          # Development (nodemon, debug port)
./start.sh -m production           # Production
./start.sh -c bot                  # Bot only (no status server)
./start.sh -c status               # Status server only
npx pm2 start ecosystem.config.js   # With pm2
```

## Docker

```bash
cp .env.example .env
# Edit .env
docker-compose up -d
docker-compose logs -f
```

Status page at `http://localhost:3000`. See [docs/DOCKER_DEPLOYMENT.md](docs/DOCKER_DEPLOYMENT.md).

## Architecture

Message flow through `SimpleChimpGPTFlow`:

```
Message → Intent detection → Context management → Function routing → Response
```

| Directory | Purpose |
|-----------|---------|
| `src/core/` | Bot init, event handlers, config |
| `src/conversation/flow/` | PocketFlow nodes, conversation state |
| `src/services/` | External APIs (weather, search, Quake, images) |
| `src/commands/` | Slash and prefix command modules |
| `src/plugins/` | Plugin loader and bundled plugins |
| `src/web/` | Status dashboard and API server |

## Plugins

Plugins live in `plugins/`, each with an `index.js`:

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

See [plugins/README.md](plugins/README.md) for the template and API.

## Commands

| Command | Description |
|---------|-------------|
| `/help` | List commands |
| `/ping` | Latency check |
| `/serverstats` | Quake Live stats |
| `/image` | Generate an image |
| `/cleanupdm` | Delete bot DMs (owner) |
| `/restart` | Restart bot (owner) |

Prefix commands also work with `!`, `?`, or `/`.

## Development

```bash
npm run lint          # ESLint
npm test              # Unit tests
npm run test:comprehensive
```

Logs go to `assets/logs/` via Pino.

## License

MIT