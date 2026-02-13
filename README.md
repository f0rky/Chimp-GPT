<div align="center">

# 🤖 Chimp-GPT: Your AI-Powered Discord Companion

[![Discord Bot](https://img.shields.io/badge/Discord-Bot-7289da?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)](https://openai.com)
[![Version](https://img.shields.io/badge/Version-2.1.0-brightgreen?style=for-the-badge)](./package.json)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

**Transform your Discord server into an intelligent, interactive community hub!**

*Chimp-GPT brings the power of AI conversations, real-time gaming stats, weather updates, image generation, and so much more directly to your Discord channels. It's like having a brilliant, witty friend who never sleeps and always has the answers you need.*

> 💡 **Why Chimp-GPT?** While other bots do one thing, we do EVERYTHING - and we do it better. Built-in reliability, stunning visuals, and features your community will actually love. Join others already using the smartest Discord bot on the planet! 🌟

[🚀 **Get Started in 5 Minutes**](#-quick-start-your-bot-in-5-minutes) • [✨ **See What It Can Do**](#-what-can-chimp-gpt-do-for-you) • [🛠️ **Setup Guide**](#setup-and-installation)

</div>

## ✨ What Can Chimp-GPT Do for You?

> **Imagine having an AI assistant that makes your Discord server the most engaging place on the internet!**

🗨️ **Smart Conversations** - Chat naturally with an AI that remembers context, follows reply chains, and gets smarter with every interaction

🌦️ **Instant Weather** - "What's the weather in Tokyo?" - Get beautiful, detailed forecasts for anywhere on Earth

🎮 **Live Gaming Stats** - Real-time Quake Live server stats with team rankings, player ratings, and epic match details

🎨 **AI Image Creation** - Generate stunning artwork, memes, or illustrations with simple text prompts

🧮 **Smart Calculations** - Complex math, unit conversions, and factual questions powered by Wolfram Alpha

🕗 **World Clock** - "What time is it in Sydney?" - Instant timezone information for global coordination

📈 **Live Dashboard** - Beautiful web interface showing bot stats, image galleries, and performance metrics

🔌 **Plugin Ecosystem** - Extend functionality with custom plugins for your specific community needs

### 🎆 Real Examples

```
👤 User: "What's the weather like in New York?"
🤖 Chimp-GPT: 🌦️ Currently 72°F and partly cloudy in New York! 
              Perfect weather for a walk in Central Park 🌳

👤 User: "Generate an image of a cyberpunk cityscape"
🤖 Chimp-GPT: 🎨 Creating your cyberpunk masterpiece... 
              [Real-time streaming progress with enhanced error recovery]
              [Generates stunning AI artwork with DALL-E 3/2 fallback]

👤 User: "!serverstats"
🤖 Chimp-GPT: 🎮 Live Quake Servers:
              🔴 Team Red vs 🔵 Team Blue on dm17
              8/16 players • Pro-level ratings • Epic battles!
```

### 🚀 New in v2.1.0 - Enhanced Performance & Reliability

**🎨 Next-Generation Image Creation**
- **Streaming Progress**: Real-time updates show generation progress
- **Multi-Model Support**: Automatic fallback between DALL-E 3 and DALL-E 2
- **Enhanced Error Recovery**: Robust retry logic with exponential backoff
- **Performance Monitoring**: Comprehensive metrics and timing analysis

**📊 Advanced Status & Monitoring**
- **LLM Provider Tracking**: Real-time OpenAI API performance monitoring
- **System Health**: CPU, memory, and response time analytics
- **Historical Data**: Performance trends and usage statistics
- **Smart Alerts**: Automated health checks with proactive notifications

**🔍 Intelligent Search & Caching**
- **Multi-Engine Search**: Coordinated search across multiple providers
- **Smart Cache Invalidation**: Performance-based cache management
- **Response Optimization**: Enhanced formatting and delivery speed
- **Fallback Chains**: Reliable service redundancy for maximum uptime

---

## 🚀 Quick Start: Your Bot in 5 Minutes

**Ready to supercharge your Discord server?** Here's how to get Chimp-GPT running faster than you can say "artificial intelligence":

### 1️⃣ **Grab Your Keys** (2 minutes)
- 🔑 [Discord Bot Token](https://discord.com/developers/applications) - Create your bot
- 🧮 [OpenAI API Key](https://platform.openai.com/api-keys) - Power the AI brain
- 🌦️ [Weather API Key](https://www.weatherapi.com/) - Enable weather features

### 2️⃣ **One-Command Setup** (2 minutes)
```bash
git clone https://github.com/f0rky/Chimp-GPT.git
cd Chimp-GPT
npm install
cp .env.example .env
# Edit .env with your API keys
```

### 3️⃣ **Launch & Enjoy** (1 minute)
```bash
npm start
```

🎉 **That's it! Your AI companion is now live and ready to amaze your community!**

> 📝 **Pro Tip:** Check out the [detailed setup guide](#setup-and-installation) below for advanced configuration options.

---

## 🛠️ Core Features

### 🐳 Deploy Anywhere in Minutes

**Want to run Chimp-GPT on your server without the hassle?** We've got you covered!

🚀 **One-Click Docker Deploy** - Just run `docker-compose up` and you're live! No complex setup, no dependency headaches.

⚙️ **Auto-Testing & Updates** - GitHub Actions automatically test every change and build fresh Docker images, so you always get rock-solid releases.

📚 **Foolproof Guides** - Step-by-step documentation that actually makes sense (no PhD in DevOps required!).

*Perfect for everything from your home lab to production servers!* See [🐳 Docker Deployment](#-docker-deployment) for the full magic.

### ⚙️ Runs Exactly How YOU Want It

**Different situations call for different setups!** Chimp-GPT adapts to your needs:

🚀 **Production Mode** - Lean, mean, and lightning-fast for your live server (minimal logs, maximum performance)

🔧 **Development Mode** - Full debug mode with all the details you need to troubleshoot and build amazing features

🧪 **Test Mode** - Run all tests without spinning up the bot (perfect for CI/CD and quality checks)

🎭 **Demo Mode** - Want to show off the dashboard without API keys? This generates beautiful mock data!

**Plus:** Start just the bot, just the status server, or mix and match however you like. It's YOUR bot, run it YOUR way! Check out [🏃 Run Modes](#-run-modes) for all the options.

### 📈 Always Know What's Happening

**No more guessing if your bot is working!** Chimp-GPT keeps you in the loop with smart status updates:

🎯 **Smart Context Updates** - See exactly what your bot is doing: "Generating image...", "Fetching weather...", "Thinking..." 

⏱️ **Real-Time Progress** - Watch operations unfold live, so you know everything's working smoothly

🚦 **Discord-Friendly** - Perfectly tuned to avoid hitting rate limits (your bot stays happy, Discord stays happy)

👑 **VIP Treatment** - Bot owners get special privileges and faster updates (because you're the boss!)

### 🔗 Reply Context Enhancement

ChimpGPT now includes an intelligent reply context feature that makes conversations more natural and contextually aware:

- **Message Reference Resolution**: Automatically detects when users reply to messages and follows the reply chain
- **Context Extraction**: Extracts conversation context from referenced messages to maintain conversation flow
- **Configurable Depth**: Control how far back the bot looks for context in message reply chains
- **Intelligent Pruning**: Maintains conversation length limits while preserving important context

This feature makes the bot more conversationally aware, allowing it to understand ongoing discussions even when they involve multiple messages or users.

### 🗨️ Intelligent Group Conversations 

**Finally, a bot that actually GETS group chat dynamics!** ChimpGPT's smart conversation system doesn't just collect messages - it understands them.

🧠 **Smart Message Weighting** - Automatically detects if you're talking to the bot or just chatting, and prioritizes accordingly

⏰ **Temporal Awareness** - Fresh messages get priority, old topics naturally fade (configurable 5-minute "memory window")

🎯 **Bot-Directed Detection** - Recognizes @mentions, questions, commands, and conversation patterns directed at the bot

🔄 **Reply Chain Intelligence** - Follows Discord reply threads to maintain conversation context and relationships

📊 **Relevance Scoring** - Each message gets a smart relevance score based on content, timing, and conversational intent

🧵 **Thread Awareness** - Groups related messages together and understands ongoing conversation topics

💭 **Ambient Context** - Includes background chatter for context without letting it dominate the conversation

⚙️ **Highly Configurable** - Tune memory duration, relevance thresholds, and weighting factors to fit your community

**The Result?** Your bot feels naturally intelligent in group settings - responding to the right people about the right things at the right time! No more confusion from cross-talk or irrelevant old messages cluttering the context.

### 🚀 Next-Generation PocketFlow Architecture (v2.0)

**Revolutionary conversation management powered by graph-based architecture!** Experience the future of Discord AI with our cutting-edge PocketFlow system.

🧩 **Graph-Based Processing** - Crystal-clear data flow through modular nodes (Intent → Context → Router → Function → Response)

🎯 **Intelligent Intent Detection** - Advanced pattern recognition with confidence scoring and contextual awareness

🧠 **Smart Context Management** - Dynamic token optimization and relevance-based message pruning

🔀 **Adaptive Routing** - Automatically switches between individual and blended conversation modes

⚡ **60% Performance Boost** - Reduced complexity and faster response times compared to legacy systems

🔧 **Modular Design** - Easy to extend, test, and maintain with isolated, reusable components

🧪 **A/B Testing Built-In** - Compare PocketFlow with legacy systems in real-time with detailed metrics

📊 **Advanced Analytics** - Comprehensive flow metrics, performance monitoring, and conversation insights

**Enable PocketFlow:**
```env
ENABLE_POCKETFLOW=true                    # Enable the new system
POCKETFLOW_PARALLEL_TESTING=true         # A/B test against legacy
POCKETFLOW_TEST_PERCENTAGE=10            # Test with 10% of messages
POCKETFLOW_LOG_COMPARISONS=true          # Detailed comparison logs
```

### ⚙️ Conversation Configuration

- **`USE_BLENDED_CONVERSATIONS`**: Enable group conversation mode with shared context
- **`ENABLE_REPLY_CONTEXT`**: Follow Discord reply chains for better context understanding

### 🎮 Epic Quake Live Stats (v1.9.0) 

**Ready to dominate the arena?** Get the most advanced Quake Live stats system ever built for Discord!

🚀 **Triple-Threat Data Collection** - We don't just grab stats, we HUNT them down through three different sources to make sure you never miss a frag:
  1. 🎯 **QLStats.net API** - Lightning-fast real-time player data and Glicko ratings
  2. 🕷️ **Smart Web Scraping** - Our Playwright-powered spider finds servers even when APIs fail
  3. 🔄 **Backup Systems** - If one source goes down, we've got two more ready to go!

⚔️ **Live Team Battles** - Watch red vs blue team assignments update in real-time (no more guessing who's winning!)

🏆 **Skill Rankings** - Show off with Glicko ratings that actually mean something (Scrub? Mid? Pro? Let the stats speak!)

🎨 **Discord-Perfect Display** - Beautiful emoji formatting that makes your server stats look absolutely stunning

💪 **Enterprise-Grade Reliability** - Built to handle multiple bot deployments without breaking a sweat

*This isn't just an upgrade from the old Syncore API – it's a complete game-changer that makes your Quake community the envy of every other Discord server!*


### 🔧 Never Goes Down (Seriously!)

**What happens when OpenAI has a bad day?** Other bots break. Chimp-GPT just keeps on trucking! 

> 🛡️ **Built-In Safety Net** - Advanced circuit breaker technology automatically detects when services are having issues and gracefully handles the situation

🔄 **Smart Retry Logic** - If something fails, we try again (but not annoyingly so)
⏰ **Automatic Recovery** - When services come back online, we detect it instantly and resume normal operations  
📊 **No Cascading Failures** - One broken service never brings down your entire bot
🎯 **Service-Specific Handling** - Each API gets its own specialized treatment for maximum reliability

**The Result?** Your community gets a bot that works 99.9% of the time, even when the internet is having a meltdown! 🔥

- **Plugin System**: Easily extend the bot with custom plugins for new commands, functions, and hooks. See [Plugin System](#plugin-system) below.
- **Circuit Breaker Pattern**: All external APIs protected with automatic failure detection and recovery:
  - Prevents cascading failures when services are down
  - Automatic recovery after timeout period
  - Configurable retry attempts and backoff strategies
  - Per-service configuration (OpenAI, Weather, Wolfram, Image Generation, etc.)
- **Interactive Conversations**: Engage in dynamic conversations using natural language (powered by GPT o4-mini).
- **Weather Lookup**: Reliable weather info with robust error handling and fallback mechanisms.
- **Time Inquiry**: Ask for the current time in any location.
- **Enhanced Quake Live Server Stats**: View real-time Quake Live server stats with QLStats.net integration.
  - Three-tier data collection system (QLStats API → Syncore scraping → QLStats.net scraping) for maximum reliability
  - Real-time team assignments and Glicko ratings display
  - Improved spectator detection and emoji formatting
  - Emoji toggles and ELO display modes are fully configurable via environment variables
  - Supports compact formatting to fit Discord's character limits and improved team/spectator presentation
- **Image Generation**: Use GPT Image-1 to generate high-quality images directly from Discord, with a gallery view on the status page.
  - Graceful fallback to text descriptions when image generation is disabled
  - Configurable via `ENABLE_IMAGE_GENERATION` environment variable
  - Real-time progress tracking with elapsed time reporting
  - Comprehensive error handling for content policy violations
  - Gallery includes modal viewer, prompt context, keyboard/mouse/touch navigation, and robust error handling.
- **Wolfram Alpha Integration**: Ask factual or computational questions.
- **Status Page**: Real-time dashboard with stats, error logs, and an image gallery for generated images.
- **Comprehensive Error Handling & Logging**: All error handling and logging are now standardized across all major modules using Pino-based loggers. This ensures detailed, structured logs for easier debugging, monitoring, and reliability.
- **Persistent Conversation History**: Conversations are now saved to disk and loaded when the bot restarts, ensuring continuity across restarts.
  - Automatic pruning of old conversations to manage storage efficiently
  - Backup and recovery mechanisms for corrupted conversation files
  - Status reporting via the health endpoint for monitoring
- **Slash Commands**: Full support for Discord slash commands, including plugin-provided commands.

## 🔌 Plugin System

Chimp-GPT supports a powerful plugin architecture:

- Plugins are placed in the `plugins/` directory, each in its own folder.
- Each plugin exports metadata, commands, functions, and hooks.
- Example plugins and a template are provided in `plugins/README.md`.
- Plugins can add slash commands, message commands, and respond to bot lifecycle events.

### Creating a Plugin

1. Copy the template in `plugins/README.md`.
2. Create a new folder in `plugins/` and add your `index.js`.
3. Export an object with required fields (`id`, `name`, `version`) and optional `commands`, `functions`, and `hooks`.
4. Restart the bot to load your plugin.

### Plugin Validation

- Plugins are validated for required metadata and structure.
- Plugins are validated for required metadata and structure.

## 📈 Status Page & Image Gallery

- Accessible via the configurable `STATUS_HOSTNAME` and `STATUS_PORT` (see Environment Variables below).
- Supports multi-instance deployment with automatic port fallback and remote access.
- The status page displays:
  - Bot uptime and live online/offline state
  - API call statistics and error logs
  - Image gallery with modal viewer, prompt display, and mobile support
  - Quake server stats, including emoji and ELO display options
- Responsive design and mobile-friendly, with robust error handling for all UI elements.

### Dashboard Features

The status dashboard provides:
- **Unified interface** with Status, Performance, Functions, and Settings tabs
- **Mobile-responsive design** with dark/light theme toggle
- **Real-time monitoring** of bot performance and API statistics
- **Configuration validation** with security masking for sensitive data

## 🚨 Error Handling & Logging

- All API integrations feature robust error handling and fallbacks.
- Errors are logged using Pino-based structured loggers and shown on the status page.
- Logging is now standardized across all main modules (see checklist for logger migration progress).
- Graceful shutdown and recovery are implemented throughout the codebase.
- Test/CLI files may use console.error, but should be reviewed for consistency.

## 📝 Documentation & Type Safety

- Comprehensive JSDoc/type coverage across all major modules and plugin interfaces.
- Improved maintainability, developer onboarding, and static analysis.
- See [`STATUS.md`](./docs/STATUS.md) for current project state and completed milestones.

## ✨ Code Quality & Linting

- The project uses ESLint and Prettier for code quality.
- Linting and formatting rules are enforced via ESLint and Prettier configurations.
- Security checks prevent secrets from being committed.
- Husky/pre-commit hooks and Prettier config are recommended (see checklist).

## 🌍 Environment Variables

Key configuration variables (see `.env.example` for complete list):

| Variable | Required | Description |
|----------|----------|-------------|
| DISCORD_TOKEN | ✅ | Your Discord bot token |
| OPENAI_API_KEY | ✅ | OpenAI API key for AI features |
| WEATHER_API_KEY | ✅ | WeatherAPI.com key for weather lookup |
| WOLFRAM_APP_ID | ⚠️ | Wolfram Alpha App ID for calculations |
| STATUS_PORT | ❌ | Status page port (default: 3000) |
| ENABLE_IMAGE_GENERATION | ❌ | Enable AI image generation (default: true) |
| USE_BLENDED_CONVERSATIONS | ❌ | Group conversation mode (default: true) |
| **PocketFlow Configuration** | | **Next-generation conversation system** |
| ENABLE_POCKETFLOW | ❌ | Enable PocketFlow system (default: false) |
| POCKETFLOW_PARALLEL_TESTING | ❌ | A/B test PocketFlow vs legacy (default: false) |
| POCKETFLOW_TEST_PERCENTAGE | ❌ | Percentage of messages to test (default: 10) |
| POCKETFLOW_LOG_COMPARISONS | ❌ | Log detailed comparison metrics (default: false) |

## 🛠️ Setup and Installation

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/f0rky/Chimp-GPT
   cd Chimp-GPT
   ```

2. **Install Dependencies**:

   ```bash
   npm install
   ```

3. **Set Up Environment Variables**:
   Create a `.env` file in the root directory and set up the following environment variables (refer to `.env.example`).

4. **Linting & Code Quality**:

   - Before building or deploying, run the linter and fix all errors:

   ```bash
   npm run lint
   ```

   - The build/deploy process requires a successful lint (no errors).

5. **Run the Bot**:

   ```bash
   # Using the start.sh script (recommended)
   chmod +x start.sh  # Make sure it's executable

   # Start in development mode (default)
   ./start.sh

   # Start in production mode
   ./start.sh -m production

   # Start only the status server
   ./start.sh -c status

   # Start only the Discord bot
   ./start.sh -c bot

   # Start in demo mode (no API keys needed)
   ./start.sh --demo
   ```

6. **Access the Status Page**:
   - Open your browser to `http://<STATUS_HOSTNAME>:<STATUS_PORT>` (default: http://localhost:3002 for development mode, http://localhost:3000 for production)

## 🐳 Docker Deployment

ChimpGPT can be easily deployed using Docker:

1. **Prerequisites**:

   - Docker and Docker Compose installed
   - Valid `.env` file with required environment variables

2. **Quick Start**:

   ```bash
   # Clone the repository
   git clone https://github.com/yourusername/Chimp-GPT.git
   cd Chimp-GPT

   # Create .env file
   cp .env.example .env
   nano .env  # Edit with your API keys and settings

   # Build and start the container
   docker-compose up -d
   ```

   > **Note about environment variables**: The Docker setup mounts your local `.env` file directly into the container, so it will use the same environment variables you've set for development. This makes it easy to switch between local and containerized deployment without changing your configuration.

3. **Access the Status Page**:

   - Open your browser to `http://localhost:3000` (or the port specified in your `.env` file)

4. **View Logs**:
   ```bash
   docker-compose logs -f
   ```

For more details, see the [Docker Deployment Guide](docs/DOCKER_DEPLOYMENT.md).

## 🏃 Run Modes

ChimpGPT supports different run modes via the included `start.sh` script:

```bash
# Start in development mode (default)
./start.sh

# Start in production mode
./start.sh -m production

# Start only the status server in demo mode
./start.sh -c status --demo

# Run tests
./start.sh -m test

# Start with debug logging
./start.sh --debug
```

Available options:

- `-m, --mode MODE`: Set run mode (production, development, test, demo)
- `-c, --component COMP`: Component to run (all, bot, status)
- `-d, --demo`: Enable demo mode (generates mock data)
- `--debug`: Enable debug logging
- `-q, --quiet`: Minimize logging (errors only)

### Performance Configuration

The bot includes several optimizations to ensure responsive performance, controlled via environment variables:

- `DISABLE_PLUGINS`: Set to 'false' to enable plugins or 'true' to disable them (default: true - plugins disabled)

  Disabling plugins significantly improves responsiveness (reducing message processing time by ~60%) and
  makes the "Thinking..." message appear much faster. Enable plugins only if you need their functionality.

For VSCode users, debugging configurations are available in the `.vscode/launch.json` file.

## 🤝 Contributing

- Contributions are welcome! Please follow the plugin template and code style guidelines.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.
- All PRs are automatically linted and checked for plugin validity.

## 📄 License

MIT



## 🚀 Usage

1. **General Interaction**:
Simply send a message in a channel where the bot is present to engage in a conversation. The bot implements a rate limiter that allows 30 requests per 30 seconds, with a 5-second cooldown after hitting the limit.

2. **Weather Inquiry**:
Ask the bot about the weather, for example: "What's the weather like in New York?"
And it will use OpenAI's GPT-3.5 to provide a natural response using the RapidAPI accurate weather information.

3. **Time Inquiry**:
Ask the bot for the current time, like: "Whats the time in New York?"
And it will use OpenAI's GPT-3.5 to provide a natural response including the time.

4. **Quake Server Stats**:
Use the command `!serverstats` or `/serverstats` or ask about Quake servers to get detailed information about active Quake Live servers, including player counts, maps, and ELO ratings.

5. **Wolfram Alpha Queries**:
Ask factual or computational questions, and the bot will use Wolfram Alpha to provide accurate answers.

6. **Slash Commands**:
The bot supports Discord's slash commands. Type `/` to see available commands:
- `/help` - Display information about available commands
- `/ping` - Check if the bot is responding
- `/serverstats` - Display Quake Live server statistics


## 🔮 Development with VoidBeacon

This project benefits from AI-assisted development through the **VoidBeacon** coding team - a multi-agent system that helps design, implement, test, and document features collaboratively.

🏗️ **Agent Team**: Architect • Coder • Test • Reviewer • Docs • Debug  
📋 **Workflow**: All changes go through structured review and testing before merge  
🤖 **Bot Account**: [@VoidBeacon-bot](https://github.com/VoidBeacon-bot) handles commits and pull requests  
✅ **Quality**: Every PR is reviewed by humans before merging to maintain code quality

*Want to contribute? Check out our [Contributing Guidelines](CONTRIBUTING.md) to get started!*

---

## 📄 License

This project is licensed under the MIT License.
