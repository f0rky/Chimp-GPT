# Claude Code Context & Operational Commands

This file contains important context and commands for Claude Code to remember when working with this project.

## Project Details
- **Project Name**: Chimp-GPT Discord Bot
- **Version**: 2.0.1
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

## Version History

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