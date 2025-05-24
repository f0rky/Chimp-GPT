/**
 * API Key Manager Tests
 * 
 * Tests for the API key management functionality including
 * key retrieval, masking, usage tracking, rotation, and error handling
 * 
 * @module ApiKeyManagerTest
 */

const { createLogger } = require('../logger');
const logger = createLogger('apiKeyManagerTest');
const fs = require('fs').promises;
const path = require('path');

async function testApiKeyManager() {
  const results = [];
  let apiKeyManager;
  const testDataDir = path.join(process.cwd(), 'tests', 'temp');
  const testKeyUsageFile = path.join(testDataDir, 'test_key_usage.json');

  try {
    // Setup test environment
    await fs.mkdir(testDataDir, { recursive: true });

    // Save original env vars
    const originalEnv = { ...process.env };
    
    // Set test API keys
    process.env.OPENAI_API_KEY = 'test-openai-key-1234567890';
    process.env.WEATHER_API_KEY = 'test-weather-key-abcdefgh';
    process.env.WOLFRAM_API_KEY = 'test-wolfram-key-xyz12345';

    // Mock the data directory for testing
    const originalDataDir = path.join(process.cwd(), 'data');
    
    // Load the API key manager module
    apiKeyManager = require('../utils/apiKeyManager');

    // Test 1: Get API key
    try {
      const openAIKey = apiKeyManager.getApiKey('OPENAI_API_KEY');
      const success = openAIKey === 'test-openai-key-1234567890';

      results.push({
        name: 'Get API Key',
        success,
        keyRetrieved: !!openAIKey
      });
    } catch (error) {
      results.push({
        name: 'Get API Key',
        success: false,
        error: error.message
      });
    }

    // Test 2: Mask API key
    try {
      const testKeys = [
        { key: 'sk-1234567890abcdef', expected: 'sk-1234...cdef' },
        { key: 'short', expected: 'sh...rt' },
        { key: '12345678901234567890', expected: '1234...7890' },
        { key: '', expected: '' }
      ];

      let allMasked = true;
      for (const test of testKeys) {
        const masked = apiKeyManager.maskKey(test.key);
        if (masked !== test.expected) {
          allMasked = false;
          logger.error({ key: test.key, expected: test.expected, actual: masked }, 'Key masking mismatch');
        }
      }

      results.push({
        name: 'Mask API Key',
        success: allMasked,
        testCases: testKeys.length
      });
    } catch (error) {
      results.push({
        name: 'Mask API Key',
        success: false,
        error: error.message
      });
    }

    // Test 3: Track API key usage
    try {
      // Track usage
      apiKeyManager.trackUsage('OPENAI_API_KEY');
      apiKeyManager.trackUsage('OPENAI_API_KEY');
      apiKeyManager.trackUsage('WEATHER_API_KEY');

      // Get usage stats
      const openAIUsage = apiKeyManager.getKeyUsage('OPENAI_API_KEY');
      const weatherUsage = apiKeyManager.getKeyUsage('WEATHER_API_KEY');

      const success = openAIUsage.usageCount === 2 && weatherUsage.usageCount === 1;

      results.push({
        name: 'Track API Key Usage',
        success,
        openAIUsage: openAIUsage.usageCount,
        weatherUsage: weatherUsage.usageCount
      });
    } catch (error) {
      results.push({
        name: 'Track API Key Usage',
        success: false,
        error: error.message
      });
    }

    // Test 4: Track API key errors
    try {
      // Track errors
      apiKeyManager.trackError('OPENAI_API_KEY', new Error('Test error 1'));
      apiKeyManager.trackError('OPENAI_API_KEY', new Error('Test error 2'));
      apiKeyManager.trackError('WOLFRAM_API_KEY', new Error('Test error'));

      // Get usage stats with errors
      const openAIUsage = apiKeyManager.getKeyUsage('OPENAI_API_KEY');
      const wolframUsage = apiKeyManager.getKeyUsage('WOLFRAM_API_KEY');

      const success = openAIUsage.errorCount === 2 && wolframUsage.errorCount === 1;

      results.push({
        name: 'Track API Key Errors',
        success,
        openAIErrors: openAIUsage.errorCount,
        wolframErrors: wolframUsage.errorCount
      });
    } catch (error) {
      results.push({
        name: 'Track API Key Errors',
        success: false,
        error: error.message
      });
    }

    // Test 5: Get all API keys info
    try {
      const allKeys = apiKeyManager.getAllKeys();
      
      // Should have at least the keys we set
      const hasOpenAI = allKeys.some(k => k.name === 'OPENAI_API_KEY');
      const hasWeather = allKeys.some(k => k.name === 'WEATHER_API_KEY');
      const hasWolfram = allKeys.some(k => k.name === 'WOLFRAM_API_KEY');
      
      // Keys should be masked in the output
      const allMasked = allKeys.every(k => k.maskedKey && !k.maskedKey.includes(k.key));

      const success = hasOpenAI && hasWeather && hasWolfram && allMasked;

      results.push({
        name: 'Get All API Keys Info',
        success,
        keyCount: allKeys.length,
        allMasked
      });
    } catch (error) {
      results.push({
        name: 'Get All API Keys Info',
        success: false,
        error: error.message
      });
    }

    // Test 6: Rotate API key
    try {
      const newKey = 'test-openai-key-rotated-9876543210';
      const rotated = await apiKeyManager.rotateKey('OPENAI_API_KEY', newKey);
      
      // Verify the key was rotated
      const currentKey = apiKeyManager.getApiKey('OPENAI_API_KEY');
      const success = rotated && currentKey === newKey;

      results.push({
        name: 'Rotate API Key',
        success,
        rotated,
        keyUpdated: currentKey === newKey
      });
    } catch (error) {
      results.push({
        name: 'Rotate API Key',
        success: false,
        error: error.message
      });
    }

    // Test 7: Handle missing API key
    try {
      const missingKey = apiKeyManager.getApiKey('NON_EXISTENT_KEY');
      const success = missingKey === undefined;

      results.push({
        name: 'Handle Missing API Key',
        success,
        returnedUndefined: missingKey === undefined
      });
    } catch (error) {
      results.push({
        name: 'Handle Missing API Key',
        success: false,
        error: error.message
      });
    }

    // Test 8: Validate API keys
    try {
      // Set an empty key
      process.env.EMPTY_KEY = '';
      
      const validKey = apiKeyManager.validateKey('OPENAI_API_KEY');
      const emptyKey = apiKeyManager.validateKey('EMPTY_KEY');
      const missingKey = apiKeyManager.validateKey('MISSING_KEY');

      const success = validKey === true && emptyKey === false && missingKey === false;

      results.push({
        name: 'Validate API Keys',
        success,
        validKey,
        emptyKey,
        missingKey
      });
    } catch (error) {
      results.push({
        name: 'Validate API Keys',
        success: false,
        error: error.message
      });
    }

    // Test 9: Get usage report
    try {
      const report = apiKeyManager.getUsageReport();
      
      // Report should include our tracked keys
      const hasOpenAI = report.some(r => r.name === 'OPENAI_API_KEY');
      const hasWeather = report.some(r => r.name === 'WEATHER_API_KEY');
      
      // Check usage counts match what we tracked
      const openAIReport = report.find(r => r.name === 'OPENAI_API_KEY');
      const correctCounts = openAIReport && openAIReport.usageCount > 0 && openAIReport.errorCount > 0;

      const success = hasOpenAI && hasWeather && correctCounts;

      results.push({
        name: 'Get Usage Report',
        success,
        reportEntries: report.length
      });
    } catch (error) {
      results.push({
        name: 'Get Usage Report',
        success: false,
        error: error.message
      });
    }

    // Cleanup: Restore original environment
    process.env = originalEnv;

    // Clean up test files
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ error: err }, 'Failed to clean up test directory');
    }

  } catch (error) {
    logger.error({ error }, 'Error in API key manager tests');
    return {
      success: false,
      error: error.message,
      results
    };
  }

  // Calculate overall success
  const success = results.every(r => r.success);

  return {
    success,
    results
  };
}

// Export for test runner
module.exports = { testApiKeyManager };

// Run tests if called directly
if (require.main === module) {
  testApiKeyManager().then(results => {
    console.log('API Key Manager Test Results:', JSON.stringify(results, null, 2));
    process.exit(results.success ? 0 : 1);
  });
}