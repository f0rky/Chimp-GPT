# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chimp-GPT is a Discord bot powered by OpenAI's GPT API that provides conversational AI, image generation, weather lookups, time zone information, and other features through a modular plugin system.

## 🚨 Current Project State (v1.8.0)

**✅ MAJOR MILESTONE COMPLETED:**
- **Complete root directory cleanup and reorganization** finished successfully
- **92 files moved** with full git history preservation using `git mv`
- **329 import statements updated** across entire codebase to fix all path issues
- **All functionality verified working** - bot starts successfully without errors
- **Documentation consolidated** - moved key docs to `docs/` directory
- **Plugin system unified** - all plugins now in `src/plugins/`
- **Web assets organized** - moved `public/` to `src/web/public/`
- **Version updated to v1.8.0** to reflect major architectural improvements

**📂 Current Clean Folder Structure:**
```
├── 📦 Package Management: package.json, package-lock.json
├── ⚙️ Configuration: ecosystem.config.js, eslint.config.js, windsurf.config.js  
├── 🐳 Deployment: Dockerfile, docker-compose.yml
├── 📚 Key Documentation: README.md, CHANGELOG.md, LICENSE, CONTRIBUTING.md
├── 🏗️ Source Code: src/ (fully organized)
│   ├── commands/      # Discord commands & handlers
│   ├── conversation/  # Chat management & optimization
│   ├── core/          # Core bot functionality (logger, health, config, etc.)
│   ├── errors/        # Custom error classes
│   ├── middleware/    # Rate limiting, circuit breakers, performance
│   ├── plugins/       # Plugin system + actual plugins  
│   ├── services/      # External API integrations (OpenAI, weather, etc.)
│   ├── tools/         # Development and testing tools
│   └── web/           # Status server + web assets (public/)
├── 📖 Documentation: docs/ (consolidated from root)
├── 💾 Runtime Data: data/, assets/
├── 🧪 Development: tests/, utils/, scripts/
└── 📁 Archive: archive/ (historical files)
```

**🎯 Current State: FULLY FUNCTIONAL**
- ✅ Bot starts without any import errors
- ✅ All features working (image generation, conversation, commands, etc.)
- ✅ Clean, maintainable codebase with logical organization
- ✅ Ready for continued development and new features

## 🔧 Development Patterns Established

## Essential Commands

```bash
# Development  
npm start              # Start with nodemon (now points to src/core/combined.js)
npm test              # Run all tests (now in tests/unit/)
npm test <file>       # Run specific test file  
npm run lint          # ESLint code quality check
npm run format        # Prettier code formatting
npm run format:check  # Check formatting without changes

# Production
node src/core/combined.js    # Direct execution (NEW PATH)
pm2 start ecosystem.config.js  # PM2 process manager (updated config)
docker-compose up -d         # Docker deployment

# Deployment & Utilities  
node commands/deploySlashCommands.js  # Deploy Discord slash commands
./scripts/start.sh -m debug           # Start in debug mode (NEW PATH)
./scripts/start.sh -m demo            # Start in demo mode (NEW PATH)
```

## Architecture & Key Patterns

### Core Components
- **src/core/chimpGPT.js**: Main bot initialization and Discord client setup
- **src/conversation/conversationManager.js**: Manages conversation history and context with automatic pruning
- **commands/commandHandler.js**: Processes Discord commands with alias support
- **src/plugins/pluginManager.js**: Loads and manages plugins with event hooks
- **src/middleware/circuitBreaker.js**: Implements circuit breaker pattern for API resilience
- **utils/humanCircuitBreaker.js**: Discord reaction-based approval system for sensitive operations

### External Service Integration
All external services use the circuit breaker pattern for resilience:
- **src/services/imageGeneration.js**: GPT Image-1 API integration with 1024x1024 image size
- **src/services/weatherLookup.js**: Weather data from weatherapi.com
- **src/services/timeLookup.js**: Time zone information using worldtimeapi.io
- **src/services/wolframLookup.js**: Wolfram Alpha computational queries
- **src/services/quakeLookup.js**: Quake Live server statistics

### Storage & Persistence
- Conversations saved to `data/conversations/` with automatic 30-day retention
- Image usage tracked in `data/imageUsage.json`
- Stats stored in `data/stats.json`
- Circuit breaker states in `data/circuitBreakerStates.json`

### Conversation Modes
- **Blended Mode** (default): Combines messages from all users in a channel into shared context
  - Limits each user to last 5 messages to prevent context dominance
  - Chronological ordering maintained across all users
  - DMs remain individual conversations
- **Individual Mode**: Each user maintains separate conversation context
  - Toggle with `USE_BLENDED_CONVERSATIONS=false` in `.env`

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

# Optional conversation settings
USE_BLENDED_CONVERSATIONS=true  # Blend conversations from multiple users
MAX_MESSAGES_PER_USER_BLENDED=5  # Max messages per user in blended mode
```

## Testing Approach

- Unit tests in `tests/unit/` directory
- Integration tests in `tests/integration/` directory  
- Test fixtures in `tests/fixtures/` directory
- Test runner: `node tests/unit/testRunner.js`
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

## 📋 Memory for Future Claude Sessions

### Context: Project Structure Reorganization Completed
- **When**: June 29, 2025 (commit 093d28a)
- **What**: Complete reorganization from flat root structure to organized src/ directories
- **Status**: Structure moved successfully, but import statements need fixing

### Critical Next Steps (In Order)
1. **Fix Import Statements** (Priority 1 - Bot won't start without this)
   - Use patterns documented above in "Import Fix Patterns" section
   - Focus on files listed in "Files with Issues" section
   - Test with `node src/core/combined.js --mode test` after each batch of fixes

2. **Verify Functionality** (Priority 2)
   - Run full test suite: `npm test`
   - Test PM2 deployment: `pm2 start ecosystem.config.js`
   - Verify all features work in Discord

3. **Complete Documentation** (Priority 3)
   - Update any remaining file path references in docs/
   - Update CHANGELOG.md with v1.7.3 reflecting completed reorganization
   - Update package.json version to 1.7.3

### Notes for Future Development
- **Always use modular structure**: New features should go in appropriate src/ subdirectories
- **Import patterns established**: Follow documented patterns for internal imports
- **Git history preserved**: All file moves used `git mv` so history is intact
- **Deployment updated**: PM2, npm scripts, and start.sh all updated for new structure

### Success Criteria
- ✅ Bot starts without import errors: `node src/core/combined.js`
- ✅ Tests pass: `npm test` 
- ✅ Production deployment works: `pm2 start ecosystem.config.js`
- ✅ All Discord functionality operational
- ✅ Clean git status with all changes committed