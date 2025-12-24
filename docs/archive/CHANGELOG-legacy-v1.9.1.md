# Changelog

All notable changes to ChimpGPT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.9.1] - 2025-07-07

### Major Milestone - Phase 3 & 4 Modular Architecture Completion

#### ✨ Features
- **Modular Architecture Continuation**: Completed Phase 3 & 4 of the systematic refactoring
- **Feature Handler Extraction**: All major feature handlers now properly modularized
- **Utility Function Extraction**: Core utility functions extracted into focused modules
- **Dependency Injection Patterns**: Established consistent patterns across all extracted modules

#### 🏗️ Structural Changes
- **Phase 3 - Feature Handlers (525 lines extracted)**:
  - `handleImageGeneration` → `src/handlers/imageGenerationHandler.js` (413 lines)
  - `handleQuakeStats` → `src/handlers/quakeStatsHandler.js` (67 lines)
  - `handleDirectMessage` → `src/handlers/directMessageHandler.js` (45 lines)

- **Phase 4 - Utilities (66 lines extracted)**:
  - `formatSubtext` → `src/handlers/responseFormatter.js` (30 lines)
  - `storeMessageRelationship` → `src/handlers/messageRelationships.js` (36 lines)

#### 🔧 Technical Improvements
- **Dependency Injection**: All modules use clean dependency patterns for testability
- **Single Responsibility**: Each module now handles one specific concern
- **Import Organization**: Clean separation of concerns and proper module boundaries
- **Memory Management**: Message relationships module includes automatic cleanup
- **Error Handling**: Consistent error patterns and logging across all modules

#### 📊 Progress Metrics
- **Total Lines Extracted**: ~1,851 lines (62% of original 2,999-line file)
- **Modules Completed**: 8 of 11 planned modules
- **Main File Reduction**: From 2,999 to ~1,400 lines (53% reduction)
- **Phases Completed**: Phase 1, 2A, 3, and 4 ✅

#### 🎯 Remaining Work
- Phase 2B: `functionCallProcessor.js` (~400 lines)
- Phase 2C: `responseGenerator.js` (~150 lines)
- Target: Reduce main file to ~200 lines

#### ✅ Quality Assurance
- All extracted modules compile without errors
- Dependency injection patterns tested and working
- Clean import/export structure maintained
- Git history preserved for all changes

## [1.8.0] - 2025-06-29

### Major Release - Complete Architecture Reorganization

#### ✨ Features
- **Root Directory Cleanup**: Complete reorganization of project structure for better maintainability
- **Modular Architecture**: All source code now properly organized in `src/` directory with logical groupings
- **Documentation Consolidation**: Moved all documentation files to centralized `docs/` directory

#### 🏗️ Structural Changes
- **File Moves (92 files)**: Preserved git history while reorganizing entire codebase
  - `functionResults.js` → `src/core/functionResults.js`
  - `getBotVersion.js` → `src/core/getBotVersion.js` 
  - `statsStorage.js` → `src/core/statsStorage.js`
  - `imageUsageTracker.js` → `src/services/imageUsageTracker.js`
  - `commands/` → `src/commands/`
  - `errors/` → `src/errors/`
  - `tools/` → `src/tools/`
  - `plugins/` → `src/plugins/`
  - `public/` → `src/web/public/`
  - Documentation files → `docs/`

#### 🔧 Technical Improvements
- **Import Path Fixes**: Updated 329+ import statements across entire codebase
- **Clean Root Directory**: Reduced root directory clutter from 25+ items to 15 organized items
- **Plugin System**: Unified plugin structure with all plugins in `src/plugins/`
- **Web Assets**: Organized all web content under `src/web/public/`
- **Error Handling**: Centralized custom error classes in `src/errors/`

#### 📁 New Directory Structure
```
├── 📦 Package Management: package.json, package-lock.json
├── ⚙️ Configuration: ecosystem.config.js, eslint.config.js
├── 🐳 Deployment: Dockerfile, docker-compose.yml  
├── 📚 Documentation: README.md, CHANGELOG.md, LICENSE
├── 🏗️ Source Code: src/ (commands/, core/, services/, etc.)
├── 📖 Docs: docs/ (consolidated documentation)
├── 💾 Data: data/, assets/ (runtime data)
├── 🧪 Development: tests/, utils/, scripts/
└── 📁 Archive: archive/ (historical files)
```

#### ✅ Quality Assurance
- **Zero Breaking Changes**: All functionality preserved and verified working
- **Import Validation**: Bot starts successfully without any import errors
- **Git History**: All file moves preserve complete git history
- **Linting**: All code passes ESLint validation
- **Testing**: Confirmed image generation, conversation management, and all features working

#### 🎯 Benefits
- **Developer Experience**: Easier navigation and file discovery
- **Maintainability**: Clear separation of concerns and logical grouping
- **Scalability**: Structure supports continued growth and new features
- **Onboarding**: New developers can understand codebase structure quickly
- **Standards**: Follows Node.js project best practices

## [1.7.2] - 2025-06-29

### Fixed
- **Health Check Startup Message**: Fixed compatibility issue with Discord.js v14.21.0
  - Removed non-existent `client.rest.requestManager` property check that was causing 19/20 retry failures
  - Removed non-existent `client.rest.agent` property check
  - Enhanced client readiness validation with detailed condition logging
  - Health check startup message now sends reliably without retry failures
  - Maintains robust health monitoring system while fixing Discord.js v14 compatibility

## [1.7.1] - 2025-06-26

### Added
- **Token Usage Logging**: Comprehensive logging for OpenAI API token consumption
  - Detailed breakdown of prompt tokens including system message, user messages, and function definitions
  - Message previews and length tracking for debugging
  - Helps identify optimization opportunities

### Fixed
- **Client Readiness Check**: Added client.isReady() check in messageCreate event to prevent errors during bot initialization
- **Message Update Handler**: Fixed error when processing message updates by adding client readiness validation

### Security
- Updated tar-fs from vulnerable version to 2.1.3

### Changed
- Migrated from GPT-3.5-turbo and GPT-4o-mini to GPT-4.1-nano model

## [1.7.0] - 2025-06-01

### Added
- **Circuit Breaker Pattern**: Implemented circuit breaker for all external API calls
  - Added to `timeLookup.js`, `wolframLookup.js`, and `imageGeneration.js`
  - Prevents cascading failures and provides automatic recovery
  - Configurable retry limits and timeouts per service
- **Unified Dashboard**: Merged all dashboards into single tabbed interface
  - Status, Performance, Functions, and Settings tabs
  - Consistent theme and navigation
  - Mobile-responsive design
  - Debug console at bottom left
- **Pre-moderation for Images**: Client-side content filtering
  - Instant rejection of problematic content
  - Prevents waiting for OpenAI's slow moderation
  - Clear user feedback for policy violations
- **Image Generation Timeout**: 30-second timeout for image requests
  - Prevents indefinite waiting
  - Better user experience for slow API responses

### Fixed
- **Dashboard Response Time Display**: Fixed API field naming issues
  - Changed from camelCase to underscore format (e.g., `message_processing`)
  - Response times now display correctly instead of "0 ms"
- **Image Gallery Display**: Fixed image loading in Functions tab
  - Corrected data structure parsing for `gptimage` results
  - Fixed 404 errors when loading base64 image data
- **Content Policy Handling**: Improved handling of violations
  - Non-retryable errors now fail immediately
  - Reduced wait time from 2+ minutes to instant/30s max
  - Better error messages for users

### Changed
- **Retry Logic**: Improved retry mechanism
  - Added detection for non-retryable errors
  - Configurable backoff limits
  - Reduced image generation retries from 2 to 1
- **ESLint Compliance**: Fixed all critical linting errors
  - Added default cases to switch statements
  - Fixed missing radix parameters
  - Resolved unused variable warnings

### Performance
- **Bandwidth Optimization**: Dashboard now uses 99.99% less bandwidth
  - Summary endpoints instead of full data
  - Increased update intervals
  - Better caching strategies

## [1.2.2] - 2025-05-20

### Added
- **Rate Limiting for PFP Updates**: Implemented rate limiting for profile picture updates to prevent hitting Discord's rate limits
  - Minimum 30-minute interval between PFP updates
  - Better error handling and logging for PFP update failures
  - Automatic backoff when rate limited by Discord

### Fixed
- Fixed scope issue with `generationTime` in `handleImageGeneration`
- Improved error handling for content policy violations in image generation
  - Added proper error propagation for content policy violations
  - Fixed bot hanging on content policy violations
  - Added better error messages for users when content is blocked
- Enhanced logging and state management for PFP updates

### Changed
- Increased default PFP rotation interval to 30 minutes
- Improved error messages for content policy violations

## [1.2.1] - 2025-05-19

### Fixed
- Fixed weather API integration and server count detection
- Improved rate limiting for API calls

## [1.1.0] - 2025-05-18

### Added

- **Reply Context Enhancement**: Added intelligent message reference handling to provide better conversational context
  - Automatically detects and follows reply chains to extract conversation context
  - Preserves conversation flow across multiple messages and users
  - Configurable via new environment variables (`ENABLE_REPLY_CONTEXT`, `MAX_REFERENCE_DEPTH`, `MAX_REFERENCE_CONTEXT`)
  - Added comprehensive documentation in `/docs/REPLY_CONTEXT.md`
- Added a test script (`src/tools/testReplyContext.js`) for verifying reply context functionality

### Changed

- Updated conversation manager to support asynchronous reference resolution
- Enhanced message handling to pass Discord message objects for reference extraction
- Improved conversation pruning to better preserve contextual messages
- Updated configuration validator with new reply context options
- Added detailed logging for reply context processing

### Fixed

- Fixed potential issue where conversation context could be lost across reply chains
- Ensured system message is always preserved in conversation history
- Added proper error handling for message reference resolution failures

## [1.0.2] - Previous Release

Initial tracked version
