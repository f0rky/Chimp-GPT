const { performance } = require('perf_hooks');
const PocketFlowConversationManager = require('../../src/conversation/flow/PocketFlowConversationManager');

class PerformanceTestSuite {
  constructor() {
    this.results = {
      throughputTests: [],
      memoryTests: [],
      concurrencyTests: [],
      responseTimeTests: [],
    };
  }

  createMockMessage(content, userId = 'test-user', channelId = 'test-channel') {
    return {
      id: `msg-${Date.now()}-${Math.random()}`,
      content: content,
      createdTimestamp: Date.now(),
      author: {
        id: userId,
        username: 'TestUser',
        displayName: 'Test User',
      },
      channel: {
        id: channelId,
        type: 'GUILD_TEXT',
      },
      guild: {
        id: 'test-guild',
      },
    };
  }

  createMockOpenAIClient() {
    return {
      chat: {
        completions: {
          create: async params => {
            await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

            return {
              choices: [
                {
                  message: {
                    content: `Mock response to: ${params.messages[params.messages.length - 1]?.content || 'unknown'}`,
                  },
                  finish_reason: 'stop',
                },
              ],
            };
          },
        },
      },
    };
  }

  createMockFunctionCallProcessor() {
    return {
      processFunction: async ({ functionName, functionArgs }) => {
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));

        return {
          success: true,
          result: `Mock result for ${functionName} with args: ${JSON.stringify(functionArgs)}`,
        };
      },
    };
  }

  createMockCommandHandler() {
    return {
      executeCommand: async (commandName, context) => {
        await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 50));

        return {
          response: `Mock command response for ${commandName}`,
        };
      },
    };
  }

  async runThroughputTest(messagesPerSecond = 10, durationSeconds = 30) {
    console.log(`\n🚀 Running throughput test: ${messagesPerSecond} msg/s for ${durationSeconds}s`);

    const manager = new PocketFlowConversationManager(
      this.createMockOpenAIClient(),
      this.createMockFunctionCallProcessor(),
      this.createMockCommandHandler(),
      { maxConcurrentFlows: 50 }
    );

    const results = {
      startTime: performance.now(),
      messagesProcessed: 0,
      successfulResponses: 0,
      errors: 0,
      responseTimesMs: [],
    };

    const messageInterval = 1000 / messagesPerSecond;
    const endTime = Date.now() + durationSeconds * 1000;

    const intervalId = setInterval(async () => {
      if (Date.now() > endTime) {
        clearInterval(intervalId);
        return;
      }

      const messageStartTime = performance.now();
      const message = this.createMockMessage(
        `Test message ${results.messagesProcessed}`,
        `user-${results.messagesProcessed % 10}`
      );

      try {
        const result = await manager.processMessage(message);
        const responseTime = performance.now() - messageStartTime;

        results.messagesProcessed++;
        results.responseTimesMs.push(responseTime);

        if (result.success) {
          results.successfulResponses++;
        } else {
          results.errors++;
        }
      } catch (error) {
        results.errors++;
        results.messagesProcessed++;
      }
    }, messageInterval);

    return new Promise(resolve => {
      setTimeout(
        async () => {
          clearInterval(intervalId);

          results.totalTime = performance.now() - results.startTime;
          results.actualThroughput = results.messagesProcessed / (results.totalTime / 1000);
          results.avgResponseTime =
            results.responseTimesMs.reduce((a, b) => a + b, 0) / results.responseTimesMs.length;
          results.maxResponseTime = Math.max(...results.responseTimesMs);
          results.minResponseTime = Math.min(...results.responseTimesMs);
          results.successRate = (results.successfulResponses / results.messagesProcessed) * 100;

          await manager.shutdown();

          this.results.throughputTests.push(results);
          this.printThroughputResults(results);
          resolve(results);
        },
        durationSeconds * 1000 + 1000
      );
    });
  }

  async runMemoryTest(numMessages = 1000) {
    console.log(`\n🧠 Running memory test with ${numMessages} messages`);

    const manager = new PocketFlowConversationManager(
      this.createMockOpenAIClient(),
      this.createMockFunctionCallProcessor(),
      this.createMockCommandHandler()
    );

    const results = {
      initialMemory: process.memoryUsage(),
      memorySnapshots: [],
      messagesProcessed: 0,
    };

    for (let i = 0; i < numMessages; i++) {
      const message = this.createMockMessage(
        `Memory test message ${i}`,
        `user-${i % 20}`,
        `channel-${i % 5}`
      );

      await manager.processMessage(message);
      results.messagesProcessed++;

      if (i % 100 === 0) {
        results.memorySnapshots.push({
          messageCount: i,
          memory: process.memoryUsage(),
        });
      }
    }

    results.finalMemory = process.memoryUsage();
    results.memoryIncrease = {
      heapUsed: results.finalMemory.heapUsed - results.initialMemory.heapUsed,
      heapTotal: results.finalMemory.heapTotal - results.initialMemory.heapTotal,
      external: results.finalMemory.external - results.initialMemory.external,
    };

    await manager.shutdown();

    this.results.memoryTests.push(results);
    this.printMemoryResults(results);
    return results;
  }

  async runConcurrencyTest(concurrentUsers = 20, messagesPerUser = 10) {
    console.log(
      `\n⚡ Running concurrency test: ${concurrentUsers} users, ${messagesPerUser} messages each`
    );

    const manager = new PocketFlowConversationManager(
      this.createMockOpenAIClient(),
      this.createMockFunctionCallProcessor(),
      this.createMockCommandHandler(),
      { maxConcurrentFlows: concurrentUsers * 2 }
    );

    const results = {
      startTime: performance.now(),
      concurrentUsers,
      messagesPerUser,
      totalMessages: concurrentUsers * messagesPerUser,
      completedMessages: 0,
      errors: 0,
      responseTimesMs: [],
    };

    const userPromises = [];

    for (let userId = 0; userId < concurrentUsers; userId++) {
      const userPromise = async () => {
        for (let msgIndex = 0; msgIndex < messagesPerUser; msgIndex++) {
          const messageStartTime = performance.now();
          const message = this.createMockMessage(
            `Concurrent test message ${msgIndex} from user ${userId}`,
            `user-${userId}`,
            `channel-${userId % 3}`
          );

          try {
            await manager.processMessage(message);
            const responseTime = performance.now() - messageStartTime;
            results.responseTimesMs.push(responseTime);
            results.completedMessages++;
          } catch (error) {
            results.errors++;
          }
        }
      };

      userPromises.push(userPromise());
    }

    await Promise.all(userPromises);

    results.totalTime = performance.now() - results.startTime;
    results.avgResponseTime =
      results.responseTimesMs.reduce((a, b) => a + b, 0) / results.responseTimesMs.length;
    results.throughput = results.completedMessages / (results.totalTime / 1000);
    results.successRate = (results.completedMessages / results.totalMessages) * 100;

    await manager.shutdown();

    this.results.concurrencyTests.push(results);
    this.printConcurrencyResults(results);
    return results;
  }

  async runResponseTimeTest(messageTypes = ['simple', 'complex', 'command', 'function_call']) {
    console.log(`\n⏱️  Running response time test for different message types`);

    const manager = new PocketFlowConversationManager(
      this.createMockOpenAIClient(),
      this.createMockFunctionCallProcessor(),
      this.createMockCommandHandler()
    );

    const testMessages = {
      simple: 'Hello bot!',
      complex:
        'Can you help me understand the weather patterns for the next week and explain how they might affect outdoor activities? I need detailed information for planning.',
      command: '!help',
      function_call: 'What is the weather like in New York today?',
    };

    const results = {};
    const samplesPerType = 20;

    for (const messageType of messageTypes) {
      results[messageType] = {
        responseTimes: [],
        successCount: 0,
        errorCount: 0,
      };

      for (let i = 0; i < samplesPerType; i++) {
        const startTime = performance.now();
        const message = this.createMockMessage(
          testMessages[messageType],
          `user-${i}`,
          'test-channel'
        );

        try {
          const result = await manager.processMessage(message);
          const responseTime = performance.now() - startTime;

          results[messageType].responseTimes.push(responseTime);

          if (result.success) {
            results[messageType].successCount++;
          } else {
            results[messageType].errorCount++;
          }
        } catch (error) {
          results[messageType].errorCount++;
        }
      }

      const times = results[messageType].responseTimes;
      results[messageType].avgResponseTime = times.reduce((a, b) => a + b, 0) / times.length;
      results[messageType].minResponseTime = Math.min(...times);
      results[messageType].maxResponseTime = Math.max(...times);
      results[messageType].medianResponseTime = times.sort((a, b) => a - b)[
        Math.floor(times.length / 2)
      ];
    }

    await manager.shutdown();

    this.results.responseTimeTests.push(results);
    this.printResponseTimeResults(results);
    return results;
  }

  printThroughputResults(results) {
    console.log(`✅ Throughput Test Results:`);
    console.log(`   Messages processed: ${results.messagesProcessed}`);
    console.log(`   Actual throughput: ${results.actualThroughput.toFixed(2)} msg/s`);
    console.log(`   Success rate: ${results.successRate.toFixed(1)}%`);
    console.log(`   Avg response time: ${results.avgResponseTime.toFixed(2)}ms`);
    console.log(
      `   Response time range: ${results.minResponseTime.toFixed(2)}ms - ${results.maxResponseTime.toFixed(2)}ms`
    );
  }

  printMemoryResults(results) {
    console.log(`✅ Memory Test Results:`);
    console.log(`   Messages processed: ${results.messagesProcessed}`);
    console.log(
      `   Heap increase: ${(results.memoryIncrease.heapUsed / 1024 / 1024).toFixed(2)}MB`
    );
    console.log(`   Total heap: ${(results.finalMemory.heapTotal / 1024 / 1024).toFixed(2)}MB`);
    console.log(
      `   Memory per message: ${(results.memoryIncrease.heapUsed / results.messagesProcessed / 1024).toFixed(2)}KB`
    );
  }

  printConcurrencyResults(results) {
    console.log(`✅ Concurrency Test Results:`);
    console.log(`   Total messages: ${results.totalMessages}`);
    console.log(`   Completed: ${results.completedMessages}`);
    console.log(`   Success rate: ${results.successRate.toFixed(1)}%`);
    console.log(`   Throughput: ${results.throughput.toFixed(2)} msg/s`);
    console.log(`   Avg response time: ${results.avgResponseTime.toFixed(2)}ms`);
  }

  printResponseTimeResults(results) {
    console.log(`✅ Response Time Test Results:`);
    for (const [messageType, data] of Object.entries(results)) {
      console.log(`   ${messageType}:`);
      console.log(`     Avg: ${data.avgResponseTime.toFixed(2)}ms`);
      console.log(`     Median: ${data.medianResponseTime.toFixed(2)}ms`);
      console.log(
        `     Range: ${data.minResponseTime.toFixed(2)}ms - ${data.maxResponseTime.toFixed(2)}ms`
      );
      console.log(
        `     Success rate: ${((data.successCount / (data.successCount + data.errorCount)) * 100).toFixed(1)}%`
      );
    }
  }

  async runFullTestSuite() {
    console.log('🧪 Starting PocketFlow Performance Test Suite');
    console.log('================================================');

    const startTime = performance.now();

    await this.runThroughputTest(5, 10);
    await this.runMemoryTest(500);
    await this.runConcurrencyTest(10, 5);
    await this.runResponseTimeTest();

    const totalTime = performance.now() - startTime;

    console.log('\n📊 Test Suite Summary');
    console.log('=====================');
    console.log(`Total test time: ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`Throughput tests: ${this.results.throughputTests.length}`);
    console.log(`Memory tests: ${this.results.memoryTests.length}`);
    console.log(`Concurrency tests: ${this.results.concurrencyTests.length}`);
    console.log(`Response time tests: ${this.results.responseTimeTests.length}`);

    return this.results;
  }
}

if (require.main === module) {
  const testSuite = new PerformanceTestSuite();
  testSuite
    .runFullTestSuite()
    .then(results => {
      console.log('\n✨ All tests completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = PerformanceTestSuite;
