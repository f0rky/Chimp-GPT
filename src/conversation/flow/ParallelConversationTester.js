const { createLogger } = require('../../core/logger');
const PocketFlowConversationManager = require('./PocketFlowConversationManager');

const logger = createLogger('ParallelConversationTester');

class ParallelConversationTester {
  constructor(
    legacyConversationManager,
    openaiClient,
    functionCallProcessor,
    commandHandler,
    options = {}
  ) {
    this.legacyManager = legacyConversationManager;
    this.pocketFlowManager = new PocketFlowConversationManager(
      openaiClient,
      functionCallProcessor,
      commandHandler,
      options.pocketFlow
    );

    this.options = {
      enableTesting: process.env.ENABLE_PARALLEL_TESTING === 'true',
      testPercentage: parseFloat(process.env.PARALLEL_TEST_PERCENTAGE) || 10,
      logComparisons: process.env.LOG_PARALLEL_COMPARISONS === 'true',
      testOnlyForUsers: process.env.PARALLEL_TEST_USERS
        ? process.env.PARALLEL_TEST_USERS.split(',')
        : [],
      ...options,
    };

    this.testResults = {
      totalTests: 0,
      successfulTests: 0,
      errors: 0,
      performanceComparisons: [],
      responseComparisons: [],
    };

    logger.info('ParallelConversationTester initialized', {
      enableTesting: this.options.enableTesting,
      testPercentage: this.options.testPercentage,
    });
  }

  async processMessage(message, context = {}) {
    const shouldRunParallelTest = this.shouldRunTest(message);

    if (shouldRunParallelTest && this.options.enableTesting) {
      return await this.runParallelTest(message, context);
    }
    return await this.legacyManager.processMessage(message, context);
  }

  shouldRunTest(message) {
    if (!this.options.enableTesting) {
      return false;
    }

    if (this.options.testOnlyForUsers.length > 0) {
      const userId = message.author?.id;
      if (!userId || !this.options.testOnlyForUsers.includes(userId)) {
        return false;
      }
    }

    const randomValue = Math.random() * 100;
    return randomValue < this.options.testPercentage;
  }

  async runParallelTest(message, context) {
    const testStartTime = Date.now();
    const messageId = message.id;
    const userId = message.author?.id;

    logger.debug('Running parallel test', { messageId, userId });

    try {
      const legacyPromise = this.runLegacyProcessing(message, context);
      const pocketFlowPromise = this.runPocketFlowProcessing(message, context);

      const [legacyResult, pocketFlowResult] = await Promise.allSettled([
        legacyPromise,
        pocketFlowPromise,
      ]);

      const testResult = this.compareResults(
        legacyResult,
        pocketFlowResult,
        testStartTime,
        messageId
      );

      this.recordTestResult(testResult);

      if (this.options.logComparisons) {
        this.logComparison(testResult);
      }

      if (legacyResult.status === 'fulfilled') {
        return legacyResult.value;
      } else if (pocketFlowResult.status === 'fulfilled') {
        logger.warn('Legacy failed but PocketFlow succeeded, using PocketFlow result', {
          messageId,
          legacyError: legacyResult.reason?.message,
        });
        return pocketFlowResult.value;
      }
      throw new Error('Both systems failed');
    } catch (error) {
      this.testResults.errors++;
      logger.error('Parallel test failed', {
        messageId,
        error: error.message,
      });

      return await this.legacyManager.processMessage(message, context);
    }
  }

  async runLegacyProcessing(message, context) {
    const startTime = Date.now();

    try {
      const result = await this.legacyManager.processMessage(message, context);

      return {
        ...result,
        system: 'legacy',
        executionTime: Date.now() - startTime,
        success: true,
      };
    } catch (error) {
      return {
        system: 'legacy',
        executionTime: Date.now() - startTime,
        success: false,
        error: error.message,
      };
    }
  }

  async runPocketFlowProcessing(message, context) {
    const startTime = Date.now();

    try {
      const result = await this.pocketFlowManager.processMessage(message, context);

      return {
        ...result,
        system: 'pocketflow',
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        system: 'pocketflow',
        executionTime: Date.now() - startTime,
        success: false,
        error: error.message,
      };
    }
  }

  compareResults(legacyResult, pocketFlowResult, testStartTime, messageId) {
    const comparison = {
      messageId,
      timestamp: testStartTime,
      totalTestTime: Date.now() - testStartTime,
      legacy:
        legacyResult.status === 'fulfilled'
          ? legacyResult.value
          : {
              success: false,
              error: legacyResult.reason?.message || 'Unknown error',
            },
      pocketflow:
        pocketFlowResult.status === 'fulfilled'
          ? pocketFlowResult.value
          : {
              success: false,
              error: pocketFlowResult.reason?.message || 'Unknown error',
            },
    };

    comparison.performance = {
      legacyTime: comparison.legacy.executionTime || 0,
      pocketflowTime: comparison.pocketflow.executionTime || 0,
      timeDifference:
        (comparison.pocketflow.executionTime || 0) - (comparison.legacy.executionTime || 0),
      pocketflowFaster:
        (comparison.pocketflow.executionTime || Infinity) <
        (comparison.legacy.executionTime || Infinity),
    };

    comparison.functionality = {
      bothSucceeded: comparison.legacy.success && comparison.pocketflow.success,
      bothFailed: !comparison.legacy.success && !comparison.pocketflow.success,
      onlyLegacySucceeded: comparison.legacy.success && !comparison.pocketflow.success,
      onlyPocketflowSucceeded: !comparison.legacy.success && comparison.pocketflow.success,
      responsesMatch: this.compareResponses(
        comparison.legacy.response,
        comparison.pocketflow.response
      ),
    };

    return comparison;
  }

  compareResponses(legacyResponse, pocketflowResponse) {
    if (!legacyResponse || !pocketflowResponse) {
      return false;
    }

    if (typeof legacyResponse !== 'string' || typeof pocketflowResponse !== 'string') {
      return false;
    }

    const normalizedLegacy = legacyResponse.toLowerCase().trim();
    const normalizedPocketflow = pocketflowResponse.toLowerCase().trim();

    if (normalizedLegacy === normalizedPocketflow) {
      return true;
    }

    const similarity = this.calculateStringSimilarity(normalizedLegacy, normalizedPocketflow);
    return similarity > 0.8;
  }

  calculateStringSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1.0;
    }

    const editDistance = this.calculateLevenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  calculateLevenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  recordTestResult(testResult) {
    this.testResults.totalTests++;

    if (testResult.functionality.bothSucceeded) {
      this.testResults.successfulTests++;
    }

    this.testResults.performanceComparisons.push({
      messageId: testResult.messageId,
      legacyTime: testResult.performance.legacyTime,
      pocketflowTime: testResult.performance.pocketflowTime,
      pocketflowFaster: testResult.performance.pocketflowFaster,
      timestamp: testResult.timestamp,
    });

    if (this.testResults.performanceComparisons.length > 100) {
      this.testResults.performanceComparisons.shift();
    }

    this.testResults.responseComparisons.push({
      messageId: testResult.messageId,
      responsesMatch: testResult.functionality.responsesMatch,
      bothSucceeded: testResult.functionality.bothSucceeded,
      timestamp: testResult.timestamp,
    });

    if (this.testResults.responseComparisons.length > 50) {
      this.testResults.responseComparisons.shift();
    }
  }

  logComparison(testResult) {
    logger.info('Parallel test comparison', {
      messageId: testResult.messageId,
      performance: testResult.performance,
      functionality: testResult.functionality,
      legacyResponse: testResult.legacy.response?.substring(0, 100),
      pocketflowResponse: testResult.pocketflow.response?.substring(0, 100),
    });
  }

  getTestStats() {
    const performanceStats = this.calculatePerformanceStats();
    const functionalityStats = this.calculateFunctionalityStats();

    return {
      overview: {
        totalTests: this.testResults.totalTests,
        successfulTests: this.testResults.successfulTests,
        errors: this.testResults.errors,
        successRate:
          this.testResults.totalTests > 0
            ? (this.testResults.successfulTests / this.testResults.totalTests) * 100
            : 0,
        testingEnabled: this.options.enableTesting,
        testPercentage: this.options.testPercentage,
      },
      performance: performanceStats,
      functionality: functionalityStats,
    };
  }

  calculatePerformanceStats() {
    const comparisons = this.testResults.performanceComparisons;

    if (comparisons.length === 0) {
      return {
        avgLegacyTime: 0,
        avgPocketflowTime: 0,
        pocketflowFasterPercentage: 0,
        avgTimeDifference: 0,
      };
    }

    const totalLegacyTime = comparisons.reduce((sum, comp) => sum + comp.legacyTime, 0);
    const totalPocketflowTime = comparisons.reduce((sum, comp) => sum + comp.pocketflowTime, 0);
    const pocketflowFasterCount = comparisons.filter(comp => comp.pocketflowFaster).length;

    return {
      avgLegacyTime: totalLegacyTime / comparisons.length,
      avgPocketflowTime: totalPocketflowTime / comparisons.length,
      pocketflowFasterPercentage: (pocketflowFasterCount / comparisons.length) * 100,
      avgTimeDifference: (totalPocketflowTime - totalLegacyTime) / comparisons.length,
    };
  }

  calculateFunctionalityStats() {
    const comparisons = this.testResults.responseComparisons;

    if (comparisons.length === 0) {
      return {
        responseMatchPercentage: 0,
        bothSucceededPercentage: 0,
      };
    }

    const responseMatches = comparisons.filter(comp => comp.responsesMatch).length;
    const bothSucceeded = comparisons.filter(comp => comp.bothSucceeded).length;

    return {
      responseMatchPercentage: (responseMatches / comparisons.length) * 100,
      bothSucceededPercentage: (bothSucceeded / comparisons.length) * 100,
    };
  }

  async getPocketFlowStats() {
    return this.pocketFlowManager.getStats();
  }

  async cleanup() {
    await this.pocketFlowManager.cleanup();
  }

  async shutdown() {
    await this.pocketFlowManager.shutdown();
  }
}

module.exports = ParallelConversationTester;
