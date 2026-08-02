# Chimp-GPT

Discord bot with OpenAI. Conversations, image generation, weather, web search, and Quake Live stats. Runs on a PocketFlow graph for conversation flow and context management.

## Features

- AI conversations with reply chain tracking and group chat support
- Image generation — fast OpenRouter default, GPT Image 2 upscale, remix controls, and all-black-output protection
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
| `OPENAI_API_KEY` | ✅ | OpenAI API key (upscale and fallback image generation) |
| `OPENROUTER_API_KEY` | ❌ | Fast default image generation through OpenRouter Nano Banana 2 Lite |
| `X_RAPIDAPI_KEY` | ✅ | RapidAPI key (weather) |
| `BOT_NAME` | ❌ | Bot display name (default: Solvis) |
| `BOT_PERSONALITY` | ❌ | System prompt personality |
| `ENABLE_IMAGE_GENERATION` | ❌ | Enable image gen (default: true) |
| `ENABLE_REPLY_CONTEXT` | ❌ | Follow reply chains (default: true) |
| `LOG_LEVEL` | ❌ | Pino log level (default: info) |

See `.env.example` for the full list.

## Image generation

With `OPENROUTER_API_KEY` configured, conversational requests use OpenRouter Nano Banana 2 Lite for fast 1K low-quality PNG output. The visible **⬆️ Upscale** action uses OpenAI GPT Image 2 at high quality; **🔀 Remix** creates a new prompt-based variation.

Image requests are intentionally one-shot: the bot does not retry or provider-race billable calls. It also rejects all-black PNG responses before Discord upload. See [Image generation architecture](docs/image-generation-alternatives-analysis.md) for provider routing, safety, and offline validation.

## Running

```bash
npm start                          # Development (nodemon, debug port)
./scripts/start.sh -m production           # Production
./scripts/start.sh -c bot                  # Bot only (no status server)
./scripts/start.sh -c status               # Status server only
npx pm2 start deploy/ecosystem.config.js   # With pm2
```

## Docker

```bash
cp .env.example .env
# Edit .env
docker-compose -f deploy/docker-compose.yml up -d
docker-compose -f deploy/docker-compose.yml logs -f
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
| `deploy/` | Dockerfile, docker-compose, PM2 config |
| `config/` | ESLint and tooling configuration |
| `docs/` | Documentation and archive |

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

Registered prefixes are `!`, `.` and `/` (`src/commands/commandHandler.js`). In practice use **`!`** — `.` is swallowed by `IGNORE_MESSAGE_PREFIX` (default `.`), which is checked before command routing, and `/` is claimed by Discord's slash UI. Most commands are also registered as slash commands.

Prefix commands only run in the channels listed in `CHANNEL_ID`; the message handler returns early on DMs before reaching the command handler, so the "DM" column below applies to the slash-command form.

### General

| Command | Aliases | DM | Description |
|---------|---------|----|-------------|
| `!help [command]` | `commands`, `info` | ✅ | List commands, or show detail for one |
| `!ping` | `pong`, `test` | ✅ | Bot and Discord API latency |
| `!stats` | `status`, `health` | ✅ | Bot health and status information |
| `!version` | `ver`, `v` | ✅ | Bot version information |
| `!clear` | `reset` | ✅ | Clear this channel's conversation history |
| `!serverstats` | `server`, `ql`, `quake` | ✅ | Quake Live server statistics |

### Images

| Command | Aliases | Access | Description |
|---------|---------|--------|-------------|
| `!image <prompt>` | `img`, `gptimage` | Everyone | Generate an image. Slash form adds `model` and `size` options |
| `!toggleimage` | `toggleimages`, `imagetoggle`, `toggleimg` | Admin | **Enable/disable image generation.** A straight toggle — it flips the current state rather than taking `on`/`off`. Requires owner approval |
| `!imagestats [days]` | `imgstats`, `imagecosts` | Owner | Image generation usage and cost totals |

Natural-language requests ("draw me a sunset over Auckland") also generate images — no command needed.

### Moderation

| Command | Aliases | Access | Description |
|---------|---------|--------|-------------|
| `!blocklist` | `blocked`, `listblocked` | Admin | List all blocked users |
| `!unblockuser <userId>` | `unblock` | Admin | Unblock a previously blocked user |
| `!testapproval` | `approvaltest`, `testcircuitbreaker` | Everyone | Exercise the approval system. Requires owner approval |

### Owner

| Command | Aliases | Description |
|---------|---------|-------------|
| `!restart` | `reboot`, `reset-bot` | Restart the bot. Requires approval |
| `!pfp` | `setpfp`, `updatepfp`, `newpfp` | Update the bot's profile picture |
| `!cleanupdm` | — | Delete the bot's own messages from your DM with it |
| `!smoke [live]` | — | Safe setup checks; `live` exercises every provider tool |
| `!smoketest` | `selftest`, `diag` | Live self-test of the AI and all functions |
| `!circuitbreaker <approve\|deny\|list\|status\|version>` | `cb`, `breaker` | Manage pending approvals and breaker state |
| `!debugskip [off\|disable\|clear]` | `ds`, `skipstatus` | Check or clear debug skip status |
| `!admin <subcommand>` | `deletion-admin`, `del-admin` | Message deletion system admin. Subcommands: `help`, `stats`, `list-pending`, `review`, `bulk-review`, `reprocess`, `bulk-reprocess`, `simulate`, `analyze`, `export` |

Admin commands require the Administrator permission; owner commands are restricted to `OWNER_ID`. Commands marked "requires approval" prompt the owner before running.

## Development

```bash
npm run lint          # ESLint
npm test              # Unit tests
npm run test:comprehensive
```

Logs go to `assets/logs/` via Pino.

## License

MIT