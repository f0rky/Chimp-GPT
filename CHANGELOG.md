# Changelog

All notable changes to ChimpGPT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
