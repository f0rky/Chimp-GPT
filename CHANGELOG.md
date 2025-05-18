# Changelog

All notable changes to ChimpGPT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-05-18

### Added

- **Reply Context Enhancement**: Added intelligent message reference handling to provide better conversational context
  - Automatically detects and follows reply chains to extract conversation context
  - Preserves conversation flow across multiple messages and users
  - Configurable via new environment variables (`ENABLE_REPLY_CONTEXT`, `MAX_REFERENCE_DEPTH`, `MAX_REFERENCE_CONTEXT`)
  - Added comprehensive documentation in `/docs/REPLY_CONTEXT.md`
- Added a test script (`tools/testReplyContext.js`) for verifying reply context functionality

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
