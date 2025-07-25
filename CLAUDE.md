# Claude Code Context & Operational Commands

This file contains important context and commands for Claude Code to remember when working with this project.

## Project Details
- **Project Name**: Chimp-GPT Discord Bot
- **Version**: 2.0.0
- **Technology**: Node.js Discord bot with OpenAI integration

## Process Management
- **Process Manager**: PM2
- **Instance Name**: `chimpGPT-Solvis`
- **Log Location**: `/home/brett/Chimp-GPT-FES/assets/logs/`

## Essential PM2 Commands
```bash
# Restart the bot (ALWAYS use the specific instance name)
pm2 restart chimpGPT-Solvis

# Flush logs for clean testing
pm2 flush chimpGPT-Solvis

# Monitor real-time logs
pm2 logs chimpGPT-Solvis

# Check process status
pm2 status

# View recent logs (last 20 lines)
pm2 logs chimpGPT-Solvis --lines 20
```

## Important Notes
- **Never use `pm2 restart all`** - This would restart ALL PM2 processes on the system, not just this bot
- Always specify the instance name `chimpGPT-Solvis` in PM2 commands
- The bot uses PocketFlow architecture (v2.0) for advanced conversation management
- Image generation functionality should be tested after restarts to ensure it's working properly

## Development Commands
```bash
# Install dependencies
npm install

# Lint code
npm run lint

# Format code
npm run format

# Run tests
npm test

# Start in development mode (uses nodemon)
npm start
```

## Key Features to Test
- Image generation (e.g., "draw an image of...") - **Now uses direct bypass for performance**
- Weather queries
- Quake Live server stats
- General AI conversations
- Slash commands

## Performance Optimizations (v2.0.1)
### Image Generation Performance Fix
- **Issue**: Image generation was taking 160+ seconds due to PocketFlow complexity
- **Root Cause**: Custom "PocketFlow-inspired" implementation was overengineered and not following actual PocketFlow principles
- **Solution**: Implemented direct bypass for image generation requests
- **Result**: Image generation now bypasses conversation loading bottleneck and PocketFlow routing
- **Expected Performance**: 15-20 seconds instead of 160+ seconds

### PocketFlow Architecture Notes
- Our implementation is a custom JavaScript system inspired by PocketFlow concepts
- Real PocketFlow is a 100-line Python framework emphasizing "Keep it Simple, Stupid"
- Our system was fighting against the framework instead of working with it
- **Key Learning**: When using architectural patterns, follow the original philosophy rather than overengineering

### Direct Bypass Implementation
- Image requests are detected early in message processing using regex patterns
- Bypasses all PocketFlow conversation loading and routing
- Calls original `handleImageGeneration` directly
- Falls back to normal processing if bypass fails

### URL Extraction Fix
- **Issue**: Image handler was accessing `imageResult.url` instead of `imageResult.images[0].url`
- **Root Cause**: Image service returns base64 data in `images` array structure
- **Solution**: Updated handler to properly access the image URL from the correct property
- **Result**: Images now display properly instead of showing "undefined"

### Performance Results Achieved
- **Before**: 160+ seconds with undefined responses
- **After**: ~58 seconds with proper image URLs
- **Improvement**: 65% faster response time + functional image delivery

## Log Monitoring
When troubleshooting, check these log files:
- Output: `/home/brett/Chimp-GPT-FES/assets/logs/chimpGPT-Solvis-out.log`
- Errors: `/home/brett/Chimp-GPT-FES/assets/logs/chimpGPT-Solvis-error.log`