/**
 * Comprehensive Test Runner
 *
 * Runs all test suites and generates coverage reports.
 * Integrates existing tests with new comprehensive test coverage.
 */

const { createLogger } = require('../src/core/logger');
const logger = createLogger('comprehensiveTestRunner');
const path = require('path');
const fs = require('fs').promises;

// Import test modules
const { testSimpleChimpGPTFlow } = require('./unit/simpleChimpGPTFlowTest');
const { testImageGeneration } = require('./unit/imageGenerationTest');
const { testCommandProcessing } = require('./unit/commandProcessingTest');
const { testMessageHandlingIntegration } = require('./integration/messageHandlingIntegrationTest');
const { testWeatherAPIIntegration } = require('./integration/weatherApiIntegrationTest');

// Import existing test runner functions
const existingTestRunner = require('./unit/testRunner');

/**
 * Test coverage tracker - simple implementation
 */
class CoverageTracker {
  constructor() {
    this.coveredFiles = new Set();
    this.totalFiles = 0;
    this.testResults = [];
  }

  /**
   * Add a covered file to tracking
   */
  addCoveredFile(filePath) {
    this.coveredFiles.add(filePath);
  }

  /**
   * Scan project for testable files
   */
  async scanProject() {
    const srcDir = path.join(__dirname, '../src');
    const files = await this.getAllJSFiles(srcDir);
    this.totalFiles = files.length;

    logger.info(`Found ${this.totalFiles} JavaScript files in src/`);
    return files;
  }

  /**
   * Recursively get all JS files
   */
  async getAllJSFiles(dir) {
    const files = [];

    try {
      const items = await fs.readdir(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
          // Skip node_modules and test directories
          if (!['node_modules', 'tests', '.git'].includes(item)) {
            const subFiles = await this.getAllJSFiles(fullPath);
            files.push(...subFiles);
          }
        } else if (item.endsWith('.js') && !item.endsWith('.test.js')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      logger.warn(`Cannot read directory ${dir}:`, error.message);
    }

    return files;
  }

  /**
   * Generate coverage report
   */
  generateCoverageReport() {
    const coveragePercentage =
      this.totalFiles > 0 ? (this.coveredFiles.size / this.totalFiles) * 100 : 0;

    return {
      totalFiles: this.totalFiles,
      coveredFiles: this.coveredFiles.size,
      uncoveredFiles: this.totalFiles - this.coveredFiles.size,
      coveragePercentage: coveragePercentage.toFixed(1),
      coveredFilesList: Array.from(this.coveredFiles),
      summary: `${this.coveredFiles.size}/${this.totalFiles} files (${coveragePercentage.toFixed(1)}%)`,
    };
  }
}

/**
 * Test suite definitions
 */
const testSuites = {
  // New comprehensive tests
  SimpleChimpGPTFlow: {
    category: 'Unit',
    priority: 'High',
    fn: testSimpleChimpGPTFlow,
    covers: ['src/conversation/flow/SimpleChimpGPTFlow.js', 'src/conversation/flow/PocketFlow.js'],
  },

  'Image Generation': {
    category: 'Unit',
    priority: 'High',
    fn: testImageGeneration,
    covers: ['src/handlers/imageGenerationHandler.js', 'src/services/imageGeneration.js'],
  },

  'Command Processing': {
    category: 'Unit',
    priority: 'Medium',
    fn: testCommandProcessing,
    covers: ['src/commands/commandHandler.js', 'src/commands/modules/'],
  },

  'Message Handling Integration': {
    category: 'Integration',
    priority: 'High',
    fn: testMessageHandlingIntegration,
    covers: [
      'src/core/eventHandlers/messageEventHandler.js',
      'src/core/processors/messageProcessor.js',
      'src/handlers/responseFormatter.js',
    ],
  },

  'Weather API Integration': {
    category: 'Integration',
    priority: 'Medium',
    fn: testWeatherAPIIntegration,
    covers: ['src/services/weatherLookup.js', 'src/services/simplified-weather.js'],
  },

  // Existing tests
  'Error Classes': {
    category: 'Unit',
    priority: 'Low',
    fn: existingTestRunner.runErrorClassesTests,
    covers: ['src/core/errors.js'],
  },

  'Command Handler': {
    category: 'Unit',
    priority: 'Medium',
    fn: existingTestRunner.runCommandHandlerTests,
    covers: ['src/commands/commandHandler.js'],
  },

  'Input Sanitizer': {
    category: 'Unit',
    priority: 'High',
    fn: existingTestRunner.runInputSanitizerTests,
    covers: ['src/utils/inputSanitizer.js'],
  },

  'API Key Manager': {
    category: 'Unit',
    priority: 'Medium',
    fn: existingTestRunner.runApiKeyManagerTests,
    covers: ['src/utils/apiKeyManager.js'],
  },

  'Human Circuit Breaker': {
    category: 'Unit',
    priority: 'Medium',
    fn: existingTestRunner.runHumanCircuitBreakerTests,
    covers: ['src/utils/humanCircuitBreaker.js'],
  },

  'Circuit Breaker': {
    category: 'Unit',
    priority: 'Medium',
    fn: existingTestRunner.runCircuitBreakerTests,
    covers: ['src/middleware/circuitBreaker.js'],
  },

  'Weather API': {
    category: 'Unit',
    priority: 'Medium',
    fn: existingTestRunner.runWeatherApiTests,
    covers: ['src/services/weatherLookup.js'],
  },
};

/**
 * Run all test suites
 */
async function runAllTests(options = {}) {
  const { filter = null, priority = null, category = null, generateCoverage = true } = options;

  logger.info('🧪 Starting Comprehensive Test Suite');
  logger.info('=====================================');

  const coverage = new CoverageTracker();
  if (generateCoverage) {
    await coverage.scanProject();
  }

  const results = {
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      startTime: Date.now(),
      endTime: null,
      duration: null,
    },
    suites: {},
    coverage: null,
    priorities: {
      high: { total: 0, passed: 0 },
      medium: { total: 0, passed: 0 },
      low: { total: 0, passed: 0 },
    },
    categories: {
      unit: { total: 0, passed: 0 },
      integration: { total: 0, passed: 0 },
    },
  };

  // Filter test suites
  const suitesToRun = Object.entries(testSuites).filter(([name, suite]) => {
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return false;
    if (priority && suite.priority.toLowerCase() !== priority.toLowerCase()) return false;
    if (category && suite.category.toLowerCase() !== category.toLowerCase()) return false;
    return true;
  });

  logger.info(`Running ${suitesToRun.length} test suites...`);

  // Run each test suite
  for (const [name, suite] of suitesToRun) {
    const startTime = Date.now();
    logger.info(`\n🔍 Running ${name} (${suite.category} - ${suite.priority} Priority)`);

    try {
      const result = await suite.fn();
      const duration = Date.now() - startTime;

      // Track coverage
      if (generateCoverage && suite.covers) {
        for (const file of suite.covers) {
          if (typeof file === 'string') {
            coverage.addCoveredFile(file);
          }
        }
      }

      // Update results
      results.summary.total++;
      results.suites[name] = {
        success: result.success,
        duration,
        details: result.details,
        error: result.error,
        category: suite.category,
        priority: suite.priority,
      };

      // Update priority tracking
      const priorityKey = suite.priority.toLowerCase();
      results.priorities[priorityKey].total++;

      // Update category tracking
      const categoryKey = suite.category.toLowerCase();
      results.categories[categoryKey].total++;

      if (result.success) {
        results.summary.passed++;
        results.priorities[priorityKey].passed++;
        results.categories[categoryKey].passed++;
        logger.info(`✅ ${name}: PASSED (${duration}ms)`);
      } else {
        results.summary.failed++;
        logger.warn(`❌ ${name}: FAILED (${duration}ms) - ${result.error || 'See details'}`);
      }

      // Show test details if available
      if (result.details) {
        if (result.details.passed !== undefined && result.details.total !== undefined) {
          logger.info(`   📊 Sub-tests: ${result.details.passed}/${result.details.total} passed`);
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      results.summary.total++;
      results.summary.failed++;
      results.suites[name] = {
        success: false,
        duration,
        error: error.message,
        category: suite.category,
        priority: suite.priority,
      };
      logger.error(`💥 ${name}: ERROR (${duration}ms) - ${error.message}`);
    }
  }

  // Finalize results
  results.summary.endTime = Date.now();
  results.summary.duration = results.summary.endTime - results.summary.startTime;

  if (generateCoverage) {
    results.coverage = coverage.generateCoverageReport();
  }

  return results;
}

/**
 * Display comprehensive test results
 */
function displayResults(results) {
  const { summary, coverage, priorities, categories } = results;

  logger.info('\n🎯 COMPREHENSIVE TEST RESULTS');
  logger.info('=====================================');

  // Overall summary
  const successRate = summary.total > 0 ? ((summary.passed / summary.total) * 100).toFixed(1) : 0;
  logger.info(`📈 Overall: ${summary.passed}/${summary.total} passed (${successRate}%)`);
  logger.info(`⏱️  Duration: ${(summary.duration / 1000).toFixed(2)}s`);

  // Priority breakdown
  logger.info('\n🎯 By Priority:');
  for (const [priority, stats] of Object.entries(priorities)) {
    if (stats.total > 0) {
      const rate = ((stats.passed / stats.total) * 100).toFixed(1);
      logger.info(`   ${priority.toUpperCase()}: ${stats.passed}/${stats.total} (${rate}%)`);
    }
  }

  // Category breakdown
  logger.info('\n📂 By Category:');
  for (const [category, stats] of Object.entries(categories)) {
    if (stats.total > 0) {
      const rate = ((stats.passed / stats.total) * 100).toFixed(1);
      logger.info(`   ${category.toUpperCase()}: ${stats.passed}/${stats.total} (${rate}%)`);
    }
  }

  // Coverage report
  if (coverage) {
    logger.info('\n📊 Test Coverage:');
    logger.info(`   Files: ${coverage.summary}`);
    logger.info(`   Coverage: ${coverage.coveragePercentage}%`);

    if (parseFloat(coverage.coveragePercentage) < 70) {
      logger.warn('   ⚠️ Coverage below 70% target');
    } else {
      logger.info('   ✅ Coverage meets 70% target');
    }
  }

  // Failed tests
  if (summary.failed > 0) {
    logger.info('\n❌ Failed Tests:');
    for (const [name, result] of Object.entries(results.suites)) {
      if (!result.success) {
        logger.info(`   • ${name}: ${result.error || 'Unknown error'}`);
      }
    }
  }

  // Performance insights
  logger.info('\n⚡ Performance Insights:');
  const suitesByDuration = Object.entries(results.suites)
    .sort(([, a], [, b]) => b.duration - a.duration)
    .slice(0, 3);

  for (const [name, result] of suitesByDuration) {
    logger.info(`   • ${name}: ${result.duration}ms`);
  }
}

/**
 * Save results to file
 */
async function saveResults(results, filename = 'test-results.json') {
  try {
    const resultsPath = path.join(__dirname, filename);
    await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));
    logger.info(`\n💾 Results saved to: ${resultsPath}`);
  } catch (error) {
    logger.error('Failed to save results:', error.message);
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const options = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--filter' && i + 1 < args.length) {
        options.filter = args[i + 1];
        i++;
      } else if (arg === '--priority' && i + 1 < args.length) {
        options.priority = args[i + 1];
        i++;
      } else if (arg === '--category' && i + 1 < args.length) {
        options.category = args[i + 1];
        i++;
      } else if (arg === '--no-coverage') {
        options.generateCoverage = false;
      } else if (arg === '--save') {
        options.saveResults = true;
      }
    }

    // Run tests
    const results = await runAllTests(options);

    // Display results
    displayResults(results);

    // Save results if requested
    if (options.saveResults) {
      await saveResults(results);
    }

    // Exit with appropriate code
    const exitCode = results.summary.failed === 0 ? 0 : 1;
    logger.info(
      `\n${exitCode === 0 ? '✅' : '❌'} Test suite ${exitCode === 0 ? 'PASSED' : 'FAILED'}`
    );
    process.exit(exitCode);
  } catch (error) {
    logger.error('Test runner error:', error);
    process.exit(1);
  }
}

// Export for programmatic usage
module.exports = {
  runAllTests,
  displayResults,
  saveResults,
  testSuites,
};

// Allow running directly
if (require.main === module) {
  main();
}
