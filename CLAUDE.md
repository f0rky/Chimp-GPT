# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chimp-GPT is a Discord bot powered by OpenAI's GPT API that provides conversational AI, image generation, weather lookups, time zone information, and other features through a modular plugin system.

## Essential Commands

```bash
# Development
npm start              # Start with nodemon for hot reload
npm test              # Run all tests
npm test <file>       # Run specific test file
npm run lint          # ESLint code quality check
npm run format        # Prettier code formatting
npm run format:check  # Check formatting without changes

# Production
node combined.js      # Direct execution
pm2 start ecosystem.config.js  # PM2 process manager
docker-compose up -d  # Docker deployment

# Deployment & Utilities
node commands/deploySlashCommands.js  # Deploy Discord slash commands
./start.sh -m debug                   # Start in debug mode
./start.sh -m demo                    # Start in demo mode
```

## Architecture & Key Patterns

### Core Components
- **chimpGPT.js**: Main bot initialization and Discord client setup
- **conversationManager.js**: Manages conversation history and context with automatic pruning
- **commandHandler.js**: Processes Discord commands with alias support
- **pluginManager.js**: Loads and manages plugins with event hooks
- **circuitBreaker.js**: Implements circuit breaker pattern for API resilience
- **humanCircuitBreaker.js**: Discord reaction-based approval system for sensitive operations

### External Service Integration
All external services use the circuit breaker pattern for resilience:
- **imageGeneration.js**: GPT Image-1 API integration with 1024x1024 image size
- **weatherLookup.js**: Weather data from weatherapi.com
- **timeLookup.js**: Time zone information using worldtimeapi.io
- **wolframLookup.js**: Wolfram Alpha computational queries
- **quakeLookup.js**: Quake Live server statistics

### Storage & Persistence
- Conversations saved to `data/conversations/` with automatic 30-day retention
- Image usage tracked in `data/imageUsage.json`
- Stats stored in `data/stats.json`
- Circuit breaker states in `data/circuitBreakerStates.json`

### Error Handling
Custom error classes in `errors/`:
- ApiError, ChimpError, ConfigError, DiscordError, PluginError, ValidationError
- Comprehensive error handling with user-friendly messages

### Plugin Development
Plugins go in `plugins/` directory and must export:
```javascript
{
  name: 'plugin-name',
  version: '1.0.0',
  initialize: async function(bot) {},
  hooks: {
    beforeCommand: async (context) => {},
    afterCommand: async (context) => {},
    onMessage: async (message) => {}
  },
  commands: {
    commandName: {
      execute: async (message, args) => {},
      description: 'Command description',
      aliases: ['alias1', 'alias2']
    }
  }
}
```

## Environment Configuration

Required in `.env`:
```
DISCORD_BOT_TOKEN=
OPENAI_API_KEY=
WEATHER_API_KEY=
WOLFRAM_APP_ID=
NODE_ENV=production
BOT_PREFIX=!
```

## Testing Approach

- Unit tests in `tests/` directory
- Test runner: `node tests/testRunner.js`
- Mock Discord.js objects for testing
- Circuit breaker states reset before tests
- Test individual components with focused test files

## Important Notes

- Image generation uses GPT Image-1 API with 1024x1024 size only
- Human approval system uses Discord reactions for sensitive operations
- Conversation optimization includes token counting and smart pruning
- Status dashboard available at http://localhost:3001 when running
- All external API calls wrapped in circuit breakers with exponential backoff
- Plugin system allows extending functionality without modifying core code