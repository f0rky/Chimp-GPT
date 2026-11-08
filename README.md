# Chimp-GPT

Discord bot with AI chat, image generation, weather, time lookup, web search, and Quake Live stats.

## Conversation behavior

Natural-language conversation is handled in eligible configured guild channels. DMs are ignored by the message flow. Conversation state is scoped per user and channel/thread; it is not shared between participants. Specialist interactions retain bounded summaries in that same scoped history. History is held in process memory and is lost on restart; no durable conversation storage is promised. Reset applies only to the current user's current channel/thread in the active flow. Reply-chain context is not supported. See [Conversation behavior](docs/CONVERSATION_BEHAVIOR.md).

## Requirements and setup

- Node.js 20.18.1 or newer
- Discord bot token, OpenAI API key, and one or more allowed channel IDs
- `jq` is needed by the `npm start` prestart security check
- `CLIENT_ID` is optional for basic startup, but needed for slash-command registration

```bash
git clone https://github.com/f0rky/Chimp-GPT.git
cd Chimp-GPT
npm ci
cp .env.example .env
# Edit .env locally; do not commit or share it.
npm start
```

See [Setup and operations](docs/PRODUCTION_INSTALL.md) for configuration and startup details. `npm ci` uses the checked-in lockfile; do not delete it to troubleshoot installs.

## Other features

- **Images:** configurable provider routing, visible upscale/remix actions, and all-black PNG rejection. Image operations are one-shot; see [image generation notes](docs/image-generation-alternatives-analysis.md).
- **Weather:** Open-Meteo, including forecasts; no RapidAPI key is needed. See [weather caching and verification](docs/audits/2026-10-30-solvis/WEATHER-CACHE.md).
- Slash commands and prefix commands; use `!` for prefix commands. A leading `.` is ignored by default. Natural-language DMs are ignored; slash commands are a separate interaction path.
- Status dashboard, plugins, and Quake Live statistics.

## Development

```bash
npm run lint
npm test
npm run test:comprehensive
npm run format:check
```

`npm start` runs the package's prestart security check before starting the app. That check uses `jq`. See [testing notes](docs/TESTING.md) for runner scope and provider-test cautions.

## Documentation map

- [Conversation behavior](docs/CONVERSATION_BEHAVIOR.md) — current intended contract for chat.
- [Setup and operations](docs/PRODUCTION_INSTALL.md) — safe dependency install and startup.
- [Testing](docs/TESTING.md) — test commands and limits.
- [Historical conversation architecture](docs/CONVERSATION_FLOW.md) and [reply-context proposal](docs/REPLY_CONTEXT.md) — superseded; not current behavior.

## License

MIT
