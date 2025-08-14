# Testing Strategy and Guidelines

This document outlines the comprehensive testing strategy for the Chimp-GPT Discord Bot, including test organization, execution instructions, and coverage requirements.

## Overview

The testing framework provides comprehensive coverage across all critical components of the bot, ensuring reliability, performance, and maintainability. Our testing strategy follows industry best practices with a focus on practical, actionable test coverage.

## Test Architecture

### Test Categories

#### Unit Tests (`tests/unit/`)
- **Purpose**: Test individual components in isolation
- **Scope**: Single functions, classes, or modules
- **Mocking**: External dependencies are mocked
- **Speed**: Fast execution (<100ms per test)

#### Integration Tests (`tests/integration/`)
- **Purpose**: Test interaction between components
- **Scope**: End-to-end workflows and component integration
- **Mocking**: Minimal, focused on external APIs
- **Speed**: Moderate execution (<1s per test)

### Test Priority Levels

#### High Priority
- **SimpleChimpGPTFlow**: Core conversation logic and PocketFlow integration
- **Message Handling**: Complete message processing pipeline
- **Image Generation**: Image generation workflow and bypass logic
- **Input Sanitizer**: Security-critical input validation

#### Medium Priority
- **Command Processing**: Command parsing and slash command execution
- **Weather API**: Weather service integration and error handling
- **Circuit Breakers**: Fault tolerance and recovery mechanisms
- **API Key Manager**: Secure API key management

#### Low Priority
- **Error Classes**: Custom error handling classes
- **Utility Functions**: Supporting utility functions

## Test Suites

### 1. SimpleChimpGPTFlow Tests (`tests/unit/simpleChimpGPTFlowTest.js`)

**Coverage**: Core conversation flow functionality
- Intent detection and routing (image, weather, time, quake, conversation)
- Conversation memory and persistence
- Error handling and recovery
- Flow statistics and monitoring
- Conversation cleanup functionality

**Key Tests**:
- Image generation intent detection
- Weather request processing
- Conversation memory limits
- Error graceful handling
- Statistics accuracy

### 2. Image Generation Tests (`tests/unit/imageGenerationTest.js`)

**Coverage**: Image generation functionality and performance optimization
- Image request detection patterns
- Generation workflow and progress tracking
- Error handling (policy violations, rate limits, API errors)
- PFP manager integration
- Bypass logic performance optimization

**Key Tests**:
- Pattern matching accuracy (draw, create, generate commands)
- Workflow execution with mocked OpenAI API
- Error scenario handling
- Performance optimization validation
- PFP integration success/failure scenarios

### 3. Command Processing Tests (`tests/unit/commandProcessingTest.js`)

**Coverage**: Command handling system
- Command parsing with multiple prefixes (!, ., /)
- Slash command execution
- Permission checking (owner-only, admin-only)
- Command error handling
- Aliases and prefix management

**Key Tests**:
- Prefix parsing accuracy
- Permission validation
- Error recovery mechanisms
- Alias resolution
- Invalid command handling

### 4. Message Handling Integration Tests (`tests/integration/messageHandlingIntegrationTest.js`)

**Coverage**: Complete message processing pipeline
- Message event handling
- PocketFlow conversation management
- Response generation and formatting
- Error propagation through pipeline

**Key Tests**:
- End-to-end message processing
- Bot message filtering
- Response formatting validation
- Error handling across components
- Integration between components

### 5. Weather API Integration Tests (`tests/integration/weatherApiIntegrationTest.js`)

**Coverage**: Weather service integration
- Location parsing and validation
- API service calls with mocking
- Response formatting
- Error handling and fallback mechanisms
- PocketFlow integration

**Key Tests**:
- Location extraction from natural language
- API error scenario handling
- Response formatting consistency
- Fallback mechanism activation
- PocketFlow weather processing

## Test Execution

### Running All Tests

```bash
# Run comprehensive test suite
node tests/comprehensiveTestRunner.js

# Run with coverage reporting
node tests/comprehensiveTestRunner.js --save

# Filter by category
node tests/comprehensiveTestRunner.js --category unit
node tests/comprehensiveTestRunner.js --category integration

# Filter by priority
node tests/comprehensiveTestRunner.js --priority high
node tests/comprehensiveTestRunner.js --priority medium

# Filter by test name
node tests/comprehensiveTestRunner.js --filter "image"
```

### Running Individual Test Suites

```bash
# Original test suite (legacy)
npm test

# Individual new test suites
node tests/unit/simpleChimpGPTFlowTest.js
node tests/unit/imageGenerationTest.js
node tests/unit/commandProcessingTest.js
node tests/integration/messageHandlingIntegrationTest.js
node tests/integration/weatherApiIntegrationTest.js
```

### Package.json Scripts

```json
{
  "test": "node tests/unit/testRunner.js",
  "test:comprehensive": "node tests/comprehensiveTestRunner.js",
  "test:unit": "node tests/comprehensiveTestRunner.js --category unit",
  "test:integration": "node tests/comprehensiveTestRunner.js --category integration",
  "test:coverage": "node tests/comprehensiveTestRunner.js --save",
  "test:high-priority": "node tests/comprehensiveTestRunner.js --priority high"
}
```

## Test Coverage Requirements

### Coverage Goals
- **Overall Coverage**: >70% of source files
- **Critical Components**: >90% coverage
- **High Priority Tests**: 100% pass rate required
- **Integration Tests**: All critical paths covered

### Coverage Reporting
The comprehensive test runner provides:
- File coverage statistics
- Priority-based coverage breakdown
- Category-based coverage analysis
- Performance insights
- Failed test summaries

### Coverage Exclusions
- Third-party dependencies
- Configuration files
- Build/deployment scripts
- Development utilities

## Mocking Strategy

### Unit Test Mocking
- **OpenAI Client**: Mock all API calls with realistic responses
- **Discord.js**: Mock message objects, channels, and interactions
- **File System**: Mock file operations for security
- **External APIs**: Mock all external service calls

### Integration Test Mocking
- **External APIs Only**: Mock only external services (OpenAI, Weather API)
- **Internal Components**: Use real components for integration testing
- **Database/Storage**: Use in-memory or test-specific storage

### Mock Data Standards
- Realistic response structures
- Error scenario coverage
- Performance simulation
- Edge case handling

## Test Data Management

### Test Fixtures
Located in `tests/fixtures/`:
- Mock response data
- Test configuration files
- Sample user interactions
- Error scenario definitions

### Test Environment
- Isolated from production data
- Clean state for each test run
- Predictable test conditions
- No external dependencies

## Continuous Integration

### Pre-commit Testing
- Run high-priority tests
- Lint and format validation
- Security vulnerability checks
- Performance regression detection

### Full Test Suite
- Comprehensive coverage analysis
- Integration test execution
- Performance benchmarking
- Coverage reporting

## Debugging Tests

### Test Debugging
```bash
# Run with debug logging
DEBUG=* node tests/comprehensiveTestRunner.js

# Run specific failing test
node tests/unit/simpleChimpGPTFlowTest.js

# Enable detailed error reporting
node tests/comprehensiveTestRunner.js --verbose
```

### Common Issues
1. **Mock Configuration**: Ensure mocks match expected interfaces
2. **Async Handling**: Proper await/async usage in tests
3. **Test Isolation**: Tests should not depend on each other
4. **Resource Cleanup**: Proper cleanup after test completion

## Performance Testing

### Performance Benchmarks
- Test execution speed (<30 seconds total)
- Memory usage monitoring
- Resource leak detection
- Async operation timing

### Performance Thresholds
- Unit tests: <100ms per test
- Integration tests: <1s per test
- Total suite: <30s execution time
- Memory usage: <100MB peak

## Security Testing

### Security Test Coverage
- Input sanitization validation
- Authentication/authorization checks
- API key protection verification
- Error information disclosure prevention

### Security Test Categories
- **Input Validation**: SQL injection, XSS, command injection
- **Authentication**: Permission checking, role validation
- **Data Protection**: Sensitive data handling, logging security
- **Error Handling**: Information disclosure prevention

## Test Maintenance

### Adding New Tests
1. Identify component/feature requiring testing
2. Determine appropriate test category (unit vs integration)
3. Create test file following naming conventions
4. Add to comprehensive test runner
5. Update this documentation

### Test Review Process
- Peer review for all new tests
- Coverage impact assessment
- Performance impact evaluation
- Documentation updates

### Test Refactoring
- Regular review of test effectiveness
- Mock data accuracy updates
- Performance optimization
- Test consolidation opportunities

## Error Handling Testing

### Error Scenario Coverage
- Network failures
- API rate limiting
- Invalid user input
- Resource unavailability
- Permission violations

### Error Testing Strategy
- Graceful degradation verification
- Error message accuracy
- Recovery mechanism testing
- User experience preservation

## Reporting and Metrics

### Test Reports
- Coverage percentage by component
- Test execution time trends
- Failure rate analysis
- Performance regression tracking

### Metrics Dashboard
- Daily test execution results
- Coverage trend analysis
- Performance benchmark tracking
- Error pattern identification

## Best Practices

### Writing Tests
- Clear, descriptive test names
- Single concern per test
- Comprehensive edge case coverage
- Realistic mock data
- Proper cleanup and teardown

### Test Organization
- Logical file structure
- Consistent naming conventions
- Appropriate test categorization
- Shared utility functions
- Documentation maintenance

### Performance Optimization
- Efficient mock implementations
- Parallel test execution where safe
- Resource usage monitoring
- Test suite optimization

---

## Quick Reference

### Common Commands
```bash
# Full test suite with coverage
npm run test:coverage

# High priority tests only
npm run test:high-priority

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Legacy test suite
npm test
```

### Coverage Goals
- Overall: >70%
- Critical: >90%
- High Priority: 100% pass rate

### Test Categories
- **Unit**: Individual components
- **Integration**: Component interaction
- **High Priority**: Critical functionality
- **Medium Priority**: Important features
- **Low Priority**: Supporting utilities

This testing framework ensures comprehensive coverage while maintaining practical execution times and providing clear feedback on system health and test effectiveness.