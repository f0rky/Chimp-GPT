# Contributing to ChimpGPT

Thank you for your interest in contributing to ChimpGPT! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
  - [Setting Up the Development Environment](#setting-up-the-development-environment)
  - [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
  - [Branching Strategy](#branching-strategy)
  - [Commit Guidelines](#commit-guidelines)
  - [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
  - [Code Style](#code-style)
  - [Documentation](#documentation)
  - [Testing](#testing)
- [Plugin Development](#plugin-development)
- [Reporting Issues](#reporting-issues)
- [Feature Requests](#feature-requests)

## Code of Conduct

Please be respectful and considerate of others when contributing to the project. We aim to foster an inclusive and welcoming community.

## Getting Started

### Setting Up the Development Environment

1. **Fork the repository**:

   - Click the "Fork" button at the top right of the repository page.

2. **Clone your fork**:

   ```bash
   git clone https://github.com/YOUR_USERNAME/Chimp-GPT.git
   cd Chimp-GPT
   ```

3. **Install dependencies**:

   ```bash
   npm install
   ```

4. **Set up environment variables**:

   - Copy `.env.example` to `.env`
   - Fill in the required values (Discord token, OpenAI API key, etc.)

   ```bash
   cp .env.example .env
   ```

5. **Set up Husky hooks**:
   ```bash
   npm run prepare
   ```

### Project Structure

- **Core Files**:

  - `src/core/chimpGPT.js` - Main bot initialization and Discord client setup
  - `src/conversation/flow/PocketFlowConversationManager.js` - Modern graph-based conversation system
  - `src/conversation/conversationManager.js` - Legacy conversation context management
  - `src/services/imageGeneration.js` - DALL-E image generation
  - `src/web/statusServer.js` - Status page server

- **PocketFlow System (v2.0+)**:

  - `src/conversation/flow/nodes/` - Modular conversation processing nodes
  - `src/conversation/flow/flows/` - Individual, Blended, and Command flows
  - `src/conversation/flow/ConversationStore.js` - Graph-based state management
  - `src/conversation/pocketFlowAdapter.js` - Compatibility layer

- **Commands**:

  - `src/commands/` - Command implementations

- **Plugins**:

  - `src/plugins/` - Plugin system and plugin implementations

- **Services**:

  - `src/services/` - External API integrations (OpenAI, weather, etc.)

- **Utilities**:

  - `utils/` - Utility functions and helpers
  - `src/core/logger.js` - Logging system

- **Tests**:
  - `tests/` - Test files

## Development Workflow

### Branching Strategy

- `main` - Production-ready code
- `develop` - Development branch for integrating features
- `feature/feature-name` - Feature branches
- `bugfix/bug-name` - Bug fix branches

### Commit Guidelines

We follow conventional commit messages:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code changes that neither fix bugs nor add features
- `test:` - Adding or updating tests
- `chore:` - Changes to the build process or auxiliary tools

Example:

```
feat: add weather forecast command
```

### Pull Request Process

1. Create a new branch from `develop`
2. Make your changes
3. Run tests: `npm test`
4. Format code: `npm run format`
5. Create a pull request to the `develop` branch
6. Wait for review and address any feedback

## Coding Standards

### Code Style

We use ESLint and Prettier to maintain code quality and consistency:

- Run `npm run lint` to check for linting issues
- Run `npm run format` to automatically format code

See [FORMATTING.md](./docs/FORMATTING.md) for detailed formatting guidelines.

### Documentation

- Add JSDoc comments to all functions, classes, and modules
- Keep README.md and other documentation up to date
- Document complex logic with inline comments

Example JSDoc:

```javascript
/**
 * Processes a message using OpenAI's GPT model
 *
 * @param {string} content - The user's message content
 * @param {Array<Object>} conversationLog - The conversation history
 * @returns {Promise<Object>} The response from OpenAI
 * @throws {Error} If the API call fails
 */
async function processOpenAIMessage(content, conversationLog) {
  // Implementation
}
```

### Testing

- Write tests for new features and bug fixes
- Run tests before submitting a pull request: `npm test`
- Ensure all tests pass before submitting

## PocketFlow Development

ChimpGPT v2.0+ features the PocketFlow architecture for advanced conversation management.

### Working with PocketFlow

**Core Concepts:**
- **Nodes**: Modular processing units (Intent Detection, Context Management, Response Routing, Function Execution)
- **Flows**: Complete conversation workflows (Individual, Blended, Command)
- **Shared Store**: Graph-based state management with automatic cleanup

**Adding New Nodes:**
1. Extend `BaseConversationNode` in `src/conversation/flow/nodes/`
2. Implement required methods: `process()`, `handleError()`, `cleanup()`
3. Register in the appropriate flow configuration
4. Add comprehensive tests

**Creating New Flows:**
1. Create flow class in `src/conversation/flow/flows/`
2. Define node connections and data flow
3. Register with `PocketFlowConversationManager`
4. Add configuration options and metrics

**A/B Testing:**
- Enable parallel testing with `POCKETFLOW_PARALLEL_TESTING=true`
- Compare performance metrics between legacy and PocketFlow systems
- Use detailed logging for debugging and optimization

See [src/conversation/flow/README.md](./src/conversation/flow/README.md) for comprehensive PocketFlow documentation.

## Plugin Development

ChimpGPT has a plugin system that allows extending functionality without modifying core code.

See [src/plugins/README.md](./src/plugins/README.md) for detailed plugin development guidelines.

Key plugin hooks:

- `onMessageReceived` - Called when a message is received
- `onBotStart` - Called when the bot starts
- `onBotShutdown` - Called when the bot shuts down

## Reporting Issues

When reporting issues, please include:

1. Description of the issue
2. Steps to reproduce
3. Expected behavior
4. Actual behavior
5. Environment information (Node.js version, OS, etc.)
6. Logs or error messages

## Feature Requests

For feature requests, please describe:

1. The problem you're trying to solve
2. Your proposed solution
3. Alternative solutions you've considered
4. Any additional context or screenshots

---

Thank you for contributing to ChimpGPT! Your efforts help make the project better for everyone.
