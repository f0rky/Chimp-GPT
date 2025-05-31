/**
 * Human Circuit Breaker Tests
 *
 * Tests for the human circuit breaker functionality including
 * approval requests, notifications, and integration with the main circuit breaker
 *
 * @module HumanCircuitBreakerTest
 */

const { createLogger } = require('../logger');
const logger = createLogger('humanCircuitBreakerTest');

async function testHumanCircuitBreaker() {
  const results = [];

  try {
    // Load the module
    const humanCircuitBreaker = require('../utils/humanCircuitBreaker');

    // Test 1: Check sensitive operations constants
    try {
      const operations = humanCircuitBreaker.SENSITIVE_OPERATIONS;
      const expectedOps = [
        'DATA_WRITE',
        'COMMAND_EXECUTION',
        'API_CALL',
        'SYSTEM_CHANGE',
        'PLUGIN_ACTION',
      ];

      const hasAllOps = expectedOps.every(op => operations[op] !== undefined);
      const allStrings = Object.values(operations).every(val => typeof val === 'string');

      results.push({
        name: 'Sensitive Operations Constants',
        success: hasAllOps && allStrings,
        operationCount: Object.keys(operations).length,
        hasAllExpected: hasAllOps,
      });
    } catch (error) {
      results.push({
        name: 'Sensitive Operations Constants',
        success: false,
        error: error.message,
      });
    }

    // Test 2: Request approval function exists and has correct signature
    try {
      const hasRequestFunction = typeof humanCircuitBreaker.requestHumanApproval === 'function';
      const funcLength = humanCircuitBreaker.requestHumanApproval.length;

      // Function should accept 4 parameters: details, onApprove, onDeny, client
      const correctSignature = funcLength === 4;

      results.push({
        name: 'Request Approval Function',
        success: hasRequestFunction && correctSignature,
        functionExists: hasRequestFunction,
        parameterCount: funcLength,
      });
    } catch (error) {
      results.push({
        name: 'Request Approval Function',
        success: false,
        error: error.message,
      });
    }

    // Test 3: Check other exported functions
    try {
      const hasExecuteWithApproval = typeof humanCircuitBreaker.executeWithApproval === 'function';
      const hasRequiresApproval = typeof humanCircuitBreaker.requiresHumanApproval === 'function';
      const hasCreateMessage = typeof humanCircuitBreaker.createApprovalMessage === 'function';

      results.push({
        name: 'Approval Management Functions',
        success: hasExecuteWithApproval && hasRequiresApproval && hasCreateMessage,
        hasExecuteFunction: hasExecuteWithApproval,
        hasRequiresFunction: hasRequiresApproval,
        hasCreateMessageFunction: hasCreateMessage,
      });
    } catch (error) {
      results.push({
        name: 'Approval Management Functions',
        success: false,
        error: error.message,
      });
    }

    // Test 4: Module exports structure
    try {
      const exports = Object.keys(humanCircuitBreaker);
      const requiredExports = ['SENSITIVE_OPERATIONS', 'requestHumanApproval'];
      const hasRequiredExports = requiredExports.every(exp => exports.includes(exp));

      results.push({
        name: 'Module Exports',
        success: hasRequiredExports,
        exportCount: exports.length,
        exports: exports,
      });
    } catch (error) {
      results.push({
        name: 'Module Exports',
        success: false,
        error: error.message,
      });
    }

    // Test 5: Integration with circuit breaker
    try {
      // Check if the module correctly imports circuit breaker dependencies
      const circuitBreaker = require('../circuitBreaker');
      const breakerManager = require('../breakerManager');

      const hasCircuitBreaker = !!circuitBreaker;
      const hasBreakerManager = !!breakerManager;

      results.push({
        name: 'Circuit Breaker Integration',
        success: hasCircuitBreaker && hasBreakerManager,
        hasCircuitBreaker,
        hasBreakerManager,
      });
    } catch (error) {
      results.push({
        name: 'Circuit Breaker Integration',
        success: false,
        error: error.message,
      });
    }
  } catch (error) {
    logger.error({ error }, 'Error in human circuit breaker tests');
    return {
      success: false,
      error: error.message,
      results,
    };
  }

  // Calculate overall success
  const success = results.every(r => r.success);

  return {
    success,
    results,
  };
}

// Export for test runner
module.exports = { testHumanCircuitBreaker };

// Run tests if called directly
if (require.main === module) {
  testHumanCircuitBreaker().then(results => {
    console.log('Human Circuit Breaker Test Results:', JSON.stringify(results, null, 2));
    process.exit(results.success ? 0 : 1);
  });
}
