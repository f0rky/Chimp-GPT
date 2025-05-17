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
  - `chimpGPT.js` - Main bot file
  - `conversationManager.js` - Manages conversation context
  - `conversationStorage.js` - Handles saving/loading conversations
  - `imageGeneration.js` - DALL-E image generation
  - `statusServer.js` - Status page server

- **Commands**:
  - `commands/` - Command implementations

- **Plugins**:
  - `plugins/` - Plugin system and plugin implementations

- **Utilities**:
  - `utils/` - Utility functions and helpers
  - `logger.js` - Logging system

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

## Plugin Development

ChimpGPT has a plugin system that allows extending functionality without modifying core code.

See [plugins/README.md](./plugins/README.md) for detailed plugin development guidelines.

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
