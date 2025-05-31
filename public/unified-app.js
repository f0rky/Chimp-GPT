// Unified Dashboard JavaScript
// Combines functionality from status page, performance dashboard, and settings

// Global state
const state = {
  currentTab: 'status',
  theme: localStorage.getItem('theme') || 'dark',
  debugCollapsed: localStorage.getItem('debugCollapsed') === 'true',
  updateIntervals: {
    status: 10000,    // 10 seconds
    performance: 5000, // 5 seconds
    functions: 15000   // 15 seconds
  },
  charts: {},
  timers: {},
  performanceData: {
    labels: [],
    responseTime: [],
    cpuUsage: [],
    memoryUsage: []
  }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initializeTheme();
  initializeTabs();
  initializeDebugConsole();
  initializeCharts();
  startDataFetching();
  setupEventListeners();
  updateClock();
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
  switch(tab) {
    case 'status':
      fetchHealthData();
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
  
  debugInput.addEventListener('keypress', (e) => {
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
  const [cmd, ...args] = command.toLowerCase().split(' ');
  
  switch(cmd) {
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
  // Status page metrics chart
  const metricsCtx = document.getElementById('metrics-chart')?.getContext('2d');
  if (metricsCtx) {
    state.charts.metrics = new Chart(metricsCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Response Time (ms)',
          data: [],
          borderColor: '#7289da',
          backgroundColor: 'rgba(114, 137, 218, 0.1)',
          tension: 0.4
        }, {
          label: 'CPU Usage (%)',
          data: [],
          borderColor: '#43b581',
          backgroundColor: 'rgba(67, 181, 129, 0.1)',
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'bottom'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    });
  }

  // Performance dashboard latency chart
  const latencyCtx = document.getElementById('latencyChart')?.getContext('2d');
  if (latencyCtx) {
    state.charts.latency = new Chart(latencyCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'OpenAI',
          data: [],
          borderColor: '#7289da',
          tension: 0.4
        }, {
          label: 'Weather',
          data: [],
          borderColor: '#43b581',
          tension: 0.4
        }, {
          label: 'Other',
          data: [],
          borderColor: '#faa61a',
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    });
  }
}

// Data Fetching
function startDataFetching() {
  // Initial fetch
  fetchHealthData();
  
  // Set up intervals
  state.timers.status = setInterval(() => {
    if (state.currentTab === 'status') {
      fetchHealthData();
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
    
    updateStatusDisplay(data);
    updateConversationMode(data.conversationMode);
    logDebug('Health data updated', 'info');
  } catch (error) {
    logDebug(`Error fetching health data: ${error.message}`, 'error');
  }
}

async function fetchPerformanceData() {
  try {
    const response = await fetch('/performance');
    const data = await response.json();
    
    updatePerformanceDisplay(data);
    updateCharts(data);
    logDebug('Performance data updated', 'info');
  } catch (error) {
    logDebug(`Error fetching performance data: ${error.message}`, 'error');
  }
}

async function fetchFunctionResults() {
  try {
    const response = await fetch('/function-results/summary');
    const data = await response.json();
    
    updateFunctionSummary(data);
    logDebug('Function results updated', 'info');
  } catch (error) {
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
  // Update header
  document.getElementById('bot-name-header').textContent = data.name || 'Bot Status';
  document.title = `${data.name || 'Bot'} Status`;
  
  // Update status indicator
  const statusDot = document.querySelector('.dot');
  const statusText = document.querySelector('.status-text');
  
  statusDot.className = `dot ${data.status === 'ok' ? 'online' : 'offline'}`;
  statusText.textContent = data.status === 'ok' ? 'Online' : 'Offline';
  
  // Update stats
  document.getElementById('uptime').textContent = data.formattedUptime || '--:--:--';
  document.getElementById('version').textContent = data.version || '-.-.-';
  document.getElementById('message-count').textContent = data.stats?.messageCount || '0';
  document.getElementById('discord-ping').textContent = `${data.discord?.ping || '--'} ms`;
  
  // Update system stats (mock CPU for frontend)
  const cpuUsage = Math.round(Math.random() * 20 + 10); // Mock CPU usage for now
  document.getElementById('cpu-usage').textContent = `${cpuUsage}%`;
  document.getElementById('memory-usage').textContent = data.memory?.rss || '-- MB';
  
  // Calculate total API calls
  const totalApiCalls = Object.values(data.stats?.apiCalls || {}).reduce((sum, count) => sum + count, 0);
  document.getElementById('total-api-calls').textContent = totalApiCalls;
  
  // Update API stats
  updateApiStats(data.stats?.apiCalls);
  
  // Update rate limits
  updateRateLimits(data.stats?.rateLimits);
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
  container.innerHTML = '';
  
  for (const [api, count] of Object.entries(apiCalls || {})) {
    const item = document.createElement('div');
    item.className = 'api-stat-item';
    item.innerHTML = `
      <span class="name">${api.charAt(0).toUpperCase() + api.slice(1)}</span>
      <span class="count">${count}</span>
    `;
    container.appendChild(item);
  }
}

function updateRateLimits(rateLimits) {
  const container = document.getElementById('rate-limits');
  container.innerHTML = `
    <div class="stat-grid">
      <div class="stat">
        <span class="label">Total Hits</span>
        <span class="value">${rateLimits?.count || 0}</span>
      </div>
      <div class="stat">
        <span class="label">Unique Users</span>
        <span class="value">${rateLimits?.uniqueUsers || 0}</span>
      </div>
    </div>
  `;
}

function updatePerformanceDisplay(data) {
  if (!data.summary) return;
  
  // Update response time
  const avgResponseTime = Math.round(data.summary.messageProcessing?.avg || 0);
  document.getElementById('response-time').textContent = `${avgResponseTime} ms`;
  document.getElementById('avg-response-time').textContent = `${avgResponseTime} ms`;
  
  // Update min/max
  const min = Math.round(data.summary.messageProcessing?.min || 0);
  const max = Math.round(data.summary.messageProcessing?.max || 0);
  document.getElementById('minmax-response-time').textContent = `${min} / ${max} ms`;
  
  // Update API status
  updateApiStatus(data);
  
  // Update memory gauge
  updateMemoryGauge(data.serverHealth?.memory);
}

function updateApiStatus(data) {
  // This would check circuit breaker states or recent errors
  // For now, just show as operational
  document.getElementById('openaiStatus').textContent = 'Operational';
  document.getElementById('weatherStatus').textContent = 'Operational';
  document.getElementById('quakeStatus').textContent = 'Operational';
}

function updateMemoryGauge(memory) {
  if (!memory) return;
  
  const rss = parseInt(memory.rss);
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

function updateCharts(data) {
  if (!state.charts.metrics) return;
  
  // Add new data point
  const now = new Date().toLocaleTimeString();
  state.performanceData.labels.push(now);
  state.performanceData.responseTime.push(data.summary?.messageProcessing?.avg || 0);
  
  // Calculate CPU usage (mock for now)
  const cpuUsage = Math.random() * 20 + 10;
  state.performanceData.cpuUsage.push(cpuUsage);
  
  // Keep only last 20 points
  if (state.performanceData.labels.length > 20) {
    state.performanceData.labels.shift();
    state.performanceData.responseTime.shift();
    state.performanceData.cpuUsage.shift();
  }
  
  // Update chart
  state.charts.metrics.data.labels = state.performanceData.labels;
  state.charts.metrics.data.datasets[0].data = state.performanceData.responseTime;
  state.charts.metrics.data.datasets[1].data = state.performanceData.cpuUsage;
  state.charts.metrics.update('none');
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
    const results = await response.json();
    logDebug('Tests completed successfully', 'info');
    console.log('Test results:', results);
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
        'X-Owner-Token': token
      },
      body: JSON.stringify({ userId })
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

function filterSettings(filter) {
  const items = document.querySelectorAll('.setting-item');
  
  items.forEach(item => {
    let show = true;
    
    switch(filter) {
      case 'required':
        show = item.dataset.required === 'true';
        break;
      case 'optional':
        show = item.dataset.required === 'false';
        break;
      case 'issues':
        show = item.dataset.set === 'false' && item.dataset.required === 'true';
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
    console.log(`Details for ${func}:`, data[func]);
    logDebug(`Loaded details for ${func}`, 'info');
  } catch (error) {
    logDebug(`Error loading function details: ${error.message}`, 'error');
  }
}

// Export for global access
window.toggleTheme = toggleTheme;
window.unblockUser = unblockUser;
window.loadFunctionDetails = loadFunctionDetails;