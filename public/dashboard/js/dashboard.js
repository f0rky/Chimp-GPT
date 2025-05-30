// Dashboard Configuration
const CONFIG = {
  updateInterval: 2000, // Update every 2 seconds
  maxDataPoints: 60, // 2 minutes of data at 2s intervals
  apiBaseUrl: window.location.origin, // Use absolute URL
  endpoints: {
    health: '/health',
    performance: '/performance',
    functionResults: '/function-results',
  },
  colors: {
    openai: 'rgba(114, 137, 218, 0.8)', // Discord blue
    weather: 'rgba(67, 181, 129, 0.8)', // Discord green
    image: 'rgba(250, 166, 26, 0.8)', // Discord yellow
    time: 'rgba(149, 165, 166, 0.8)', // Discord gray
    wolfram: 'rgba(155, 89, 182, 0.8)', // Discord purple
    quake: 'rgba(52, 152, 219, 0.8)', // Discord light blue
    gptimage: 'rgba(250, 166, 26, 0.8)', // Discord yellow
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
  healthData: null,
  performanceData: null,
  functionResults: [],
  apiEndpoints: ['openai', 'weather', 'time', 'wolfram', 'quake', 'gptimage'],
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
  themeToggle: document.getElementById('themeToggle'),
  themeIcon: document.querySelector('.theme-icon'),
};

// API Functions
async function fetchData(endpoint) {
  try {
    const response = await fetch(CONFIG.apiBaseUrl + endpoint);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching ${endpoint}:`, error);
    handleAPIError(endpoint, error);
    return null;
  }
}

// Handle API errors gracefully
function handleAPIError(endpoint, error) {
  // Add visual indication of error
  const errorMessage = document.createElement('div');
  errorMessage.className = 'api-error';
  errorMessage.innerHTML = `
    <span class="error-icon">⚠️</span>
    <span class="error-text">Failed to fetch ${endpoint}: ${error.message}</span>
  `;
  
  // Find or create error container
  let errorContainer = document.getElementById('errorContainer');
  if (!errorContainer) {
    errorContainer = document.createElement('div');
    errorContainer.id = 'errorContainer';
    errorContainer.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 1000;
      max-width: 300px;
    `;
    document.body.appendChild(errorContainer);
  }
  
  errorContainer.appendChild(errorMessage);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    errorMessage.remove();
  }, 5000);
  
  // Update status indicators to show error state
  if (endpoint.includes('health')) {
    elements.openaiStatus.textContent = 'ERROR';
    elements.openaiStatus.className = 'error';
    elements.weatherStatus.textContent = 'ERROR';
    elements.weatherStatus.className = 'error';
    elements.quakeStatus.textContent = 'ERROR';
    elements.quakeStatus.className = 'error';
  }
}

async function fetchHealthData() {
  const data = await fetchData(CONFIG.endpoints.health);
  if (data) {
    state.healthData = data;
    updateHealthDisplay(data);
  }
}

async function fetchPerformanceData() {
  const data = await fetchData(CONFIG.endpoints.performance);
  if (data) {
    state.performanceData = data;
    updatePerformanceDisplay(data);
  }
}

async function fetchFunctionResults() {
  const data = await fetchData(CONFIG.endpoints.functionResults);
  if (data) {
    state.functionResults = data;
    updateActiveRequests();
  }
}

// Initialize the dashboard
function initDashboard() {
  // Initialize latency data for all API endpoints
  state.apiEndpoints.forEach(endpoint => {
    state.latencyData[endpoint] = Array(CONFIG.maxDataPoints).fill(null);
  });

  // Initialize theme
  initTheme();

  // Initialize chart
  initChart();

  // Initialize mobile features
  initMobileFeatures();

  // Start updates
  updateTime();
  fetchAllData();

  // Set up periodic updates
  setInterval(updateTime, 1000);
  setInterval(fetchAllData, CONFIG.updateInterval);
}

// Theme Management
function initTheme() {
  // Load theme from localStorage or default to dark
  const savedTheme = localStorage.getItem('dashboardTheme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
  
  // Add theme toggle event listener
  elements.themeToggle.addEventListener('click', toggleTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
  // Update theme
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('dashboardTheme', newTheme);
  updateThemeIcon(newTheme);
  
  // Update chart colors if needed
  updateChartTheme();
}

function updateThemeIcon(theme) {
  elements.themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
}

function updateChartTheme() {
  if (!state.chart) return;
  
  // Get current theme colors
  const styles = getComputedStyle(document.documentElement);
  const gridColor = styles.getPropertyValue('--chart-grid-color').trim();
  const textColor = styles.getPropertyValue('--chart-text-color').trim();
  
  // Update chart options
  state.chart.options.scales.y.grid.color = gridColor;
  state.chart.options.scales.y.ticks.color = textColor;
  
  // Update dataset colors if needed
  const ctx = document.getElementById('latencyChart').getContext('2d');
  state.apiEndpoints.forEach((endpoint, index) => {
    if (CONFIG.colors[endpoint] && state.chart.data.datasets[index]) {
      const gradient = ctx.createLinearGradient(0, 0, 0, 200);
      gradient.addColorStop(0, CONFIG.colors[endpoint].replace('0.8', '0.5'));
      gradient.addColorStop(1, CONFIG.colors[endpoint].replace('0.8', '0.1'));
      state.chart.data.datasets[index].backgroundColor = gradient;
    }
  });
  
  state.chart.update('none');
}

// Initialize mobile-specific features
function initMobileFeatures() {
  // Detect mobile device
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isTablet = /iPad|Android/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent);
  
  if (isMobile || isTablet) {
    // Add mobile class to body
    document.body.classList.add('mobile-device');
    
    // Adjust update interval for mobile to reduce battery usage
    if (isMobile && !isTablet) {
      CONFIG.updateInterval = 5000; // Update every 5 seconds on mobile
    }
    
    // Add touch event handlers
    addTouchEventHandlers();
    
    // Handle orientation changes
    handleOrientationChange();
    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', debounce(handleResize, 250));
  }
  
  // Add visibility change handler to pause updates when page is hidden
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

// Handle touch events for better mobile interaction
function addTouchEventHandlers() {
  // Add swipe to refresh functionality
  let touchStartY = 0;
  let touchEndY = 0;
  
  document.addEventListener('touchstart', (e) => {
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });
  
  document.addEventListener('touchend', (e) => {
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
  }, { passive: true });
  
  function handleSwipe() {
    // Pull down to refresh (swipe down from top)
    if (touchEndY > touchStartY + 100 && window.scrollY === 0) {
      fetchAllData();
      showRefreshIndicator();
    }
  }
  
  // Add tap to expand/collapse cards on mobile
  const cards = document.querySelectorAll('.card');
  cards.forEach(card => {
    card.addEventListener('click', (e) => {
      if (window.innerWidth <= 767 && !e.target.closest('a')) {
        card.classList.toggle('expanded');
      }
    });
  });
}

// Show refresh indicator
function showRefreshIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'refresh-indicator';
  indicator.innerHTML = '<span>↻</span> Refreshing...';
  indicator.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--primary-color);
    color: white;
    padding: 10px 20px;
    border-radius: 20px;
    z-index: 1000;
    animation: fadeIn 0.3s ease;
  `;
  document.body.appendChild(indicator);
  
  setTimeout(() => {
    indicator.remove();
  }, 2000);
}

// Handle orientation changes
function handleOrientationChange() {
  const orientation = window.orientation || 0;
  const isLandscape = Math.abs(orientation) === 90;
  
  if (isLandscape && window.innerHeight < 600) {
    // Compact mode for landscape on small devices
    document.body.classList.add('landscape-compact');
  } else {
    document.body.classList.remove('landscape-compact');
  }
  
  // Resize chart on orientation change
  if (state.chart) {
    setTimeout(() => {
      state.chart.resize();
    }, 300);
  }
}

// Handle window resize
function handleResize() {
  if (state.chart) {
    state.chart.resize();
  }
}

// Handle visibility changes to optimize performance
function handleVisibilityChange() {
  if (document.hidden) {
    // Pause updates when page is hidden
    state.updatesPaused = true;
  } else {
    // Resume updates when page is visible
    state.updatesPaused = false;
    fetchAllData();
  }
}

// Debounce utility function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Fetch all data from API endpoints
async function fetchAllData() {
  // Skip updates if page is hidden
  if (state.updatesPaused) return;
  
  await Promise.all([
    fetchHealthData(),
    fetchPerformanceData(),
    fetchFunctionResults(),
  ]);
}

// Initialize the chart
function initChart() {
  const ctx = document.getElementById('latencyChart').getContext('2d');

  // Create gradient for each dataset
  const gradients = {};
  state.apiEndpoints.forEach(endpoint => {
    if (CONFIG.colors[endpoint]) {
      const gradient = ctx.createLinearGradient(0, 0, 0, 200);
      gradient.addColorStop(0, CONFIG.colors[endpoint].replace('0.8', '0.5'));
      gradient.addColorStop(1, CONFIG.colors[endpoint].replace('0.8', '0.1'));
      gradients[endpoint] = gradient;
    }
  });

  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(CONFIG.maxDataPoints).fill(''),
      datasets: state.apiEndpoints.map(endpoint => ({
        label: endpoint,
        data: state.latencyData[endpoint],
        borderColor: CONFIG.colors[endpoint] || 'rgba(128, 128, 128, 0.8)',
        backgroundColor: gradients[endpoint] || 'rgba(128, 128, 128, 0.1)',
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
            color: 'rgba(255, 255, 255, 0.1)',
          },
          ticks: {
            color: '#b9bbbe',
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
          backgroundColor: 'rgba(47, 49, 54, 0.95)',
          titleColor: '#ffffff',
          bodyColor: '#b9bbbe',
          borderColor: 'rgba(255, 255, 255, 0.1)',
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

// Update display with health data
function updateHealthDisplay(data) {
  if (!data) return;

  // Update API status indicators
  elements.openaiStatus.textContent = data.discord?.status === 'ok' ? 'ONLINE' : 'OFFLINE';
  elements.openaiStatus.className = data.discord?.status === 'ok' ? 'online' : 'offline';
  
  elements.weatherStatus.textContent = data.stats?.apiCalls?.weather > 0 ? 'ONLINE' : 'IDLE';
  elements.weatherStatus.className = data.stats?.apiCalls?.weather > 0 ? 'online' : 'idle';
  
  elements.quakeStatus.textContent = data.stats?.apiCalls?.quake > 0 ? 'ONLINE' : 'IDLE';
  elements.quakeStatus.className = data.stats?.apiCalls?.quake > 0 ? 'online' : 'idle';

  // Update memory usage
  if (data.memory) {
    const heapUsed = parseInt(data.memory.heapUsed);
    const heapTotal = parseInt(data.memory.heapTotal);
    if (!isNaN(heapUsed) && !isNaN(heapTotal)) {
      const percentage = (heapUsed / heapTotal) * 100;
      elements.memoryGauge.style.width = `${percentage}%`;
      elements.memoryText.textContent = `${heapUsed}MB / ${heapTotal}MB`;
      
      // Update color based on usage
      if (percentage > 80) {
        elements.memoryGauge.style.background = 'linear-gradient(90deg, #ff4444, #ff00ff)';
      } else if (percentage > 60) {
        elements.memoryGauge.style.background = 'linear-gradient(90deg, #ffaa00, #ff00ff)';
      } else {
        elements.memoryGauge.style.background = 'linear-gradient(90deg, var(--accent-1), var(--accent-2))';
      }
    }
  }

  // Update cost tracker based on API calls
  if (data.stats?.apiCalls) {
    updateCostTrackerFromStats(data.stats);
  }
}

// Update display with performance data
function updatePerformanceDisplay(data) {
  if (!data || !data.summary) return;

  // Update latency data for chart
  state.apiEndpoints.forEach(endpoint => {
    // Shift data left
    state.latencyData[endpoint].shift();

    // Get real latency from performance data
    let newValue = null;
    
    // Map endpoint names to performance metric names
    const perfMapping = {
      'openai': 'openai_api',
      'weather': 'weather_api',
      'time': 'time_api',
      'wolfram': 'wolfram_api',
      'quake': 'quake_api',
      'gptimage': 'gptimage_api',
    };

    const perfKey = perfMapping[endpoint];
    if (perfKey && data.summary[perfKey]) {
      newValue = data.summary[perfKey].avg || 0;
    } else {
      newValue = 0; // No data for this endpoint
    }

    state.latencyData[endpoint].push(newValue);

    // Update latency display for specific endpoints we have elements for
    if (endpoint === 'openai' && elements.openaiLatency) {
      elements.openaiLatency.textContent = `${Math.round(newValue)}ms`;
    } else if (endpoint === 'weather' && elements.weatherLatency) {
      elements.weatherLatency.textContent = `${Math.round(newValue)}ms`;
    } else if (endpoint === 'gptimage' && elements.imageLatency) {
      elements.imageLatency.textContent = `${Math.round(newValue)}ms`;
    }
  });

  // Update chart
  if (state.chart) {
    state.chart.update('none');
  }

  // Update function performance
  updateFunctionPerformanceFromData(data.summary);
}

// Update cost tracker from stats
function updateCostTrackerFromStats(stats) {
  if (!stats || !stats.apiCalls) return;

  // Calculate estimated costs based on API calls
  const costs = {
    openai: (stats.apiCalls.openai || 0) * 0.002, // Estimate $0.002 per call
    weather: (stats.apiCalls.weather || 0) * 0.0001,
    time: (stats.apiCalls.time || 0) * 0.00005,
    wolfram: (stats.apiCalls.wolfram || 0) * 0.001,
    quake: (stats.apiCalls.quake || 0) * 0.00005,
    gptimage: (stats.apiCalls.gptimage || 0) * 0.02, // Higher cost for image generation
  };

  const totalCost = Object.values(costs).reduce((sum, cost) => sum + cost, 0);
  const todayCost = totalCost * 0.3; // Estimate today as 30% of total
  const currentCost = (Math.random() * 0.001).toFixed(4);

  elements.costTracker.textContent =
    `[API COST TRACKER] Total: $${totalCost.toFixed(2)} | ` +
    `Today: $${todayCost.toFixed(2)} | ` +
    `Current: $${currentCost}`;
}

// Update function performance from real data
function updateFunctionPerformanceFromData(summary) {
  if (!summary) return;

  // Convert summary data to function list format
  const functions = [];
  
  for (const [key, data] of Object.entries(summary)) {
    if (data && data.avg) {
      functions.push({
        name: key.replace('_api', '').replace('_', ' '),
        avgTime: Math.round(data.avg),
        count: data.count || 0,
      });
    }
  }

  // Sort by average time
  functions.sort((a, b) => b.avgTime - a.avgTime);

  // Update the slow functions list
  elements.slowFunctions.innerHTML = functions
    .slice(0, 3)
    .map(
      func => `
            <li class="function-item">
                <span class="function-name">${func.name}</span>
                <span class="function-time">${func.avgTime}ms</span>
                <span class="trend">(${func.count} calls)</span>
            </li>
        `
    )
    .join('');
}

// Update active requests display
function updateActiveRequests() {
  // Use function results to simulate active requests
  if (state.functionResults && state.functionResults.length > 0) {
    // Get the most recent function result
    const recentResults = state.functionResults.slice(-5); // Last 5 results
    const now = Date.now();
    
    // Find any ongoing operations (e.g., image generation which takes longer)
    let activeRequest = null;
    
    for (const result of recentResults) {
      if (result.timestamp) {
        const age = now - new Date(result.timestamp).getTime();
        // Consider requests within last 10 seconds as potentially active
        if (age < 10000) {
          const estimatedDuration = result.functionName === 'generateImage' ? 5000 : 
                                   result.functionName === 'lookupWeather' ? 1500 : 
                                   result.functionName === 'getWolframShortAnswer' ? 2000 : 1000;
          
          if (age < estimatedDuration) {
            activeRequest = {
              name: result.functionName || 'Unknown',
              startTime: new Date(result.timestamp).getTime(),
              duration: estimatedDuration,
              elapsed: age,
            };
            break;
          }
        }
      }
    }
    
    if (activeRequest) {
      const progress = Math.min(100, (activeRequest.elapsed / activeRequest.duration) * 100);
      elements.requestProgress.style.width = `${progress}%`;
      elements.currentEndpoint.textContent = activeRequest.name;
      elements.requestTime.textContent = `${Math.round(activeRequest.elapsed)}ms`;
    } else {
      elements.requestProgress.style.width = '0%';
      elements.currentEndpoint.textContent = '-';
      elements.requestTime.textContent = '0ms';
    }
  } else {
    elements.requestProgress.style.width = '0%';
    elements.currentEndpoint.textContent = '-';
    elements.requestTime.textContent = '0ms';
  }
}

// Initialize the dashboard when the DOM is loaded
document.addEventListener('DOMContentLoaded', initDashboard);
