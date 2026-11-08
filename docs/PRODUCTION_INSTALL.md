# Production installation and setup

## Requirements

- Node.js 20.18.1 or newer (see `package.json`).
- `DISCORD_TOKEN`, `OPENAI_API_KEY`, and `CHANNEL_ID` are required by the configuration validator.
- `CLIENT_ID` is optional for startup; provide it when slash-command registration is required.
- `jq` is required by the `prestart` security check invoked by `npm start`.

Other integrations have their own optional configuration. Check `src/core/configValidator.js` and the relevant feature documentation; `.env.example` may contain legacy settings that do not affect the active chat path.

## Install and start

From a trusted checkout, preserve the committed lockfile and install its exact dependency graph:

```bash
npm ci
cp .env.example .env
# Edit .env locally with the required values; never commit or share it.
npm start
```

`npm start` runs `prestart`, which invokes `npm run security:check` and requires `jq`, then starts the app in Node watch mode. Production process management is environment-specific: inspect the configured deployment and identify the intended application by name/configuration before restarting it. Do not use a copied numeric process ID from another host or environment.

For Docker, see [Docker deployment](DOCKER_DEPLOYMENT.md).

## Secret handling

Keep `.env` out of version control and limit access to it. Do not paste tokens or keys into issues, logs, or chat. If a credential is exposed, rotate it with its provider. Use only the Discord permissions the bot needs.

## Conversation retention

The approved Option A contract is per-user and per-channel/thread, process-memory-only history. Restart loses history; no durable transcript storage is intended. See [Conversation behavior](CONVERSATION_BEHAVIOR.md), marked as a draft implementation contract pending reconciliation with final code and tests.

## Troubleshooting

- If `npm start` fails at the prestart check, verify `jq` is installed and available on `PATH`.
- If slash commands are unavailable, check `CLIENT_ID`, command registration configuration, and Discord application setup. Basic startup does not itself require `CLIENT_ID`.
- Do not delete `package-lock.json` as a routine install remedy. Investigate the actual npm error and preserve reproducible dependency resolution.
