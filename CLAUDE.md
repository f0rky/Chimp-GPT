# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chimp-GPT is a Discord bot powered by OpenAI's GPT API that provides conversational AI, image generation, weather lookups, time zone information, and other features through a modular plugin system.

## 🚨 Current Project State (v1.7.2)

**✅ RECENTLY COMPLETED (Major Milestone):**
- **Complete project structure reorganization** into clean modular architecture
- All 75+ files moved from root into organized src/ subdirectories
- Updated package.json, ecosystem.config.js, and deployment scripts  
- Updated README.md and CHECKLIST.md documentation
- Successfully committed and pushed to git (commit: 093d28a)

**⚠️ IMMEDIATE NEXT STEP REQUIRED:**
- **Critical: Fix import statement issues** - Many files in src/ still use relative paths that are now broken
- Bot will NOT start properly until import statements are systematically fixed
- Identified 10+ files with remaining import path issues in src/ directory

**📂 New Folder Structure:**
```
src/
├── core/        # Main bot components (chimpGPT.js, combined.js, logger.js, etc.)
├── services/    # External APIs (OpenAI, weather, time, Wolfram, Quake, images)  
├── conversation/ # Conversation management & optimization
├── middleware/  # Rate limiting, circuit breaker, performance monitoring
├── web/         # Status server, manager, performance history
└── plugins/     # Plugin system management
```

## 🔧 Immediate Action Items for Next Claude Session

### Priority 1: Fix Import Statements (CRITICAL)
The following files need import path updates to work with new src/ structure:

**Files with Issues:**
- `src/middleware/performanceMonitor.js`
- `src/middleware/rateLimiter.js` 
- `src/services/openaiConfig.js`
- `src/services/imageGeneration.js`
- `src/services/weatherLookup.js`
- `src/services/quakeLookup.js`
- `src/services/timeLookup.js`
- `src/services/simplified-weather.js`
- `src/services/wolframLookup.js`
- `src/core/healthCheck.js`
- All files in `src/conversation/`
- Various files in root directory referencing moved files

**Import Fix Patterns:**
```javascript
// WRONG (current broken paths):
require('./logger')           
require('./configValidator')
require('./functionResults')
require('./utils/xyz')

// CORRECT (new paths needed):
require('../core/logger')              # From src/ subdirs to core
require('../core/configValidator')     # From src/ subdirs to core  
require('../../functionResults')       # From src/ subdirs to root files
require('../../utils/xyz')             # From src/ subdirs to utils
require('./src/core/logger')           # From root to src/core
```

### Priority 2: Test Functionality
After import fixes:
1. `node src/core/combined.js --mode test` - Test basic startup
2. `npm test` - Run test suite  
3. `pm2 start ecosystem.config.js` - Test production deployment

### Priority 3: Update Version  
Update to v1.7.3 to reflect major restructuring completion

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