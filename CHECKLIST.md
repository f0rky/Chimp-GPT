# ChimpGPT Implementation Checklist

> **Contributors:** Please keep this checklist updated as you work on the project. Add new features, fixes, and best practices so the team stays aligned!

## 🚀 Current Focus: Dashboard Enhancement

- [ ] **Dashboard Implementation**
  - [x] Basic dashboard layout and styling
  - [x] Real-time performance metrics display
  - [x] API status monitoring
  - [x] Memory usage visualization
  - [x] Connect to actual API endpoints for real data
  - [x] Add error handling for API connection failures
  - [x] Add historical data storage and analysis
  - [x] Create mobile-responsive design
  - [ ] Add dark/light mode toggle

## ⚠️ Issues/Items to Fix (from Code Review)

- [x] **GPT Image-1 integration fixes:**

  - [x] Fix URL extraction from GPT Image-1 API response to handle different response formats
  - [x] Add better error handling and logging for image generation
  - [x] Update status display to show meaningful actions instead of "to username"
  - [x] Complete migration from DALL-E to GPT Image-1 in all references
  - [x] Fix parameter naming: use `output_format` instead of `response_format` for GPT Image-1
  - [x] Add timing and cost details to image generation output
  - [x] Implement rate limiting for image creation (5 per hour per user, unlimited for owner)

- [x] **Enhanced status updates:**

  - [x] Add progress indicators for long-running operations (counters, elapsed time)
  - [x] Update loading icon/message for delayed responses
  - [x] Implement contextual status updates for image generation (showing both generating and completed phases)
  - [x] Implement contextual status updates that change every 5 seconds for long API calls
  - [x] Respect global rate limiter for status updates
  - [x] Add more detailed context to status messages for ongoing operations

- [x] **Granular plugin error logging:** Enhanced error logging in pluginManager.js to include detailed context such as plugin name, version, author, argument details (sanitized), timestamp, error type/code, and hook type for easier debugging.
- [x] **Circuit breaker/retry for external APIs:** (OpenAI API calls now use retry and circuit breaker logic) No evidence of a true circuit breaker or retry/backoff logic for OpenAI, weather, or Quake integrations. Add robust retry/circuit breaker patterns to handle flaky APIs.
  - [x] **Human-in-the-loop circuit breaker:** Implemented comprehensive human approval system that integrates with the existing circuit breaker. Added ability to request owner approval for sensitive operations with detailed notifications and slash commands for approving/denying requests.
  - [x] **Bot versioning and self-query:** Implemented comprehensive version system with self-query capabilities. Added version command, natural language version queries via @[@prompt], and integrated version info into the human circuit breaker system and status page.
- [x] **Persistent conversation history:** Implemented persistent conversation storage with automatic loading on startup and saving on shutdown, plus periodic saving to prevent data loss. Added backup and recovery mechanisms for corrupted files, automatic pruning of old conversations, and status reporting.
  - [x] **System message preservation:** Ensure the system message (bot personality) is always preserved at index 0 (done).
- [x] **Test coverage:** Significantly improved test coverage by adding comprehensive tests for core features:
  - [x] **Image generation tests:** Added tests for DALL-E integration, image downloads, and circuit breaker patterns
  - [x] **Message handler tests:** Added tests for command parsing, message filtering, and error handling
  - [x] **Rate limiter tests:** Added tests for different configurations, multiple users, and specialized limiters
  - [x] **Conversation persistence tests:** Added tests for saving, loading, pruning, and error recovery
  - [x] **Test runner:** Updated to include all new tests and ensure proper execution
- [x] **Prettier config/enforcement:** Added Prettier configuration (.prettierrc), integrated with ESLint, and set up Husky pre-commit hooks with lint-staged to enforce code formatting standards.
- [x] **Contributor documentation:** Added comprehensive CONTRIBUTING.md with guidelines for new contributors, including setup instructions, workflow, coding standards, and issue reporting.
- [x] **Plugin command name conflict validation:** Added validation to prevent duplicate command names across plugins during registration, with conflict tracking and detailed logging.
- [x] **Plugin README improvement:** Enhanced plugins/README.md with detailed hook documentation, fallback behavior explanation, and improved examples.
- [x] **Advanced error handling:** Implemented comprehensive error handling system with custom error classes, utility functions, and detailed documentation.
- [x] **Security review:** Review OpenAI/Discord API usage for security best practices (e.g., input sanitization, rate limiting on commands, API key rotation). Created comprehensive security review document with recommendations.
  - [x] **Input sanitization:** Implemented comprehensive input sanitization across all external API integrations (OpenAI, Weather, Time, Wolfram Alpha, Quake) to prevent injection attacks and ensure secure data handling.
  - [x] **API key management:** Created a centralized API key management system with usage tracking, error monitoring, and rotation support. Updated all external API integrations to use the secure key manager.
- [x] **Upgrade undici:** Upgrade undici to version 6.21.2 or later to fix Dependabot security alert in package-lock.json.
- [x] **Docker/CI/CD:** Added Dockerfile, docker-compose.yml, and GitHub Actions workflows for CI/CD. Created comprehensive deployment documentation and container configuration for easier deployment and automated testing.
- [x] **User preference storage:** Added persistent user preferences system with support for ELO display modes and emoji toggles.
- [x] **Command-line run modes:** Added support for different run modes via CLI args (production, development, test, demo) with the runModes.js module and start.sh script. Implemented component-specific startup options (bot-only, status-only) and demo mode with mock data generation.
- [x] **Debugging configs:** Added VSCode debugging configurations in .vscode/launch.json for the combined app, bot-only, status-only, and test debugging.
- [x] **Configurable bot name, hostname, port (status page):** Status page now supports BOT_NAME, STATUS_HOSTNAME, and STATUS_PORT environment variables for flexible deployment (done). Fixed issues with app variable reference in statusServer.js to ensure proper startup.
- [x] **Emoji toggles and ELO display for Quake stats:** Added SHOW_TEAM_EMOJIS, SHOW_SERVER_STATS_EMOJIS, and ELO_DISPLAY_MODE environment variables. Team/spectator formatting improved (done).
- [x] **Image gallery modal/mobile/error handling:** Status page image gallery includes modal viewer, mobile support, and robust error handling (done).
- [x] **Logger standardization (Pino):** All main modules now use Pino-based logger for error handling and debugging. Test/CLI files reviewed for consistency (done; see README for details).

---

## Targeted Function Enhancement: `greeting`

### Instructions

- **Assessment:** Begin by conducting a thorough examination of the 'greeting' function, noting any discrepancies, limitations, or areas ripe for enhancement.
- **Modification:** With meticulous care and a bold vision, rewrite or augment the existing code. Whether it be through introducing new algorithms, refining dialogue models, or integrating advanced forms of witty banter, your expertise will lead the way.
- **Test and Feedback Loop:** Implement the modified functionalities and observe them in action. Engage in a cycle of testing and refinement, with each iteration guided by the principles of creativity, efficiency, and user delight.

## High Priority (Easier Implementation)

### Code Structure & Architecture

- [x] Refactor the weather API integration to use a single consistent approach (now unified on weatherLookup.js, legacy code removed)
- [x] Consolidate error handling patterns across modules (Logging is now standardized across all main modules with Pino-based loggers. Error handling is consistent and robust.)
- [x] Add stricter type-checking for plugin interfaces and function arguments (JSDoc or TypeScript) (JSDoc/type coverage is comprehensive across all major modules and plugin interfaces. Minor gaps may remain for new code.)
- [x] Logger standardization: All main modules now use Pino-based logger. Test/CLI files reviewed for consistency.
- [x] Add more granular logging for plugin execution errors (e.g., identify which plugin/hook failed)

### Security Improvements

- [x] Implement rate limiting for the status page to prevent DoS attacks
- [x] Add CORS protection for the status server

### Performance & Reliability

- [ ] Add circuit breaker pattern for external API calls
- [x] Implement graceful shutdown handling
- [x] Status page now reliably shows live bot online/offline state and name (backend/frontend integration)
- [x] Status server multi-port fallback and remote access confirmed working

## Medium Priority

### Functionality Enhancements

- [x] Add support for image generation using DALL-E or similar APIs
- [x] Add image gallery view for DALL-E generations in the status page (includes modal, mobile, error handling)
- [x] Status server now reads Discord status and bot name from persistent stats for accurate frontend display
- [ ] Implement persistent conversation history across bot restarts
- [ ] Add support for multiple languages
- [ ] Add image variation and editing capabilities to the DALL-E integration
- [ ] Support plugin command removal (for deprecated commands)

### Testing & Quality Assurance

- [ ] Add Prettier for consistent code formatting
- [ ] Set up Jest or Mocha for unit testing beyond the existing test files
- [ ] Implement pre-commit hooks with Husky to enforce linting/testing
- [ ] Add more comprehensive tests for the weather API integration

### Developer Experience

- [ ] Create contributor documentation and guidelines
- [ ] Implement debugging configurations (VSCode/other IDEs)
- [ ] Add proper command-line arguments for different run modes
- [ ] Validate uniqueness of plugin command names to avoid conflicts
- [ ] Document plugin mock fallback behavior in plugin README

## Lower Priority (More Complex Implementation)

### Code Structure & Architecture

---

## Forward-Looking Enhancements & AI Potential

- [ ] **Contextual Memory and Long-Term Conversation Retention:**  
       Implement advanced state management to enable the bot to retain and utilize conversation history across extended interactions and restarts, providing more natural, context-aware responses.

- [ ] **Dynamic and Diverse Content Generation:**  
       Integrate advanced NLP techniques and tune content generation algorithms to produce more varied, engaging, and contextually appropriate responses tailored to user needs.

- [ ] **Adaptive Learning and Personalization:**  
       Explore mechanisms for the bot to learn from user interactions and feedback, allowing it to refine its responses and adapt its style or strategies over time (e.g., via engagement metrics or explicit ratings).

- [ ] **Highly Modular Architecture:**  
       Refactor core systems into modular, easily extensible components, ensuring new features and integrations can be added or swapped with minimal friction.

- [ ] **Enhanced Error Diagnostics and Reporting:**  
       Expand error handling to include detailed diagnostics, structured error classes, and user-facing explanations for failures, making troubleshooting easier for both users and developers.

---

- [ ] Create a proper error handling system with customized error classes
- [x] Implement a plugin system for easier extension of bot functionality

### Testing & Quality Assurance

- [ ] Implement integration tests for API interactions
- [ ] Add test mocks for external dependencies (OpenAI, Discord, etc.)
- [ ] Add type checking with TypeScript or JSDoc + TypeScript checking
- [ ] Set up GitHub Actions or similar CI/CD pipeline

### Security Improvements

- [ ] Review OpenAI API usage for potential security concerns
- [ ] Add protection against Discord-specific exploits
- [ ] Implement API key rotation mechanism

### Functionality Enhancements

- [ ] Implement message components (buttons, select menus) for interactive responses
- [ ] Add user preference storage (database/file-based)
- [ ] Add voice channel capabilities for audio responses
- [ ] Implement context-aware command suggestions

### Deployment & Operations

- [ ] Add automated backup system for user conversation data
- [ ] Set up Docker containerization for easier deployment
- [ ] Implement proper versioning and release management
- [ ] Add automated rollback capabilities

## Completed Items

### Code Structure & Architecture

- [x] Implement a proper modular architecture (separate message handling from bot initialization)
- [x] Move function calls/definitions in chimpGPT.js to their own modules
- [x] Add logging infrastructure beyond console.log (Pino)
- [x] Fix main file reference in package.json (references messageHandler.js but main file is chimpGPT.js)
- [x] Implement a proper command router/handler system instead of direct message checks
- [x] Add JSDoc documentation to all functions
- [x] Organize codebase with clear directory structure (utils, archive, commands)
- [x] Create a proper configuration management system instead of accessing process.env directly
- [x] Rename main file from MOK_PLoW.js to chimpGPT.js for better clarity and consistency

### Testing & Quality Assurance

- [x] Configure a proper ESLint ruleset (it's installed but minimally configured)
- [x] Create basic testing infrastructure (conversationLogTest.js and testRunner.js)

### Performance & Reliability

- [x] Implement proper error recovery mechanisms
- [x] Add telemetry/monitoring to track bot performance and usage
- [x] Optimize conversation management for memory efficiency
- [x] Implement rate limiting for API calls to prevent quota issues
- [x] Add timeout protection for OpenAI API calls
- [x] Implement fallback mechanisms for API failures

### Security Improvements

- [x] Implement proper secrets management beyond .env files
- [x] Add environment variable validation on startup
- [x] Add input validation for all user inputs
- [x] Implement proper sanitization for outputs to prevent injection issues
- [x] Create proper .env.example file with documentation for required environment variables

### Functionality Enhancements

- [x] Implement a permissions system beyond channel restrictions
- [x] Add more configurable options for the Quake server stats display
- [x] Implement compact display format for Quake server stats to maximize Discord character limits
- [x] Create a help command with dynamic command discovery
- [x] Implement a command cooldown system to prevent abuse
- [x] Add slash command support (Discord's preferred interaction method)
- [x] Implement Wolfram Alpha integration for factual queries
- [x] Add configurable bot name display

### Deployment & Operations

- [x] Create proper deployment documentation beyond PM2 basics
- [x] Set up proper Git repository structure with appropriate security practices
- [x] Investigated why status page runs on ports 3000 and 3002 (both serve the same status page due to multi-instance/fallback logic; not a bug)
- [x] Implement a health check endpoint for monitoring
- [x] Create a status page/dashboard for bot health
- [x] Add configurable hostname and port settings for status page
- [x] Implement multi-instance deployment support

### Developer Experience

- [x] Set up a development environment with hot reloading (properly configured nodemon)
- [x] Create development vs. production environment separation
- [x] Add script aliases for common development tasks
- [x] Improve the README with detailed setup instructions and architecture documentation
- [x] Archive legacy code for reference while maintaining a clean working codebase
