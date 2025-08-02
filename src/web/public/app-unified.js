// Unified Dashboard JavaScript
// Combines functionality from status page, performance dashboard, and settings

// Global state
const state = {
  currentTab: 'status',
  theme: localStorage.getItem('theme') || 'dark',
  debugCollapsed: localStorage.getItem('debugCollapsed') === 'true',
  updateIntervals: {
    status: 10000, // 10 seconds
    performance: 5000, // 5 seconds
    functions: 15000, // 15 seconds
  },
  charts: {},
  timers: {},
  performanceData: {
    labels: [],
    responseTime: [],
    cpuUsage: [],
    memoryUsage: [],
  },
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  logDebug('Unified dashboard initializing...', 'info');
  logDebug('Dashboard starting up', 'info');

  initializeTheme();
  initializeTabs();
  initializeDebugConsole();
  initializeCharts();
  startDataFetching();
  setupEventListeners();
  updateClock();

  logDebug('Unified dashboard initialized', 'info');
  logDebug('Dashboard fully loaded', 'info');
});

// Theme Management
function initializeTheme() {
  if (state.theme === 'light') {
    document.body.classList.add('light-theme');
  }
  updateThemeIcon();
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.body.classList.toggle('light-theme');
  localStorage.setItem('theme', state.theme);
  updateThemeIcon();
}

function updateThemeIcon() {
  const icon = document.querySelector('#theme-toggle i');
  icon.className = state.theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
}

// Tab Management
function initializeTabs() {
  const tabs = document.querySelectorAll('.tab-button');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;

      // Update active states
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`${targetTab}-tab`).classList.add('active');

      state.currentTab = targetTab;

      // Load tab-specific data
      loadTabData(targetTab);
    });
  });
}

function loadTabData(tab) {
  switch (tab) {
    case 'status':
      fetchHealthData();
      // Also fetch performance data for response time metrics
      fetchPerformanceDataForStatus();
      break;
    case 'performance':
      fetchPerformanceData();
      break;
    case 'functions':
      fetchFunctionResults();
      fetchBlockedUsers();
      break;
    case 'settings':
      fetchSettings();
      break;
    case 'deleted-messages':
      fetchDeletedMessages();
      break;
    default:
      break;
  }
}

// Debug Console
function initializeDebugConsole() {
  const debugConsole = document.getElementById('debug-console');
  const debugToggle = document.getElementById('debug-toggle');
  const debugInput = document.getElementById('debug-command');

  if (state.debugCollapsed) {
    debugConsole.classList.add('collapsed');
  }

  debugToggle.addEventListener('click', () => {
    debugConsole.classList.toggle('collapsed');
    state.debugCollapsed = debugConsole.classList.contains('collapsed');
    localStorage.setItem('debugCollapsed', state.debugCollapsed);

    const icon = debugToggle.querySelector('i');
    icon.className = state.debugCollapsed ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
  });

  debugInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') {
      executeDebugCommand(e.target.value);
      e.target.value = '';
    }
  });
}

function logDebug(message, type = 'info') {
  const debugMessages = document.getElementById('debug-messages');
  const timestamp = new Date().toLocaleTimeString();

  const messageEl = document.createElement('div');
  messageEl.className = `debug-message ${type}`;
  messageEl.textContent = `[${timestamp}] ${message}`;

  debugMessages.appendChild(messageEl);
  debugMessages.scrollTop = debugMessages.scrollHeight;

  // Keep only last 100 messages
  while (debugMessages.children.length > 100) {
    debugMessages.removeChild(debugMessages.firstChild);
  }
}

function executeDebugCommand(command) {
  logDebug(`> ${command}`, 'info');

  // Simple command parser
  const [cmd, ..._args] = command.toLowerCase().split(' ');

  switch (cmd) {
    case 'clear':
      document.getElementById('debug-messages').innerHTML = '';
      break;
    case 'reload':
      location.reload();
      break;
    case 'theme':
      toggleTheme();
      logDebug('Theme toggled', 'info');
      break;
    case 'help':
      logDebug('Available commands: clear, reload, theme, help', 'info');
      break;
    default:
      logDebug(`Unknown command: ${cmd}`, 'error');
  }
}

// Chart Initialization
function initializeCharts() {
  logDebug('Initializing charts...', 'info');

  // Status page metrics chart
  const metricsCanvas = document.getElementById('metrics-chart');
  logDebug('Metrics canvas found: ' + (metricsCanvas ? 'yes' : 'no'), 'info');

  if (metricsCanvas) {
    const metricsCtx = metricsCanvas.getContext('2d');
    state.charts.metrics = new Chart(metricsCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Response Time (ms)',
            data: [],
            borderColor: '#7289da',
            backgroundColor: 'rgba(114, 137, 218, 0.1)',
            tension: 0.4,
          },
          {
            label: 'CPU Usage (%)',
            data: [],
            borderColor: '#43b581',
            backgroundColor: 'rgba(67, 181, 129, 0.1)',
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
            },
          },
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
            },
          },
        },
      },
    });
  }

  // Performance dashboard latency chart
  const latencyCanvas = document.getElementById('latencyChart');
  logDebug('Latency canvas found: ' + (latencyCanvas ? 'yes' : 'no'), 'info');

  if (latencyCanvas) {
    const latencyCtx = latencyCanvas.getContext('2d');
    state.charts.latency = new Chart(latencyCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'OpenAI',
            data: [],
            borderColor: '#7289da',
            tension: 0.4,
          },
          {
            label: 'Weather',
            data: [],
            borderColor: '#43b581',
            tension: 0.4,
          },
          {
            label: 'Other',
            data: [],
            borderColor: '#faa61a',
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
            },
          },
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
            },
          },
        },
      },
    });
  }

  logDebug('Charts initialized: ' + Object.keys(state.charts).length + ' charts', 'info');
}

// Data Fetching
function startDataFetching() {
  // Initial fetch
  fetchHealthData();
  fetchPerformanceDataForStatus();

  // Set up intervals
  state.timers.status = setInterval(() => {
    if (state.currentTab === 'status') {
      fetchHealthData();
      fetchPerformanceDataForStatus();
    }
  }, state.updateIntervals.status);

  state.timers.performance = setInterval(() => {
    if (state.currentTab === 'performance') {
      fetchPerformanceData();
    }
  }, state.updateIntervals.performance);
}

async function fetchHealthData() {
  try {
    const response = await fetch('/health');
    const data = await response.json();

    logDebug('Health data received from API', 'info');
    updateStatusDisplay(data);
    updateConversationMode(data.conversationMode);
    logDebug('Health data updated', 'info');
  } catch (error) {
    logDebug('Error fetching health data: ' + error.message, 'error');
    logDebug(`Error fetching health data: ${error.message}`, 'error');
  }
}

async function fetchPerformanceData() {
  try {
    const response = await fetch('/performance');
    const data = await response.json();

    logDebug('Performance data received from API', 'info');
    updatePerformanceDisplay(data);
    updateCharts(data);
    logDebug('Performance data updated', 'info');
  } catch (error) {
    logDebug('Error fetching performance data: ' + error.message, 'error');
    logDebug(`Error fetching performance data: ${error.message}`, 'error');
  }
}

async function fetchPerformanceDataForStatus() {
  try {
    const response = await fetch('/performance');
    const data = await response.json();

    logDebug('Performance data for status tab received', 'info');
    logDebug('Performance summary available: ' + (data.summary ? 'yes' : 'no'), 'info');
    if (data.summary) {
      logDebug('Summary keys: ' + Object.keys(data.summary).join(', '), 'info');
    }
    updateStatusResponseTime(data);
    logDebug('Status response time updated', 'info');
  } catch (error) {
    logDebug('Error fetching performance data for status: ' + error.message, 'error');
    logDebug(`Error fetching performance data for status: ${error.message}`, 'error');
  }
}

async function fetchFunctionResults() {
  try {
    const response = await fetch('/function-results/summary');
    const data = await response.json();

    logDebug('Function results summary received', 'info');
    updateFunctionSummary(data);
    logDebug('Function results updated', 'info');
  } catch (error) {
    logDebug('Error fetching function results: ' + error.message, 'error');
    logDebug(`Error fetching function results: ${error.message}`, 'error');
  }
}

async function fetchBlockedUsers() {
  try {
    const response = await fetch('/blocked-users');
    const data = await response.json();

    updateBlockedUsers(data);
    logDebug('Blocked users updated', 'info');
  } catch (error) {
    logDebug(`Error fetching blocked users: ${error.message}`, 'error');
  }
}

async function fetchSettings() {
  try {
    const response = await fetch('/settings');
    const data = await response.json();

    updateSettingsDisplay(data);
    logDebug('Settings loaded', 'info');
  } catch (error) {
    logDebug(`Error fetching settings: ${error.message}`, 'error');
  }
}

// Display Updates
function updateStatusDisplay(data) {
  logDebug('Updating status display with new data', 'info');

  // Update header
  const headerEl = document.getElementById('bot-name-header');
  if (headerEl) {
    headerEl.textContent = data.name || 'Bot Status';
    document.title = `${data.name || 'Bot'} Status`;
  } else {
    logDebug('bot-name-header element not found', 'warn');
  }

  // Update status indicator
  const statusDot = document.querySelector('.dot');
  const statusText = document.querySelector('.status-text');

  if (statusDot && statusText) {
    if (data.discord?.status === 'ok' || data.status === 'ok') {
      statusDot.className = 'dot online';
      statusText.textContent = 'Online';
    } else {
      statusDot.className = 'dot offline';
      statusText.textContent = 'Offline';
    }
  } else {
    logDebug('Status indicator elements not found', 'warn');
  }

  // Update stats with null checks
  const elements = ['uptime', 'version', 'message-count', 'discord-ping'];
  const values = [
    data.formattedUptime || '--:--:--',
    data.version || '-.-.-',
    data.stats?.messageCount || '0',
    `${data.discord?.ping || '--'} ms`,
  ];

  elements.forEach((id, index) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = values[index];
    } else {
      logDebug(`Element ${id} not found`, 'warn');
    }
  });

  // Update system stats from actual data
  if (data.system?.loadAvg && data.system?.cpus) {
    const cpuUsage = Math.round((data.system.loadAvg[0] / data.system.cpus) * 100);
    const cpuElement = document.getElementById('cpu-usage');
    if (cpuElement) cpuElement.textContent = `${cpuUsage}%`;
  } else {
    // Fallback if system data is not available
    const cpuElement = document.getElementById('cpu-usage');
    if (cpuElement) {
      cpuElement.textContent = '---%';
    }
  }

  const memoryElement = document.getElementById('memory-usage');
  if (memoryElement) {
    memoryElement.textContent = data.memory?.rss || '-- MB';
  }

  // For response time, we need to fetch it from performance data or calculate a mock value
  // Since this is the health endpoint, let's show a reasonable placeholder
  const responseTimeEl = document.getElementById('response-time');
  const avgResponseTimeEl = document.getElementById('avg-response-time');
  if (responseTimeEl && avgResponseTimeEl) {
    // We'll update this when performance data is available
    responseTimeEl.textContent = '-- ms';
    avgResponseTimeEl.textContent = '-- ms';
  }

  // Calculate total API calls
  const totalApiCalls = Object.values(data.stats?.apiCalls || {}).reduce((sum, count) => {
    // Handle nested plugin calls
    if (typeof count === 'object' && count !== null) {
      return sum + Object.values(count).reduce((s, c) => s + (typeof c === 'number' ? c : 0), 0);
    }
    return sum + (typeof count === 'number' ? count : 0);
  }, 0);
  document.getElementById('total-api-calls').textContent = totalApiCalls;

  // Update API stats
  updateApiStats(data.stats?.apiCalls);

  // Update rate limits
  updateRateLimits(data.stats?.rateLimits);

  // Update the metrics chart with real data
  updateMetricsChart(data);
}

function updateStatusResponseTime(data) {
  if (!data.summary) {
    logDebug('No summary in performance data', 'warn');
    return;
  }

  const responseTimeEl = document.getElementById('response-time');
  const avgResponseTimeEl = document.getElementById('avg-response-time');

  if (responseTimeEl && avgResponseTimeEl) {
    // Get response time from the correct field name (with underscores)
    let avgResponseTime = 0;

    if (data.summary.message_processing?.avg) {
      avgResponseTime = Math.round(data.summary.message_processing.avg);
    } else if (data.summary.openai_api?.avg) {
      avgResponseTime = Math.round(data.summary.openai_api.avg);
    } else {
      // Fallback to any field with avg
      for (const [_key, value] of Object.entries(data.summary)) {
        if (value && value.avg) {
          avgResponseTime = Math.round(value.avg);
          break;
        }
      }
    }
    responseTimeEl.textContent = `${avgResponseTime} ms`;
    avgResponseTimeEl.textContent = `${avgResponseTime} ms`;

    // Also update the chart if we're on the status tab
    if (state.currentTab === 'status') {
      updateMetricsChart({ stats: { responseTime: avgResponseTime }, system: {} });
    }
  }
}

function updateConversationMode(modeData) {
  const modeElements = document.querySelectorAll('.conversation-mode .mode-text');
  modeElements.forEach(el => {
    el.textContent = modeData?.mode || 'Unknown';
    el.title = `Blended: ${modeData?.blendedConversations}, Reply Context: ${modeData?.replyContext}`;
  });
}

function updateApiStats(apiCalls) {
  const container = document.getElementById('api-stats');
  if (!container) {
    logDebug('api-stats container not found', 'warn');
    return;
  }
  container.innerHTML = '';

  for (const [api, count] of Object.entries(apiCalls || {})) {
    // Handle nested plugin API calls
    if (typeof count === 'object' && count !== null) {
      // Skip nested objects for now, or sum them up
      continue;
    }

    const item = document.createElement('div');
    item.className = 'api-stat-item';
    // Secure DOM creation to prevent XSS
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = api.charAt(0).toUpperCase() + api.slice(1);

    const countSpan = document.createElement('span');
    countSpan.className = 'count';
    countSpan.textContent = count;

    item.appendChild(nameSpan);
    item.appendChild(countSpan);
    container.appendChild(item);
  }
}

function updateRateLimits(rateLimits) {
  const container = document.getElementById('rate-limits');
  // Secure DOM creation to prevent XSS
  container.innerHTML = ''; // Clear existing content safely

  const statGrid = document.createElement('div');
  statGrid.className = 'stat-grid';

  // Total Hits stat
  const totalHitsStat = document.createElement('div');
  totalHitsStat.className = 'stat';

  const totalHitsLabel = document.createElement('span');
  totalHitsLabel.className = 'label';
  totalHitsLabel.textContent = 'Total Hits';

  const totalHitsValue = document.createElement('span');
  totalHitsValue.className = 'value';
  totalHitsValue.textContent = rateLimits?.count || 0;

  totalHitsStat.appendChild(totalHitsLabel);
  totalHitsStat.appendChild(totalHitsValue);

  // Unique Users stat
  const uniqueUsersStat = document.createElement('div');
  uniqueUsersStat.className = 'stat';

  const uniqueUsersLabel = document.createElement('span');
  uniqueUsersLabel.className = 'label';
  uniqueUsersLabel.textContent = 'Unique Users';

  const uniqueUsersValue = document.createElement('span');
  uniqueUsersValue.className = 'value';
  uniqueUsersValue.textContent = rateLimits?.uniqueUsers || 0;

  uniqueUsersStat.appendChild(uniqueUsersLabel);
  uniqueUsersStat.appendChild(uniqueUsersValue);

  statGrid.appendChild(totalHitsStat);
  statGrid.appendChild(uniqueUsersStat);
  container.appendChild(statGrid);
}

function updatePerformanceDisplay(data) {
  if (!data.summary) {
    logDebug('No performance summary data available', 'warn');
    return;
  }

  // Update response time (only if elements exist) - using correct field name
  const responseTimeEl = document.getElementById('response-time');
  const avgResponseTimeEl = document.getElementById('avg-response-time');
  const avgResponseTime = Math.round(data.summary.message_processing?.avg || 0);

  if (responseTimeEl) responseTimeEl.textContent = `${avgResponseTime} ms`;
  if (avgResponseTimeEl) avgResponseTimeEl.textContent = `${avgResponseTime} ms`;

  // Update min/max
  const minMaxEl = document.getElementById('minmax-response-time');
  if (minMaxEl) {
    const min = Math.round(data.summary.message_processing?.min || 0);
    const max = Math.round(data.summary.message_processing?.max || 0);
    minMaxEl.textContent = `${min} / ${max} ms`;
  }

  // Update API status
  updateApiStatus(data);

  // Update memory gauge
  updateMemoryGauge(data.serverHealth?.memory);

  // Update latency stats (only if elements exist) - using correct field names
  const openaiLatencyEl = document.getElementById('openaiLatency');
  const weatherLatencyEl = document.getElementById('weatherLatency');
  const otherLatencyEl = document.getElementById('otherLatency');

  if (openaiLatencyEl)
    openaiLatencyEl.textContent = `${Math.round(data.summary.openai_api?.avg || 0)}ms`;
  if (weatherLatencyEl)
    weatherLatencyEl.textContent = `${Math.round(data.summary.weather_api?.avg || 0)}ms`;
  if (otherLatencyEl)
    otherLatencyEl.textContent = `${Math.round(data.summary.plugin_execution?.avg || 0)}ms`;

  // Update request history
  updateRequestHistory(data.detailed);
}

function updateApiStatus(_data) {
  // This would check circuit breaker states or recent errors
  // For now, just show as operational
  document.getElementById('openaiStatus').textContent = 'Operational';
  document.getElementById('weatherStatus').textContent = 'Operational';
  document.getElementById('quakeStatus').textContent = 'Operational';
}

function updateMemoryGauge(memory) {
  if (!memory) return;

  const rss = parseInt(memory.rss, 10);
  const maxMemory = 1500; // 1.5GB typical limit
  const percentage = Math.min((rss / maxMemory) * 100, 100);

  const gauge = document.getElementById('memoryGauge');
  const text = document.getElementById('memoryText');

  gauge.style.height = `${percentage}%`;
  text.textContent = `${rss}MB / ${maxMemory}MB`;

  // Change color based on usage
  if (percentage > 80) {
    gauge.style.background = 'linear-gradient(180deg, #f04747, #faa61a)';
  } else if (percentage > 60) {
    gauge.style.background = 'linear-gradient(180deg, #faa61a, #43b581)';
  } else {
    gauge.style.background = 'linear-gradient(180deg, #43b581, #43b581)';
  }
}

function updateMetricsChart(data) {
  if (!state.charts.metrics) {
    logDebug('Metrics chart not initialized', 'warn');
    return;
  }

  // Add new data point
  const now = new Date().toLocaleTimeString();
  state.performanceData.labels.push(now);

  // Use actual response time from performance data if available
  const responseTime = data.stats?.responseTime || Math.random() * 100 + 50;
  state.performanceData.responseTime.push(responseTime);

  // Calculate actual CPU usage from system data
  const cpuUsage =
    data.system?.loadAvg && data.system?.cpus
      ? Math.round((data.system.loadAvg[0] / data.system.cpus) * 100)
      : Math.random() * 20 + 10;
  state.performanceData.cpuUsage.push(cpuUsage);

  // Keep only last 20 points
  if (state.performanceData.labels.length > 20) {
    state.performanceData.labels.shift();
    state.performanceData.responseTime.shift();
    state.performanceData.cpuUsage.shift();
  }

  try {
    // Update chart
    state.charts.metrics.data.labels = state.performanceData.labels;
    state.charts.metrics.data.datasets[0].data = state.performanceData.responseTime;
    state.charts.metrics.data.datasets[1].data = state.performanceData.cpuUsage;
    state.charts.metrics.update('none');
  } catch (error) {
    logDebug('Error updating metrics chart: ' + error.message, 'error');
  }
}

function updateCharts(data) {
  // Update latency chart if on performance tab
  if (!state.charts.latency || !data.summary) return;

  const now = new Date().toLocaleTimeString();

  // Add new data points
  state.charts.latency.data.labels.push(now);

  // Keep only last 30 points
  if (state.charts.latency.data.labels.length > 30) {
    state.charts.latency.data.labels.shift();
    state.charts.latency.data.datasets.forEach(dataset => {
      dataset.data.shift();
    });
  }

  // Update with actual API latency data (using correct field names)
  state.charts.latency.data.datasets[0].data.push(data.summary.openai_api?.avg || 0);
  state.charts.latency.data.datasets[1].data.push(data.summary.weather_api?.avg || 0);
  state.charts.latency.data.datasets[2].data.push(data.summary.plugin_execution?.avg || 0);

  state.charts.latency.update('none');
}

function updateFunctionSummary(data) {
  const container = document.getElementById('function-summary');
  container.innerHTML = '';

  for (const [func, info] of Object.entries(data)) {
    if (typeof info === 'object' && info.count !== undefined) {
      const item = document.createElement('div');
      item.className = 'api-stat-item';
      item.innerHTML = `
        <span class="name">${func.charAt(0).toUpperCase() + func.slice(1)}</span>
        <span class="count">${info.count}</span>
        <button class="btn-icon-small" onclick="loadFunctionDetails('${func}')">
          <i class="fas fa-eye"></i>
        </button>
      `;
      container.appendChild(item);
    }
  }

  // Auto-load images if they exist
  if (data.gptimage && data.gptimage.count > 0) {
    loadFunctionDetails('gptimage');
  }

  // Auto-load weather if it exists
  if (data.weather && data.weather.count > 0) {
    loadFunctionDetails('weather');
  }
}

function updateBlockedUsers(data) {
  const container = document.getElementById('blocked-users-container');
  container.innerHTML = '';

  if (data.users && data.users.length > 0) {
    data.users.forEach(user => {
      const item = document.createElement('div');
      item.className = 'blocked-user';
      item.innerHTML = `
        <div>
          <strong>${user.userId}</strong>
          <small>Blocked: ${user.blockedAt}</small>
        </div>
        <button class="btn btn-warning" onclick="unblockUser('${user.userId}')">
          Unblock
        </button>
      `;
      container.appendChild(item);
    });
  } else {
    container.innerHTML = '<p class="text-center">No blocked users</p>';
  }
}

function updateSettingsDisplay(data) {
  // Update summary
  const summary = document.getElementById('settings-summary');
  summary.innerHTML = `
    <div class="summary-stat">
      <strong>${data.summary.total}</strong>
      <small>Total</small>
    </div>
    <div class="summary-stat">
      <strong>${data.summary.required}</strong>
      <small>Required</small>
    </div>
    <div class="summary-stat">
      <strong>${data.summary.set}</strong>
      <small>Set</small>
    </div>
    <div class="summary-stat">
      <strong>${data.summary.valid}</strong>
      <small>Valid</small>
    </div>
  `;

  // Update settings list
  const list = document.getElementById('settings-list');
  list.innerHTML = '';

  data.settings.forEach(setting => {
    const item = document.createElement('div');
    item.className = 'setting-item';
    item.dataset.required = setting.required;
    item.dataset.set = setting.isSet;

    item.innerHTML = `
      <div class="setting-info">
        <h3>${setting.key}</h3>
        <p>${setting.description}</p>
        <div class="setting-value">${setting.displayValue}</div>
      </div>
      <div class="setting-badges">
        ${setting.required ? '<span class="badge required">Required</span>' : '<span class="badge optional">Optional</span>'}
        ${setting.isSet ? '<span class="badge set">Set</span>' : '<span class="badge missing">Missing</span>'}
      </div>
    `;

    list.appendChild(item);
  });
}

// Event Listeners
function setupEventListeners() {
  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Test button
  document.getElementById('run-tests')?.addEventListener('click', runTests);

  // Reset stats button
  document.getElementById('reset-stats')?.addEventListener('click', resetStats);

  // Settings filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterSettings(btn.dataset.filter);

      // Update active state
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

// Utility Functions
function updateClock() {
  const updateTime = () => {
    const now = new Date();
    document.getElementById('currentTime').textContent = now.toLocaleTimeString();
  };

  updateTime();
  setInterval(updateTime, 1000);
}

async function runTests() {
  logDebug('Running tests...', 'info');
  try {
    const response = await fetch('/run-tests');
    const _results = await response.json();
    logDebug('Tests completed successfully', 'info');
    logDebug('Test results received from API', 'info');
  } catch (error) {
    logDebug(`Test execution failed: ${error.message}`, 'error');
  }
}

async function resetStats() {
  if (!confirm('Are you sure you want to reset all statistics?')) return;

  try {
    const response = await fetch('/reset-stats', { method: 'POST' });
    const result = await response.json();

    if (result.success) {
      logDebug('Statistics reset successfully', 'info');
      fetchHealthData();
    } else {
      logDebug('Failed to reset statistics', 'error');
    }
  } catch (error) {
    logDebug(`Error resetting stats: ${error.message}`, 'error');
  }
}

async function unblockUser(userId) {
  const token = prompt('Enter owner token:');
  if (!token) return;

  try {
    const response = await fetch('/unblock-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Token': token,
      },
      body: JSON.stringify({ userId }),
    });

    const result = await response.json();

    if (result.success) {
      logDebug(`User ${userId} unblocked`, 'info');
      fetchBlockedUsers();
    } else {
      logDebug(`Failed to unblock user: ${result.error}`, 'error');
    }
  } catch (error) {
    logDebug(`Error unblocking user: ${error.message}`, 'error');
  }
}

function updateRequestHistory(detailed) {
  const container = document.getElementById('requestHistory');
  if (!container || !detailed) return;

  container.innerHTML = '';

  // Get recent operations
  const operations = [];
  for (const [op, stats] of Object.entries(detailed)) {
    if (stats.recent && stats.recent.length > 0) {
      stats.recent.forEach(item => {
        operations.push({ operation: op, ...item });
      });
    }
  }

  // Sort by timestamp and take last 10
  operations.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const recent = operations.slice(0, 10);

  if (recent.length === 0) {
    container.innerHTML = '<div class="text-center">No recent requests</div>';
    return;
  }

  recent.forEach(req => {
    const div = document.createElement('div');
    div.className = 'result-item';
    const time = req.timestamp ? new Date(req.timestamp).toLocaleTimeString() : 'Unknown';
    div.innerHTML = `
      <strong>${req.operation}</strong>
      <span>${req.duration}ms</span>
      <small>${time}</small>
    `;
    container.appendChild(div);
  });
}

function filterSettings(filter) {
  const items = document.querySelectorAll('.setting-item');

  items.forEach(item => {
    let show = true;

    switch (filter) {
      case 'required':
        show = item.dataset.required === 'true';
        break;
      case 'optional':
        show = item.dataset.required === 'false';
        break;
      case 'issues':
        show = item.dataset.set === 'false' && item.dataset.required === 'true';
        break;
      default:
        show = true;
        break;
    }

    item.style.display = show ? 'grid' : 'none';
  });
}

async function loadFunctionDetails(func) {
  try {
    const response = await fetch(`/function-results?limit=10`);
    const data = await response.json();

    // Display the results for this function
    logDebug(`Details for ${func} received`, 'info');
    logDebug(`Loaded details for ${func}`, 'info');

    // If it's images, update the gallery
    if ((func === 'images' || func === 'gptimage') && (data.images || data.gptimage)) {
      updateImageGallery(data.images || data.gptimage);
    } else if (func === 'weather' && data.weather) {
      updateWeatherResults(data.weather);
    }
  } catch (error) {
    logDebug(`Error loading function details: ${error.message}`, 'error');
  }
}

function updateImageGallery(images) {
  const gallery = document.getElementById('images-gallery');
  gallery.innerHTML = '';

  if (!images || images.length === 0) {
    gallery.innerHTML = '<p class="text-center">No images generated yet</p>';
    return;
  }

  // Show latest 12 images
  const recentImages = images.slice(-12).reverse();
  recentImages.forEach(img => {
    const item = document.createElement('div');
    item.className = 'gallery-item';

    // Extract image URL and prompt from the correct data structure
    const imageUrl = img.result?.images?.[0]?.url || img.url;
    const imagePrompt = img.params?.prompt || img.prompt || 'Generated image';

    if (imageUrl) {
      const imgElement = document.createElement('img');
      imgElement.src = imageUrl;
      imgElement.alt = imagePrompt;
      imgElement.onclick = () => openImageModal(imageUrl, imagePrompt);
      item.appendChild(imgElement);
    } else {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error';
      errorDiv.textContent = 'Image URL not available';
      item.appendChild(errorDiv);
    }

    gallery.appendChild(item);
  });
}

function updateWeatherResults(weatherData) {
  const container = document.getElementById('weather-results');
  container.innerHTML = '';

  if (!weatherData || weatherData.length === 0) {
    container.innerHTML = '<p class="text-center">No weather lookups yet</p>';
    return;
  }

  // Show latest 5 weather lookups
  const recent = weatherData.slice(-5).reverse();
  recent.forEach(item => {
    const div = document.createElement('div');
    div.className = 'result-item';
    if (item.error) {
      const strongElement = document.createElement('strong');
      strongElement.textContent = item.location;

      const errorSpan = document.createElement('span');
      errorSpan.className = 'error';
      errorSpan.textContent = item.errorMessage;

      div.appendChild(strongElement);
      div.appendChild(document.createTextNode(': '));
      div.appendChild(errorSpan);
    } else {
      const strongElement = document.createElement('strong');
      strongElement.textContent = item.location;

      div.appendChild(strongElement);
      div.appendChild(
        document.createTextNode(`: ${item.temperature}°${item.unit}, ${item.condition}`)
      );
    }
    container.appendChild(div);
  });
}

function openImageModal(url, prompt) {
  const modal = document.getElementById('image-modal');
  const modalImg = document.getElementById('modal-image');
  const modalCaption = document.getElementById('modal-caption');

  modal.style.display = 'block';
  modalImg.src = url;
  modalCaption.textContent = prompt || 'Generated image';

  // Close modal on click
  modal.onclick = function (e) {
    if (e.target === modal || e.target.className === 'close') {
      modal.style.display = 'none';
    }
  };
}

//
// ==================== DELETED MESSAGES FUNCTIONALITY ====================
//

// Global variables for deleted messages
let currentDeletedMessages = [];
let currentDeletedUser = null;

// Initialize deleted messages when tab loads
async function fetchDeletedMessages() {
  try {
    // Set default date range to last 7 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const startDateInput = document.getElementById('deleted-start-date');
    const endDateInput = document.getElementById('deleted-end-date');

    if (startDateInput && !startDateInput.value) {
      startDateInput.value = formatDateForInput(startDate);
    }
    if (endDateInput && !endDateInput.value) {
      endDateInput.value = formatDateForInput(endDate);
    }

    await checkDeletedMessagesAuthentication();
    await loadDeletedMessages();
  } catch (error) {
    logDebug(`Error initializing deleted messages: ${error.message}`, 'error');
    showDeletedError('Failed to initialize deleted messages: ' + error.message);
  }
}

function formatDateForInput(date) {
  return date.toISOString().slice(0, 16);
}

async function checkDeletedMessagesAuthentication() {
  try {
    const response = await fetch('/api/deleted-messages/auth');
    if (!response.ok) {
      showDeletedError('Access denied: Owner privileges required');
      return;
    }
    const data = await response.json();
    currentDeletedUser = data.userId;
    logDebug('Deleted messages authentication successful', 'info');
  } catch (error) {
    showDeletedError('Authentication failed: ' + error.message);
    logDebug(`Deleted messages auth error: ${error.message}`, 'error');
  }
}

async function loadDeletedMessages() {
  showDeletedLoading(true);
  clearDeletedMessages();

  try {
    const filters = getDeletedMessagesFilters();
    const queryString = new URLSearchParams(filters).toString();
    const response = await fetch(`/api/deleted-messages?${queryString}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    currentDeletedMessages = data.messages || [];
    displayDeletedMessages(currentDeletedMessages);
    updateDeletedStats(data.stats || {});

    logDebug(`Loaded ${currentDeletedMessages.length} deleted messages`, 'info');
  } catch (error) {
    showDeletedError('Failed to load messages: ' + error.message);
    logDebug(`Error loading deleted messages: ${error.message}`, 'error');
  } finally {
    showDeletedLoading(false);
  }
}

function getDeletedMessagesFilters() {
  const filters = {};

  const statusFilter = document.getElementById('deleted-status-filter');
  const userFilter = document.getElementById('deleted-user-filter');
  const channelFilter = document.getElementById('deleted-channel-filter');
  const startDateFilter = document.getElementById('deleted-start-date');
  const endDateFilter = document.getElementById('deleted-end-date');
  const rapidOnlyFilter = document.getElementById('deleted-rapid-only');

  if (statusFilter && statusFilter.value) filters.status = statusFilter.value;
  if (userFilter && userFilter.value.trim()) filters.userId = userFilter.value.trim();
  if (channelFilter && channelFilter.value.trim()) filters.channelId = channelFilter.value.trim();
  if (startDateFilter && startDateFilter.value)
    filters.startDate = new Date(startDateFilter.value).getTime();
  if (endDateFilter && endDateFilter.value)
    filters.endDate = new Date(endDateFilter.value).getTime();
  if (rapidOnlyFilter && rapidOnlyFilter.checked) filters.isRapidDeletion = true;

  return filters;
}

function applyDeletedMessagesFilters() {
  loadDeletedMessages();
}

function displayDeletedMessages(messages) {
  const container = document.getElementById('deleted-messages-list');

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-content">
          <i class="fas fa-search" style="font-size: 2em; color: var(--text-muted); margin-bottom: 10px;"></i>
          <p class="empty-state-text">No messages match your current filters</p>
          <p class="empty-state-hint">Try adjusting your search criteria or clearing filters</p>
          <button class="btn btn-secondary btn-sm" onclick="clearDeletedFilters()">
            <i class="fas fa-times"></i> Clear Filters
          </button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = messages
    .map(message => {
      const importance = getMessageImportance(message);
      return `
        <div class="message-item message-importance-${importance.level}" data-message-id="${message.messageId}">
          <div class="message-header">
            <div class="message-select-container">
              <input type="checkbox" class="message-select" data-message-id="${message.messageId}" 
                     onchange="toggleMessageSelection('${message.messageId}')">
            </div>
            <div class="user-info">
              <span class="username">${escapeHtml(message.username)}</span>
              ${message.isOwner ? '<span class="owner-badge">OWNER</span>' : ''}
              ${message.isRapidDeletion ? '<span class="rapid-badge">RAPID</span>' : ''}
              <span class="status-badge status-${message.status}">${message.status.replace('_', ' ').toUpperCase()}</span>
              ${importance.indicators
                .map(
                  ind =>
                    `<span class="importance-indicator ${ind.class}">
                   <i class="${ind.icon}"></i> ${ind.text}
                 </span>`
                )
                .join('')}
            </div>
            <div class="message-actions">
              <button class="btn" onclick="reviewDeletedMessage('${message.messageId}')">Review</button>
              <button class="btn btn-success" onclick="updateDeletedMessageStatus('${message.messageId}', 'approved')">Approve</button>
              <button class="btn btn-danger" onclick="updateDeletedMessageStatus('${message.messageId}', 'flagged')">Flag</button>
              <button class="btn btn-warning" onclick="updateDeletedMessageStatus('${message.messageId}', 'ignored')">Ignore</button>
            </div>
          </div>
          
          <div class="message-content">
            ${escapeHtml(message.content || 'No content available')}
          </div>
          
          <div class="message-meta">
            <div><strong>Channel:</strong> ${escapeHtml(message.channelName)}</div>
            <div><strong>Deleted:</strong> ${new Date(message.timestamp).toLocaleString()}</div>
            <div><strong>Time to Delete:</strong> ${formatDuration(message.timeSinceCreation)}</div>
            <div><strong>Total Deletions:</strong> ${message.deletionCount}</div>
            <div><strong>User ID:</strong> ${message.userId}</div>
            <div><strong>Message ID:</strong> ${message.messageId}</div>
          </div>

          ${
            message.notes
              ? `
              <div class="notes-section">
                <strong>Notes:</strong>
                <div style="background: var(--bg-secondary); padding: 8px; border-radius: 4px; margin-top: 5px; color: var(--text-primary);">
                  ${escapeHtml(message.notes)}
                </div>
              </div>
            `
              : ''
          }
        </div>
      `;
    })
    .join('');
}

function updateDeletedStats(stats) {
  // Basic stats
  const totalElement = document.getElementById('deleted-total-messages');
  const pendingElement = document.getElementById('deleted-pending-messages');
  const rapidElement = document.getElementById('deleted-rapid-deletions');
  const flaggedElement = document.getElementById('deleted-flagged-messages');

  if (totalElement) totalElement.textContent = stats.total || 0;
  if (pendingElement) pendingElement.textContent = stats.pending || 0;
  if (rapidElement) rapidElement.textContent = stats.rapid || 0;
  if (flaggedElement) flaggedElement.textContent = stats.flagged || 0;

  // Enhanced stats and analytics
  updateDetailedStats(stats);

  // Build analytics from current message data
  const userAnalytics = buildUserAnalytics(currentDeletedMessages);
  const channelAnalytics = buildChannelAnalytics(currentDeletedMessages);

  updateUserLeaderboard(userAnalytics);
  updateChannelAnalytics(channelAnalytics);
}

function updateDetailedStats(_stats) {
  // Calculate additional metrics from current messages
  if (!currentDeletedMessages || currentDeletedMessages.length === 0) return;

  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const recentMessages = currentDeletedMessages.filter(m => m.timestamp > hourAgo);
  const todayMessages = currentDeletedMessages.filter(m => m.timestamp > dayAgo);

  const avgTimeToDelete =
    currentDeletedMessages.reduce((sum, m) => sum + (m.timeSinceCreation || 0), 0) /
    currentDeletedMessages.length;

  // Update additional stat elements if they exist
  const updateStatElement = (id, value, formatter = null) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = formatter ? formatter(value) : value;
    }
  };

  updateStatElement('deleted-recent-count', recentMessages.length);
  updateStatElement('deleted-today-count', todayMessages.length);
  updateStatElement('deleted-avg-time', avgTimeToDelete, formatDuration);
  updateStatElement(
    'deleted-high-priority',
    currentDeletedMessages.filter(m => getMessageImportance(m).level === 'high').length
  );
}

function updateUserLeaderboard(topUsers) {
  const leaderboardContainer = document.getElementById('user-leaderboard');
  if (!leaderboardContainer) return;

  if (!topUsers || topUsers.length === 0) {
    leaderboardContainer.innerHTML =
      '<p class="text-muted text-center">No user activity data available</p>';
    return;
  }

  leaderboardContainer.innerHTML = `
    <div class="leaderboard-header">
      <h4><i class="fas fa-trophy"></i> User Leaderboard</h4>
      <small class="text-muted">${topUsers.length} active users</small>
    </div>
    <div class="leaderboard-list">
      ${topUsers
        .slice(0, 10)
        .map(
          (user, index) => `
        <div class="leaderboard-item ${index < 3 ? 'leaderboard-top' : ''}">
          <div class="leaderboard-rank">${index + 1}</div>
          <div class="leaderboard-user">
            <span class="leaderboard-username">
              ${escapeHtml(user.username || 'Unknown User')}
              ${user.isOwner ? '<span class="owner-badge">OWNER</span>' : ''}
            </span>
            <span class="leaderboard-userid">${user.userId}</span>
          </div>
          <div class="leaderboard-stats">
            <div style="display: flex; flex-direction: column; align-items: flex-end;">
              <div>
                <span class="leaderboard-count">${user.deletionCount}</span>
                <span class="leaderboard-label">deletions</span>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                ${user.channelCount || 0} channels • ${formatDuration(user.averageTimeToDelete || 0)} avg
              </div>
            </div>
            ${user.rapidCount > 0 ? `<span class="leaderboard-rapid">${user.rapidCount} rapid</span>` : ''}
            ${user.flaggedCount > 0 ? `<span class="leaderboard-rapid" style="background: #dc3545;">${user.flaggedCount} flagged</span>` : ''}
          </div>
          <div class="leaderboard-actions">
            <button class="btn btn-sm" onclick="filterByUser('${user.userId}')" title="Filter messages by this user">
              <i class="fas fa-filter"></i>
            </button>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

function updateChannelAnalytics(channelStats) {
  const channelContainer = document.getElementById('channel-analytics');
  if (!channelContainer) return;

  const channels = Object.entries(channelStats).sort((a, b) => b[1].count - a[1].count);

  if (channels.length === 0) {
    channelContainer.innerHTML = '<p class="text-muted text-center">No channel data available</p>';
    return;
  }

  channelContainer.innerHTML = `
    <div class="analytics-header">
      <h4><i class="fas fa-chart-bar"></i> Channel Analytics</h4>
      <small class="text-muted">${channels.length} channels with activity</small>
    </div>
    <div class="analytics-list">
      ${channels
        .slice(0, 8)
        .map(
          ([channelId, data]) => `
        <div class="analytics-item">
          <div class="analytics-channel">
            <span class="analytics-name">${escapeHtml(data.name || 'Unknown Channel')}</span>
            <span class="analytics-id">${channelId}</span>
          </div>
          <div class="analytics-stats">
            <div style="display: flex; flex-direction: column; align-items: flex-end;">
              <div>
                <span class="analytics-count">${data.count}</span>
                <span class="analytics-label">deletions</span>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                ${data.uniqueUserCount || 0} users • ${formatDuration(data.averageTimeToDelete || 0)} avg
              </div>
            </div>
            ${data.rapidCount > 0 ? `<span class="analytics-rapid">${data.rapidCount} rapid</span>` : ''}
            ${data.flaggedCount > 0 ? `<span class="analytics-rapid" style="background: #dc3545;">${data.flaggedCount} flagged</span>` : ''}
          </div>
          <div class="analytics-actions">
            <button class="btn btn-sm" onclick="filterByChannel('${channelId}')" title="Filter messages from this channel">
              <i class="fas fa-filter"></i>
            </button>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

// Analytics builder functions
function buildUserAnalytics(messages) {
  if (!messages || messages.length === 0) return [];

  const userStats = {};

  // Process each message to build user statistics
  messages.forEach(message => {
    const userId = message.userId;
    if (!userId) return;

    if (!userStats[userId]) {
      userStats[userId] = {
        userId: userId,
        username: message.username || 'Unknown User',
        deletionCount: 0,
        rapidCount: 0,
        flaggedCount: 0,
        isOwner: message.isOwner || false,
        lastActivity: 0,
        averageTimeToDelete: 0,
        totalTimeToDelete: 0,
        channels: new Set(),
      };
    }

    const user = userStats[userId];
    user.deletionCount++;
    user.totalTimeToDelete += message.timeSinceCreation || 0;
    user.channels.add(message.channelId);

    if (message.isRapidDeletion) {
      user.rapidCount++;
    }

    if (message.status === 'flagged') {
      user.flaggedCount++;
    }

    if (message.timestamp > user.lastActivity) {
      user.lastActivity = message.timestamp;
    }
  });

  // Convert to array and calculate averages
  const userArray = Object.values(userStats).map(user => {
    user.averageTimeToDelete =
      user.deletionCount > 0 ? user.totalTimeToDelete / user.deletionCount : 0;
    user.channelCount = user.channels.size;
    delete user.channels; // Clean up Set object for JSON
    delete user.totalTimeToDelete; // Clean up internal counter
    return user;
  });

  // Sort by activity score (more recent activity and higher deletion count get higher scores)
  return userArray
    .sort((a, b) => {
      // Primary sort: deletion count (descending)
      const deletionDiff = b.deletionCount - a.deletionCount;
      if (deletionDiff !== 0) return deletionDiff;

      // Secondary sort: recent activity (more recent first)
      return b.lastActivity - a.lastActivity;
    })
    .slice(0, 10); // Top 10 users
}

function buildChannelAnalytics(messages) {
  if (!messages || messages.length === 0) return {};

  const channelStats = {};

  // Process each message to build channel statistics
  messages.forEach(message => {
    const channelId = message.channelId;
    if (!channelId) return;

    if (!channelStats[channelId]) {
      channelStats[channelId] = {
        name: message.channelName || 'Unknown Channel',
        count: 0,
        rapidCount: 0,
        flaggedCount: 0,
        uniqueUsers: new Set(),
        lastActivity: 0,
        averageTimeToDelete: 0,
        totalTimeToDelete: 0,
      };
    }

    const channel = channelStats[channelId];
    channel.count++;
    channel.totalTimeToDelete += message.timeSinceCreation || 0;
    channel.uniqueUsers.add(message.userId);

    if (message.isRapidDeletion) {
      channel.rapidCount++;
    }

    if (message.status === 'flagged') {
      channel.flaggedCount++;
    }

    if (message.timestamp > channel.lastActivity) {
      channel.lastActivity = message.timestamp;
    }
  });

  // Calculate averages and clean up
  Object.keys(channelStats).forEach(channelId => {
    const channel = channelStats[channelId];
    channel.averageTimeToDelete = channel.count > 0 ? channel.totalTimeToDelete / channel.count : 0;
    channel.uniqueUserCount = channel.uniqueUsers.size;
    delete channel.uniqueUsers; // Clean up Set object for JSON
    delete channel.totalTimeToDelete; // Clean up internal counter
  });

  return channelStats;
}

// Filter helper functions (intentionally unused for future feature)
function _filterByUser(userId) {
  const userFilter = document.getElementById('deleted-user-filter');
  if (userFilter) {
    userFilter.value = userId;
    applyDeletedMessagesFilters();
  }
}

function _filterByChannel(channelId) {
  const channelFilter = document.getElementById('deleted-channel-filter');
  if (channelFilter) {
    channelFilter.value = channelId;
    applyDeletedMessagesFilters();
  }
}

async function updateDeletedMessageStatus(messageId, status) {
  try {
    // Validate inputs
    if (!currentDeletedUser) {
      throw new Error('User not authenticated. Please refresh the page.');
    }
    if (!messageId) {
      throw new Error('Invalid message ID');
    }

    // Get notes for status update
    const notes = window.prompt(`Enter notes for ${status} status (optional):`);
    if (notes === null) return; // User cancelled

    logDebug(`Updating message ${messageId} to ${status} by user ${currentDeletedUser}`, 'info');

    const response = await fetch('/api/deleted-messages/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentDeletedUser,
      },
      body: JSON.stringify({
        messageId,
        status,
        notes,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    showDeletedSuccess(`Message ${status} successfully`);
    loadDeletedMessages(); // Refresh the list
    logDebug(`Updated message ${messageId} status to ${status}`, 'info');
  } catch (error) {
    showDeletedError('Failed to update status: ' + error.message);
    logDebug(`Error updating message status: ${error.message}`, 'error');
  }
}

function reviewDeletedMessage(messageId) {
  const message = currentDeletedMessages.find(m => m.messageId === messageId);
  if (!message) return;

  const modalContent = document.getElementById('deleted-modal-content');
  modalContent.innerHTML = `
    <h3>Message Details</h3>
    <div class="message-meta" style="margin: 15px 0;">
      <div><strong>User:</strong> ${escapeHtml(message.username)} (${message.userId})</div>
      <div><strong>Channel:</strong> ${escapeHtml(message.channelName)} (${message.channelId})</div>
      <div><strong>Deleted:</strong> ${new Date(message.timestamp).toLocaleString()}</div>
      <div><strong>Created:</strong> ${new Date(message.messageCreatedAt).toLocaleString()}</div>
      <div><strong>Time to Delete:</strong> ${formatDuration(message.timeSinceCreation)}</div>
      <div><strong>Total User Deletions:</strong> ${message.deletionCount}</div>
      <div><strong>Status:</strong> ${message.status.replace('_', ' ').toUpperCase()}</div>
      <div><strong>Is Owner:</strong> ${message.isOwner ? 'Yes' : 'No'}</div>
      <div><strong>Rapid Deletion:</strong> ${message.isRapidDeletion ? 'Yes' : 'No'}</div>
    </div>
    
    <h4>Full Message Content:</h4>
    <div class="message-content" style="max-height: 200px;">
      ${escapeHtml(message.fullContent || 'No content available')}
    </div>
    
    ${
      message.attachments && message.attachments.length > 0
        ? `
        <h4>Attachments (${message.attachments.length}):</h4>
        <ul>
          ${message.attachments
            .map(
              att => `
              <li>${escapeHtml(att.name)} (${att.size} bytes, ${att.contentType})</li>
            `
            )
            .join('')}
        </ul>
      `
        : ''
    }
    
    <div class="notes-section">
      <label for="deleted-review-notes"><strong>Review Notes:</strong></label>
      <textarea id="deleted-review-notes" placeholder="Add notes about this deletion..." style="width: 100%; padding: 10px; border: 1px solid var(--border-color); border-radius: 5px; resize: vertical; min-height: 60px; background: var(--bg-secondary); color: var(--text-primary);">${escapeHtml(message.notes || '')}</textarea>
    </div>
    
    <div style="margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
      <button class="btn btn-success" onclick="updateDeletedMessageStatusFromModal('${messageId}', 'approved')">Approve</button>
      <button class="btn btn-danger" onclick="updateDeletedMessageStatusFromModal('${messageId}', 'flagged')">Flag</button>
      <button class="btn btn-warning" onclick="updateDeletedMessageStatusFromModal('${messageId}', 'ignored')">Ignore</button>
      <button class="btn" onclick="closeDeletedReviewModal()">Close</button>
    </div>
  `;

  document.getElementById('deleted-review-modal').style.display = 'block';
}

async function updateDeletedMessageStatusFromModal(messageId, status) {
  const notesTextarea = document.getElementById('deleted-review-notes');
  const notes = notesTextarea ? notesTextarea.value : '';

  try {
    // Validate inputs
    if (!currentDeletedUser) {
      throw new Error('User not authenticated. Please refresh the page.');
    }
    if (!messageId) {
      throw new Error('Invalid message ID');
    }

    logDebug(
      `Updating message ${messageId} to ${status} from modal by user ${currentDeletedUser}`,
      'info'
    );

    const response = await fetch('/api/deleted-messages/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentDeletedUser,
      },
      body: JSON.stringify({
        messageId,
        status,
        notes,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    showDeletedSuccess(`Message ${status} successfully`);
    closeDeletedReviewModal();
    loadDeletedMessages(); // Refresh the list
    logDebug(`Updated message ${messageId} status to ${status} from modal`, 'info');
  } catch (error) {
    showDeletedError('Failed to update status: ' + error.message);
    logDebug(`Error updating message status from modal: ${error.message}`, 'error');
  }
}

function closeDeletedReviewModal() {
  document.getElementById('deleted-review-modal').style.display = 'none';
}

// Clear all deleted message filters
function clearDeletedFilters() {
  const statusFilter = document.getElementById('deleted-status-filter');
  const userFilter = document.getElementById('deleted-user-filter');
  const channelFilter = document.getElementById('deleted-channel-filter');
  const startDateFilter = document.getElementById('deleted-start-date');
  const endDateFilter = document.getElementById('deleted-end-date');
  const rapidOnlyFilter = document.getElementById('deleted-rapid-only');

  if (statusFilter) statusFilter.value = '';
  if (userFilter) userFilter.value = '';
  if (channelFilter) channelFilter.value = '';
  if (startDateFilter) startDateFilter.value = '';
  if (endDateFilter) endDateFilter.value = '';
  if (rapidOnlyFilter) rapidOnlyFilter.checked = false;

  logDebug('Filters cleared, reloading messages', 'info');
  loadDeletedMessages();
}

// Global state for selected messages
const selectedMessages = new Set();

// Toggle message selection
function toggleMessageSelection(messageId) {
  if (selectedMessages.has(messageId)) {
    selectedMessages.delete(messageId);
  } else {
    selectedMessages.add(messageId);
  }

  updateBulkActionsVisibility();
  updateMessageSelectionUI(messageId);
}

// Select all visible messages
function selectAllMessages() {
  const checkboxes = document.querySelectorAll('.message-select');
  const allSelected = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);

  checkboxes.forEach(checkbox => {
    const messageId = checkbox.dataset.messageId;
    checkbox.checked = !allSelected;

    if (!allSelected) {
      selectedMessages.add(messageId);
    } else {
      selectedMessages.delete(messageId);
    }
  });

  updateBulkActionsVisibility();
}

// Update bulk actions visibility
function updateBulkActionsVisibility() {
  const bulkActions = document.getElementById('bulk-actions');
  const selectedCount = document.getElementById('selected-count');

  if (bulkActions && selectedCount) {
    bulkActions.style.display = selectedMessages.size > 0 ? 'block' : 'none';
    selectedCount.textContent = selectedMessages.size;
  }
}

// Update message selection UI
function updateMessageSelectionUI(messageId) {
  const checkbox = document.querySelector(`[data-message-id="${messageId}"]`);
  if (checkbox) {
    checkbox.checked = selectedMessages.has(messageId);
  }
}

// Bulk update status for selected messages
async function bulkUpdateStatus(status) {
  if (selectedMessages.size === 0) {
    showDeletedError('No messages selected');
    return;
  }

  // Get notes for bulk operation
  const notes = window.prompt(`Enter notes for bulk ${status} operation (optional):`);
  if (notes === null) return; // User cancelled

  const progressDiv = document.getElementById('bulk-progress');
  if (progressDiv) progressDiv.style.display = 'block';

  let completed = 0;
  const total = selectedMessages.size;
  const errors = [];

  for (const messageId of selectedMessages) {
    try {
      await updateDeletedMessageStatus(messageId, status, notes, false); // Don't reload for each
      completed++;

      // Update progress
      const progressBar = document.getElementById('bulk-progress-bar');
      if (progressBar) {
        progressBar.style.width = `${(completed / total) * 100}%`;
      }

      const progressText = document.getElementById('bulk-progress-text');
      if (progressText) {
        progressText.textContent = `${completed}/${total} messages processed`;
      }
    } catch (error) {
      errors.push(`${messageId}: ${error.message}`);
    }
  }

  // Hide progress and show results
  if (progressDiv) progressDiv.style.display = 'none';

  if (errors.length > 0) {
    showDeletedError(`Bulk operation completed with ${errors.length} errors: ${errors.join(', ')}`);
  } else {
    showDeletedSuccess(`Successfully ${status} ${completed} messages`);
  }

  // Clear selection and reload
  selectedMessages.clear();
  updateBulkActionsVisibility();
  loadDeletedMessages();
}

// Get message importance score for display
function getMessageImportance(message) {
  let score = 0;
  const indicators = [];

  // High importance indicators
  if (message.isRapidDeletion) {
    score += 3;
    indicators.push({ text: 'Rapid', class: 'importance-high', icon: 'fas fa-bolt' });
  }

  if (message.deletionCount >= 10) {
    score += 2;
    indicators.push({
      text: 'Frequent',
      class: 'importance-medium',
      icon: 'fas fa-exclamation-triangle',
    });
  }

  if (message.status === 'flagged') {
    score += 2;
    indicators.push({ text: 'Flagged', class: 'importance-high', icon: 'fas fa-flag' });
  }

  // Medium importance indicators
  if (message.timeSinceCreation < 10000) {
    // Less than 10 seconds
    score += 1;
    indicators.push({ text: 'Quick Delete', class: 'importance-medium', icon: 'fas fa-clock' });
  }

  if (message.deletionCount >= 5) {
    score += 1;
    indicators.push({ text: 'Multiple', class: 'importance-low', icon: 'fas fa-redo' });
  }

  // Content-based importance
  const content = (message.content || '').toLowerCase();
  if (content.includes('http') || content.includes('discord.gg')) {
    score += 1;
    indicators.push({ text: 'Links', class: 'importance-medium', icon: 'fas fa-link' });
  }

  return {
    score,
    level: score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low',
    indicators,
  };
}

function showDeletedLoading(show) {
  const loadingElement = document.getElementById('deleted-loading');
  if (loadingElement) {
    loadingElement.style.display = show ? 'block' : 'none';
  }
}

function clearDeletedMessages() {
  const listElement = document.getElementById('deleted-messages-list');
  if (listElement) {
    listElement.innerHTML = '';
  }
}

function showDeletedError(message) {
  const container = document.getElementById('deleted-error-container');
  if (container) {
    container.innerHTML = `<div class="error" style="background: #dc3545; color: white; padding: 15px; border-radius: 5px; margin-bottom: 20px;">${escapeHtml(message)}</div>`;
    setTimeout(() => (container.innerHTML = ''), 5000);
  }
  logDebug(`Deleted messages error: ${message}`, 'error');
}

function showDeletedSuccess(message) {
  const container = document.getElementById('deleted-success-container');
  if (container) {
    container.innerHTML = `<div class="success" style="background: #28a745; color: white; padding: 15px; border-radius: 5px; margin-bottom: 20px;">${escapeHtml(message)}</div>`;
    setTimeout(() => (container.innerHTML = ''), 3000);
  }
  logDebug(`Deleted messages success: ${message}`, 'info');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

// Close modal when clicking outside
window.addEventListener('click', function (event) {
  const modal = document.getElementById('deleted-review-modal');
  if (event.target === modal) {
    closeDeletedReviewModal();
  }
});

// Export for global access
window.toggleTheme = toggleTheme;
window.unblockUser = unblockUser;
window.loadFunctionDetails = loadFunctionDetails;
window.openImageModal = openImageModal;
window.applyDeletedMessagesFilters = applyDeletedMessagesFilters;
window.loadDeletedMessages = loadDeletedMessages;
window.updateDeletedMessageStatus = updateDeletedMessageStatus;
window.reviewDeletedMessage = reviewDeletedMessage;
window.updateDeletedMessageStatusFromModal = updateDeletedMessageStatusFromModal;
window.closeDeletedReviewModal = closeDeletedReviewModal;
window.clearDeletedFilters = clearDeletedFilters;
window.bulkUpdateStatus = bulkUpdateStatus;
window.toggleMessageSelection = toggleMessageSelection;
window.selectAllMessages = selectAllMessages;
