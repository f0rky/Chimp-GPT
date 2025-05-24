/**
 * Test Data Generator
 *
 * This script generates random test data for the status page
 * to demonstrate how it looks with real data.
 */

// Add this script to your index.html after app.js:
// <script src="testData.js"></script>

// Function to generate random data for testing
function generateTestData() {
  // Simulate API calls
  const apiCalls = {
    openai: Math.floor(Math.random() * 100) + 50,
    weather: Math.floor(Math.random() * 30) + 10,
    time: Math.floor(Math.random() * 20) + 5,
    wolfram: Math.floor(Math.random() * 15) + 3,
    quake: Math.floor(Math.random() * 25) + 15,
  };

  // Simulate errors
  const errors = {
    openai: Math.floor(Math.random() * 5),
    discord: Math.floor(Math.random() * 3),
    weather: Math.floor(Math.random() * 2),
    time: Math.floor(Math.random() * 1),
    wolfram: Math.floor(Math.random() * 2),
    quake: Math.floor(Math.random() * 3),
    other: Math.floor(Math.random() * 4),
  };

  // Simulate memory usage
  const memory = {
    rss: `${Math.floor(Math.random() * 200) + 100} MB`,
    heapTotal: `${Math.floor(Math.random() * 100) + 50} MB`,
    heapUsed: `${Math.floor(Math.random() * 80) + 40} MB`,
  };

  // Simulate system info
  const system = {
    freeMemory: `${Math.floor(Math.random() * 4000) + 2000} MB`,
    totalMemory: `8192 MB`,
    loadAvg: [Math.random() * 2, Math.random() * 1.5, Math.random() * 1],
  };

  // Simulate rate limits
  const rateLimits = {
    count: Math.floor(Math.random() * 20) + 5,
    uniqueUsers: Math.floor(Math.random() * 10) + 2,
  };

  // Simulate Discord stats
  const discord = {
    ping: Math.floor(Math.random() * 100) + 20,
    status: 'online',
    guilds: Math.floor(Math.random() * 5) + 1,
    channels: Math.floor(Math.random() * 20) + 5,
  };

  return {
    status: Math.random() > 0.9 ? 'warning' : 'ok',
    uptime: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 86400),
    version: '1.0.1',
    memory,
    system,
    stats: {
      messageCount: Math.floor(Math.random() * 500) + 100,
      apiCalls,
      errors,
      rateLimits,
    },
    discord,
  };
}

/* global */
// Override the fetch function to return test data
const originalFetch = window.fetch;
window.fetch = function (url, options) {
  if (url === '/health') {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          json: () => Promise.resolve(generateTestData()),
        });
      }, 200);
    });
  }

  if (url === '/run-tests') {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          json: () =>
            Promise.resolve({
              conversationLog: {
                success: Math.random() > 0.2,
                details: {
                  initialization: true,
                  addUserMessage: true,
                  addAssistantMessage: true,
                  lengthManagement: Math.random() > 0.2,
                  systemMessagePreservation: true,
                  messageRemovalOrder: Math.random() > 0.2,
                },
              },
              openaiIntegration: {
                success: Math.random() > 0.3,
                details: {
                  responseReceived: true,
                  validResponse: Math.random() > 0.3,
                  model: 'gpt-3.5-turbo',
                },
              },
              quakeServerStats: {
                success: Math.random() > 0.2,
                details: {
                  summaryGenerated: Math.random() > 0.2,
                },
              },
            }),
        });
      }, 1500);
    });
  }

  return originalFetch(url, options);
};

console.log('Test data generator loaded. The status page will display random test data.');
