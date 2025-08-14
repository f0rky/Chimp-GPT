/**
 * Test Setup Module
 *
 * This module provides setup and teardown functions for tests,
 * including environment variable management and test data isolation.
 *
 * @module TestSetup
 */

const path = require('path');
const fs = require('fs').promises;

// Test data directory
const TEST_DATA_DIR = path.join(__dirname, 'data');

/**
 * Setup test environment
 * Redirects production data paths to test data paths
 */
async function setupTestEnvironment() {
  // Store original environment variables
  const originalEnv = { ...process.env };

  // Set test environment
  process.env.NODE_ENV = 'test';
  process.env.TEST_DATA_DIR = TEST_DATA_DIR;

  // Ensure test data directory exists
  await fs.mkdir(TEST_DATA_DIR, { recursive: true });

  return {
    originalEnv,
    testDataDir: TEST_DATA_DIR,
  };
}

/**
 * Cleanup test environment
 * Restores original environment variables
 */
function cleanupTestEnvironment(originalEnv) {
  // Restore original environment
  process.env = originalEnv;
}

/**
 * Get test data file path
 */
function getTestDataPath(filename) {
  return path.join(TEST_DATA_DIR, filename);
}

/**
 * Mock function results module to use test data
 */
function mockFunctionResults() {
  // Mock the module to return test data paths
  const originalModule = require('../../src/core/functionResults');

  // Override the RESULTS_FILE path
  const testResultsFile = path.join(TEST_DATA_DIR, 'function-results.json');

  return {
    originalModule,
    testResultsFile,
  };
}

module.exports = {
  setupTestEnvironment,
  cleanupTestEnvironment,
  getTestDataPath,
  mockFunctionResults,
  TEST_DATA_DIR,
};
