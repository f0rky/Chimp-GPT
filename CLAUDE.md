# Claude Code Context & Operational Commands

This file contains important context and commands for Claude Code to remember when working with this project.

## Project Details
- **Project Name**: Chimp-GPT Discord Bot
- **Version**: 2.1.0
- **Technology**: Node.js Discord bot with OpenAI integration and PocketFlow architecture

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

## Debug Skip Functionality (NEW)
- **Purpose**: Allows skipping log checking operations to save tokens and time during debugging
- **How to use**: React with ⏭️ emoji to any bot message to activate debug skip mode
- **Who can use**: Bot owner only (configured via OWNER_ID)
- **Behavior**: Next Claude Code operation will skip `pm2 logs` commands and continue with available information
- **Auto-reset**: Skip mode automatically deactivates after 15 minutes or after one use
- **Integration**: Use `shouldSkipLogChecking()` function before running log commands

### Debug Skip Usage Example
1. Bot posts a troubleshooting message
2. Owner reacts with ⏭️ emoji
3. Bot confirms with 🤖 reaction and message
4. Next Claude operation skips log checking
5. Skip mode automatically resets

## Claude Code Integration

### Quick Integration for Log Checking
**IMPORTANT**: Always check for debug skip before running `pm2 logs` commands!

```javascript
// At the top of your Claude Code logic:
const { checkPM2LogsSkip, formatSkipMessage } = require('./src/utils/claudeDebugHelper');

// Before running pm2 logs:
const skipCheck = checkPM2LogsSkip();
if (skipCheck.shouldSkip) {
    return formatSkipMessage(skipCheck);
}

// Otherwise proceed with:
// Bash("pm2 logs chimpGPT-Solvis --lines 15", "Check recent bot logs")
```

### Function Reference

#### `checkPM2LogsSkip(instanceName?, lines?)`
- **Purpose**: Check if PM2 log checking should be skipped
- **Parameters**: 
  - `instanceName` (optional): PM2 instance name (default: 'chimpGPT-Solvis')
  - `lines` (optional): Number of log lines (default: 15)
- **Returns**: Object with `shouldSkip`, `message`, `nextStep`, `suggestion`

#### `checkBashCommandSkip(command, description)`
- **Purpose**: Check if any bash command should be skipped
- **Parameters**:
  - `command`: The bash command string
  - `description`: Human-readable description
- **Returns**: Skip information object

#### `checkDebugSkip(operation)`
- **Purpose**: Generic skip check for any operation
- **Parameters**: `operation` - Description of the operation
- **Returns**: Skip decision object

#### `formatSkipMessage(skipInfo)`
- **Purpose**: Format skip information for display
- **Parameters**: Skip info object from check functions
- **Returns**: Formatted message string

### Integration Examples

#### Example 1: PM2 Log Checking
```javascript
const { checkPM2LogsSkip, formatSkipMessage } = require('./src/utils/claudeDebugHelper');

// In your troubleshooting function:
async function checkBotLogs() {
    const skipCheck = checkPM2LogsSkip();
    
    if (skipCheck.shouldSkip) {
        // Skip the logs and continue with next step
        return formatSkipMessage(skipCheck);
    }
    
    // Proceed with log checking
    const logs = await Bash("pm2 logs chimpGPT-Solvis --lines 15", "Check recent bot logs");
    // ... process logs
}
```

#### Example 2: Any Bash Command
```javascript
const { checkBashCommandSkip, formatSkipMessage } = require('./src/utils/claudeDebugHelper');

async function checkSystemStatus() {
    const skipCheck = checkBashCommandSkip(
        'systemctl status nginx', 
        'checking nginx service status'
    );
    
    if (skipCheck.shouldSkip) {
        return formatSkipMessage(skipCheck);
    }
    
    // Proceed with the command
    const status = await Bash("systemctl status nginx", "Check nginx status");
    // ... process status
}
```

#### Example 3: Generic Operation
```javascript
const { checkDebugSkip, formatSkipMessage } = require('./src/utils/claudeDebugHelper');

async function analyzeErrorPatterns() {
    const skipCheck = checkDebugSkip('error pattern analysis');
    
    if (skipCheck.shouldSkip) {
        return formatSkipMessage(skipCheck) + "\n\nProceeding with alternative troubleshooting approach.";
    }
    
    // Proceed with analysis
    // ... complex analysis logic
}
```

### Best Practices for Claude Code

1. **Always Check Before Logs**: Call `checkPM2LogsSkip()` before any `pm2 logs` command
2. **Use Descriptive Operations**: Provide clear descriptions for `checkDebugSkip()`
3. **Format Messages**: Use `formatSkipMessage()` for consistent display
4. **Continue Logic**: When skipping, always provide alternative next steps
5. **Import Once**: Import helper functions at the beginning of your logic

### Skip Behavior
- **One-Time Use**: Skip activates for exactly ONE operation, then auto-resets
- **15-Minute Timeout**: Skip automatically deactivates after 15 minutes if unused
- **Owner Only**: Only the bot owner (OWNER_ID) can activate skip mode
- **Visual Feedback**: Owner sees 🤖 reaction and confirmation message when activated

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
- Image generation (e.g., "draw an image of...") - **Enhanced with streaming support and multi-model fallback**
- Weather queries - **Multi-engine search with intelligent caching**
- Quake Live server stats - **QLStats.net integration with team assignments**
- General AI conversations - **PocketFlow architecture with advanced context management**
- Slash commands
- Status reporting system - **Enhanced LLM provider monitoring**
- Streaming responses - **Real-time progress updates**

## Performance Optimizations (v2.1.0)
### Enhanced Image Generation System
- **Streaming Support**: Real-time progress updates with intelligent buffering
- **Multi-Model Fallback**: Automatic fallback between DALL-E 3 and DALL-E 2 models
- **Retry Logic**: Exponential backoff with robust error recovery
- **Performance Monitoring**: Comprehensive metrics and timing analysis
- **Error Handling**: Enhanced error recovery with detailed logging

### Advanced Status Reporting
- **LLM Provider Monitoring**: Real-time tracking of OpenAI API performance
- **System Metrics**: CPU, memory, and response time monitoring
- **Performance Analytics**: Historical performance data and trend analysis
- **Health Checks**: Automated health monitoring with alert capabilities

### Multi-Engine Search Optimization
- **Intelligent Caching**: Smart cache invalidation with performance-based TTL
- **Search Engine Coordination**: Multiple search providers with fallback chains
- **Response Optimization**: Optimized response formatting and delivery
- **Cache Management**: Advanced cache strategies for improved performance

### Streaming Response Architecture
- **Real-Time Updates**: Live progress updates during long operations
- **Buffer Management**: Intelligent streaming buffer with retry mechanisms
- **User Experience**: Enhanced feedback during processing operations
- **Performance Tracking**: Detailed timing and performance metrics

### PocketFlow Architecture Notes
- **Graph-Based Processing**: Modular conversation nodes with clear data flow
- **Advanced Context Management**: Dynamic token optimization and relevance scoring
- **Intelligent Routing**: Automatic mode switching between conversation types
- **Performance Gains**: 60% complexity reduction with improved response times

## Version History

### v2.1.0 (2025-09-21) - Comprehensive Enhancement Release
- **Enhanced Image Generation**: Streaming buffer implementation with retry logic for better UX
- **Multi-Model Support**: Support for both DALL-E 2 and DALL-E 3 models with fallback strategies
- **Improved Error Handling**: Robust error recovery with exponential backoff mechanisms
- **Status Reporting**: Enhanced system monitoring with LLM provider tracking
- **Multi-Engine Search**: Intelligent cache invalidation and performance optimization
- **Streaming Responses**: Real-time progress updates during long-running operations
- **Performance Monitoring**: Comprehensive metrics and performance tracking
- **Documentation**: Reorganized and enhanced documentation structure

### v2.0.1 (2025-08-03) - Image Generation URL Fix
- **Issue**: Image generation completed successfully (~23s) but displayed "⚠️ Image generated but no URL available" instead of actual images
- **Root Cause**: Logic gap in image handler where data URLs (`data:image/png;base64,...`) fell through condition checks to fallback error
- **Solution**: Enhanced URL handling logic to properly process data URLs as Discord attachments
- **Files Modified**: `src/handlers/imageGenerationHandler.js`
- **Result**: Images now display correctly in Discord regardless of return format (b64_json, data URL, or regular URL)
- **Quality**: Added debug logging, maintained performance, passed all linting/formatting checks

## Log Monitoring
When troubleshooting, check these log files:
- Output: `/home/brett/Chimp-GPT-FES/assets/logs/chimpGPT-Solvis-out.log`
- Errors: `/home/brett/Chimp-GPT-FES/assets/logs/chimpGPT-Solvis-error.log`