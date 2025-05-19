// Dashboard Configuration
const CONFIG = {
  updateInterval: 2000, // Update every 2 seconds
  maxDataPoints: 60, // 2 minutes of data at 2s intervals
  mockData: {
    endpoints: ['openai', 'weather', 'image'],
    functions: [
      { name: 'generateImage', avgTime: 420, trend: 'up' },
      { name: 'chatComplete', avgTime: 210, trend: 'down' },
      { name: 'getWeather', avgTime: 156, trend: 'up' },
      { name: 'getQuakeStats', avgTime: 45, trend: 'down' },
    ],
  },
  colors: {
    openai: 'rgba(0, 255, 0, 0.8)',
    weather: 'rgba(0, 200, 255, 0.8)',
    image: 'rgba(255, 100, 0, 0.8)',
  },
  memory: {
    total: 1024, // MB
    max: 2048, // MB
  },
};

// State
let state = {
  latencyData: {},
  activeRequests: [],
  lastUpdate: Date.now(),
  chart: null,
};

// DOM Elements
const elements = {
  costTracker: document.getElementById('costTracker'),
  currentTime: document.getElementById('currentTime'),
  openaiStatus: document.getElementById('openaiStatus'),
  weatherStatus: document.getElementById('weatherStatus'),
  quakeStatus: document.getElementById('quakeStatus'),
  requestProgress: document.getElementById('requestProgress'),
  currentEndpoint: document.getElementById('currentEndpoint'),
  requestTime: document.getElementById('requestTime'),
  memoryGauge: document.getElementById('memoryGauge'),
  memoryText: document.getElementById('memoryText'),
  openaiLatency: document.getElementById('openaiLatency'),
  weatherLatency: document.getElementById('weatherLatency'),
  imageLatency: document.getElementById('imageLatency'),
  slowFunctions: document.getElementById('slowFunctions'),
};

// Initialize the dashboard
function initDashboard() {
  // Initialize latency data
  CONFIG.mockData.endpoints.forEach(endpoint => {
    state.latencyData[endpoint] = Array(CONFIG.maxDataPoints).fill(null);
  });

  // Initialize chart
  initChart();

  // Start updates
  updateTime();
  updateMockData();

  // Set up periodic updates
  setInterval(updateTime, 1000);
  setInterval(updateMockData, CONFIG.updateInterval);

  // Simulate API requests
  simulateApiRequests();
}

// Initialize the chart
function initChart() {
  const ctx = document.getElementById('latencyChart').getContext('2d');

  // Create gradient for each dataset
  const gradients = {};
  CONFIG.mockData.endpoints.forEach(endpoint => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, CONFIG.colors[endpoint].replace('0.8', '0.5'));
    gradient.addColorStop(1, CONFIG.colors[endpoint].replace('0.8', '0.1'));
    gradients[endpoint] = gradient;
  });

  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(CONFIG.maxDataPoints).fill(''),
      datasets: CONFIG.mockData.endpoints.map(endpoint => ({
        label: endpoint,
        data: state.latencyData[endpoint],
        borderColor: CONFIG.colors[endpoint],
        backgroundColor: gradients[endpoint],
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.4,
        fill: true,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 0,
      },
      scales: {
        x: {
          display: false,
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 255, 0, 0.1)',
          },
          ticks: {
            color: 'rgba(0, 255, 0, 0.7)',
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          titleColor: '#00ff00',
          bodyColor: '#00ff00',
          borderColor: '#00ff00',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function (context) {
              return ` ${context.dataset.label}: ${context.raw || 0}ms`;
            },
          },
        },
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false,
      },
    },
  });
}

// Update the current time
function updateTime() {
  const now = new Date();
  elements.currentTime.textContent = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Update mock data
function updateMockData() {
  const now = Date.now();
  const timeSinceLastUpdate = (now - state.lastUpdate) / 1000; // in seconds
  state.lastUpdate = now;

  // Update latency data
  CONFIG.mockData.endpoints.forEach(endpoint => {
    // Shift data left
    state.latencyData[endpoint].shift();

    // Add new data point
    const baseValue = endpoint === 'openai' ? 100 : endpoint === 'weather' ? 50 : 200;

    const noise = (Math.random() - 0.5) * 40;
    const spike = Math.random() > 0.95 ? Math.random() * 500 : 0;

    const newValue = Math.max(10, baseValue + noise + spike);
    state.latencyData[endpoint].push(newValue);

    // Update latency display
    if (elements[`${endpoint}Latency`]) {
      elements[`${endpoint}Latency`].textContent = `${Math.round(newValue)}ms`;
    }
  });

  // Update chart
  if (state.chart) {
    state.chart.update('none');
  }

  // Update memory usage
  updateMemoryUsage();

  // Update cost tracker
  updateCostTracker();

  // Update function performance
  updateFunctionPerformance();
}

// Update memory usage display
function updateMemoryUsage() {
  // Simulate memory usage between 30% and 70% of max
  const usedMB = Math.floor(CONFIG.memory.max * (0.3 + Math.random() * 0.4));
  const percentage = (usedMB / CONFIG.memory.max) * 100;

  elements.memoryGauge.style.width = `${percentage}%`;
  elements.memoryText.textContent = `${usedMB}MB / ${CONFIG.memory.max}MB`;

  // Update color based on usage
  if (percentage > 80) {
    elements.memoryGauge.style.background = 'linear-gradient(90deg, #ff4444, #ff00ff)';
  } else if (percentage > 60) {
    elements.memoryGauge.style.background = 'linear-gradient(90deg, #ffaa00, #ff00ff)';
  } else {
    elements.memoryGauge.style.background =
      'linear-gradient(90deg, var(--accent-1), var(--accent-2))';
  }
}

// Update cost tracker
function updateCostTracker() {
  // Simulate cost changes
  const baseCost = 1.23;
  const dailyVariation = Math.sin(Date.now() / 86400000) * 0.2;
  const hourlyVariation = Math.sin(Date.now() / 3600000) * 0.05;
  const minuteFluctuation = (Math.random() - 0.5) * 0.01;

  const currentCost = baseCost + dailyVariation + hourlyVariation + minuteFluctuation;
  const todayCost = currentCost * 0.8 + Math.random() * 0.4;
  const currentMinuteCost = (Math.random() * 0.02).toFixed(2);

  elements.costTracker.textContent =
    `[API COST TRACKER] 24h: $${currentCost.toFixed(2)} | ` +
    `Today: $${todayCost.toFixed(2)} | ` +
    `Current: $${currentMinuteCost}`;
}

// Update function performance
function updateFunctionPerformance() {
  // Sort functions by average time
  const sortedFunctions = [...CONFIG.mockData.functions].sort((a, b) => b.avgTime - a.avgTime);

  // Update the slow functions list
  elements.slowFunctions.innerHTML = sortedFunctions
    .slice(0, 3)
    .map(
      func => `
            <li class="function-item">
                <span class="function-name">${func.name}</span>
                <span class="function-time">${func.avgTime}ms</span>
                <span class="trend ${func.trend}">${func.trend === 'up' ? '↑' : '↓'}</span>
            </li>
        `
    )
    .join('');

  // Randomly update function times and trends occasionally
  if (Math.random() > 0.7) {
    const funcToUpdate = Math.floor(Math.random() * CONFIG.mockData.functions.length);
    const change = (Math.random() - 0.5) * 50;

    CONFIG.mockData.functions[funcToUpdate].avgTime = Math.max(
      10,
      CONFIG.mockData.functions[funcToUpdate].avgTime + change
    );

    if (Math.abs(change) > 20) {
      CONFIG.mockData.functions[funcToUpdate].trend = change > 0 ? 'up' : 'down';
    }
  }
}

// Simulate API requests
function simulateApiRequests() {
  const endpoints = [
    { name: 'OpenAI', key: 'openai', avgTime: 300, maxTime: 2000 },
    { name: 'Weather API', key: 'weather', avgTime: 150, maxTime: 1000 },
    { name: 'Image Generation', key: 'image', avgTime: 800, maxTime: 5000 },
  ];

  function triggerRequest() {
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    const duration = Math.min(
      endpoint.maxTime,
      Math.max(100, Math.random() * endpoint.avgTime * 2)
    );

    // Add to active requests
    const requestId = Date.now();
    state.activeRequests.push({
      id: requestId,
      endpoint: endpoint.key,
      name: endpoint.name,
      startTime: Date.now(),
      duration: duration,
    });

    // Update UI
    updateActiveRequests();

    // Simulate request completion
    setTimeout(() => {
      state.activeRequests = state.activeRequests.filter(r => r.id !== requestId);
      updateActiveRequests();
    }, duration);

    // Schedule next request
    const nextDelay = 1000 + Math.random() * 4000; // 1-5 seconds
    setTimeout(triggerRequest, nextDelay);
  }

  // Start the first request
  triggerRequest();
}

// Update active requests display
function updateActiveRequests() {
  if (state.activeRequests.length > 0) {
    const activeRequest = state.activeRequests[0]; // Show most recent
    const elapsed = Date.now() - activeRequest.startTime;
    const progress = Math.min(100, (elapsed / activeRequest.duration) * 100);

    elements.requestProgress.style.width = `${progress}%`;
    elements.currentEndpoint.textContent = activeRequest.name;
    elements.requestTime.textContent = `${Math.round(elapsed)}ms`;
  } else {
    elements.requestProgress.style.width = '0%';
    elements.currentEndpoint.textContent = '-';
    elements.requestTime.textContent = '0ms';
  }
}

// Initialize the dashboard when the DOM is loaded
document.addEventListener('DOMContentLoaded', initDashboard);
