/**
 * ChimpGPT Status Page
 *
 * This script handles fetching and displaying real-time status information
 * for the ChimpGPT Discord bot, including:
 * - Bot status and uptime
 * - API call statistics
 * - Error tracking
 * - Memory usage
 * - Test results
 */

// Charts for visualizing data
let apiChart = null;
let errorChart = null;
const metricsChart = null;
const historyChart = null;

// Update interval in milliseconds (optimized for bandwidth efficiency)
const UPDATE_INTERVAL = 10000; // 10 seconds (was 5s)

function closeImageModal() {
  const modal = document.getElementById('gallery-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = 'auto';
  }
}

// Toggle collapsible sections
function toggleCollapsible(sectionId) {
  const content = document.getElementById(sectionId + '-content');
  const toggle = document.getElementById(sectionId + '-toggle');

  if (content && toggle) {
    content.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed');
  }
}

// Make function globally available
window.toggleCollapsible = toggleCollapsible;

// Initialize metrics chart
function initMetricsChart() {
  try {
    const ctx = document.getElementById('metrics-chart');
    if (!ctx) {
      console.warn('Metrics chart canvas not found');
      return;
    }

    // Destroy existing chart instance if it exists
    if (window.metricsChart) {
      try {
        window.metricsChart.destroy();
      } catch (e) {
        console.warn('Error destroying existing chart:', e);
      }
      window.metricsChart = null;
    }

    // Clear the canvas
    const context = ctx.getContext('2d');
    context.clearRect(0, 0, ctx.width, ctx.height);

    window.metricsChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Response Time (ms)',
            data: [],
            borderColor: 'rgba(75, 192, 192, 1)',
            backgroundColor: 'rgba(75, 192, 192, 0.2)',
            tension: 0.4,
            yAxisID: 'y',
            fill: true,
          },
          {
            label: 'CPU Usage (%)',
            data: [],
            borderColor: 'rgba(255, 99, 132, 1)',
            backgroundColor: 'rgba(255, 99, 132, 0.2)',
            tension: 0.4,
            yAxisID: 'y1',
            fill: true,
          },
          {
            label: 'Memory Usage (MB)',
            data: [],
            borderColor: 'rgba(54, 162, 235, 1)',
            backgroundColor: 'rgba(54, 162, 235, 0.2)',
            tension: 0.4,
            yAxisID: 'y2',
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: 'Time',
              color: 'rgba(255, 255, 255, 0.7)',
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.7)',
            },
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: {
              display: true,
              text: 'Response Time (ms)',
              color: 'rgba(75, 192, 192, 1)',
            },
            grid: {
              color: 'rgba(75, 192, 192, 0.1)',
            },
            ticks: {
              color: 'rgba(75, 192, 192, 1)',
            },
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            title: {
              display: true,
              text: 'CPU Usage (%)',
              color: 'rgba(255, 99, 132, 1)',
            },
            grid: {
              drawOnChartArea: false,
            },
            ticks: {
              color: 'rgba(255, 99, 132, 1)',
            },
          },
          y2: {
            type: 'linear',
            display: false,
            position: 'right',
            title: {
              display: true,
              text: 'Memory (MB)',
              color: 'rgba(54, 162, 235, 1)',
            },
            grid: {
              drawOnChartArea: false,
            },
          },
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: 'rgba(255, 255, 255, 0.7)',
            },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: function (tooltipContext) {
                let label = tooltipContext.dataset.label || '';
                if (label) {
                  label += ': ';
                }
                if (tooltipContext.parsed.y !== null) {
                  label += tooltipContext.parsed.y.toFixed(2);
                  if (tooltipContext.datasetIndex === 0) label += ' ms';
                  if (tooltipContext.datasetIndex === 1) label += ' %';
                  if (tooltipContext.datasetIndex === 2) label += ' MB';
                }
                return label;
              },
            },
          },
        },
      },
    });
  } catch (e) {
    console.error('Error initializing metrics chart:', e);
  }
}

// Initialize history chart
function initHistoryChart() {
  const ctx = document.getElementById('history-chart');
  if (!ctx) {
    console.warn('History chart canvas not found');
    return;
  }

  // Destroy existing chart if it exists
  if (window.historyChart) {
    try {
      window.historyChart.destroy();
    } catch (e) {
      console.warn('Error destroying existing history chart:', e);
    }
    window.historyChart = null;
  }

  // Clear the canvas
  const context = ctx.getContext('2d');
  context.clearRect(0, 0, ctx.width, ctx.height);

  window.historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Avg Response Time (ms)',
          data: [],
          borderColor: 'rgba(75, 192, 192, 1)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          tension: 0.4,
          yAxisID: 'y',
          fill: true,
        },
        {
          label: 'Messages Processed',
          data: [],
          borderColor: 'rgba(255, 206, 86, 1)',
          backgroundColor: 'rgba(255, 206, 86, 0.2)',
          tension: 0.4,
          yAxisID: 'y1',
          fill: true,
        },
        {
          label: 'Memory Usage (MB)',
          data: [],
          borderColor: 'rgba(54, 162, 235, 1)',
          backgroundColor: 'rgba(54, 162, 235, 0.2)',
          tension: 0.4,
          yAxisID: 'y2',
          fill: true,
          hidden: true, // Hidden by default to reduce clutter
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: 'Time',
            color: 'rgba(255, 255, 255, 0.7)',
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.1)',
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.7)',
            maxRotation: 45,
            minRotation: 45,
          },
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'Response Time (ms)',
            color: 'rgba(75, 192, 192, 1)',
          },
          grid: {
            color: 'rgba(75, 192, 192, 0.1)',
          },
          ticks: {
            color: 'rgba(75, 192, 192, 1)',
          },
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: 'Messages',
            color: 'rgba(255, 206, 86, 1)',
          },
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            color: 'rgba(255, 206, 86, 1)',
          },
        },
        y2: {
          type: 'linear',
          display: false,
          position: 'right',
          title: {
            display: true,
            text: 'Memory (MB)',
            color: 'rgba(54, 162, 235, 1)',
          },
          grid: {
            drawOnChartArea: false,
          },
        },
      },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: 'rgba(255, 255, 255, 0.7)',
          },
        },
        tooltip: {
          callbacks: {
            label: function (tooltipContext) {
              let label = tooltipContext.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (tooltipContext.parsed.y !== null) {
                const value = tooltipContext.parsed.y;
                if (tooltipContext.datasetIndex === 0) label += value.toFixed(2) + ' ms';
                else if (tooltipContext.datasetIndex === 1) label += Math.round(value);
                else if (tooltipContext.datasetIndex === 2) label += value.toFixed(2) + ' MB';
              }
              return label;
            },
          },
        },
      },
    },
  });
}

// Fetch and update historical performance data
async function updateHistoryChart(period = 'hourly', range = 24) {
  try {
    let endpoint, param;
    if (period === 'hourly') {
      endpoint = '/performance/history/hourly';
      param = `hours=${range}`;
    } else {
      endpoint = '/performance/history/daily';
      param = `days=${range}`;
    }

    const response = await fetch(`${endpoint}?${param}`);
    if (!response.ok) {
      console.error(`Error fetching history data: ${response.status} ${response.statusText}`);
      return;
    }

    const result = await response.json();
    if (!result.success || !result.data) {
      console.error('Invalid history data received');
      return;
    }

    const data = result.data;

    // Update chart data
    if (window.historyChart && data.length > 0) {
      const labels = data.map(d => {
        const date = new Date(d.timestamp);
        if (period === 'hourly') {
          return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            hour12: true,
          });
        }
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
      });

      window.historyChart.data.labels = labels;
      window.historyChart.data.datasets[0].data = data.map(d => d.responseTimeAvg);
      window.historyChart.data.datasets[1].data = data.map(d => d.messageCount);
      window.historyChart.data.datasets[2].data = data.map(d => d.memoryAvg);

      window.historyChart.update('none');
    }

    // Update summary statistics
    if (data.length > 0) {
      const avgResponse = data.reduce((sum, d) => sum + d.responseTimeAvg, 0) / data.length;
      const totalMessages = data.reduce((sum, d) => sum + d.messageCount, 0);
      const totalApiCalls = data.reduce((sum, d) => sum + d.apiCalls + d.functionCalls, 0);
      const avgMemory = data.reduce((sum, d) => sum + d.memoryAvg, 0) / data.length;

      document.getElementById('history-avg-response').textContent = `${Math.round(avgResponse)} ms`;
      document.getElementById('history-total-messages').textContent =
        totalMessages.toLocaleString();
      document.getElementById('history-api-calls').textContent = totalApiCalls.toLocaleString();
      document.getElementById('history-avg-memory').textContent = `${Math.round(avgMemory)} MB`;
    } else {
      document.getElementById('history-avg-response').textContent = '-- ms';
      document.getElementById('history-total-messages').textContent = '--';
      document.getElementById('history-api-calls').textContent = '--';
      document.getElementById('history-avg-memory').textContent = '-- MB';
    }
  } catch (error) {
    console.error('Error updating history chart:', error);
  }
}

// Update performance metrics display
function updatePerformanceMetrics(metrics) {
  // Check if we have a metrics object and required elements exist
  if (
    !metrics ||
    !document.getElementById('response-time') ||
    !document.getElementById('cpu-usage')
  ) {
    return;
  }
  if (!metrics) return;

  // Update response time metrics
  const responseTimeElement = document.getElementById('response-time');
  const avgResponseTimeElement = document.getElementById('avg-response-time');
  const minMaxResponseTimeElement = document.getElementById('minmax-response-time');

  if (responseTimeElement && metrics.responseTime) {
    responseTimeElement.textContent = `${Math.round(metrics.responseTime.current)} ms`;
  }

  if (avgResponseTimeElement && metrics.responseTime) {
    avgResponseTimeElement.textContent = `${Math.round(metrics.responseTime.average)} ms`;
  }

  if (minMaxResponseTimeElement && metrics.responseTime) {
    minMaxResponseTimeElement.textContent = `${Math.round(metrics.responseTime.min)} / ${Math.round(metrics.responseTime.max)} ms`;
  }

  // Update CPU and memory metrics
  const cpuUsageElement = document.getElementById('cpu-usage');
  const cpuLoadElement = document.getElementById('cpu-load');
  const memoryUsageElement = document.getElementById('memory-usage');

  if (cpuUsageElement && metrics.system && metrics.system.cpu && metrics.system.cpu.length > 0) {
    const cpuUsage = metrics.system.cpu[metrics.system.cpu.length - 1] / 1000; // Convert to ms
    cpuUsageElement.textContent = `${cpuUsage.toFixed(1)}%`;
  }

  if (cpuLoadElement && metrics.system && metrics.system.load && metrics.system.load.length > 0) {
    const load = metrics.system.load[metrics.system.load.length - 1];
    cpuLoadElement.textContent = load.toFixed(2);
  }

  if (
    memoryUsageElement &&
    metrics.system &&
    metrics.system.memory &&
    metrics.system.memory.length > 0
  ) {
    const memUsedMB = Math.round(
      metrics.system.memory[metrics.system.memory.length - 1] / 1024 / 1024
    );
    // Get total memory from system object if available, otherwise use a default value
    const totalMem = metrics.system.totalMemory || 1024 * 8; // Default to 8GB if not available
    const totalMemMB = Math.round(totalMem / 1024 / 1024);
    memoryUsageElement.textContent = `${memUsedMB} / ${totalMemMB} MB`;
  }

  // Update chart if we have enough data
  if (
    metrics.system &&
    metrics.system.timestamps &&
    metrics.system.timestamps.length > 0 &&
    metrics.system.cpu &&
    metrics.system.cpu.length > 0 &&
    metrics.system.memory &&
    metrics.system.memory.length > 0
  ) {
    const lastIndex = metrics.system.timestamps.length - 1;
    updateMetricsChart(metrics.system.timestamps[lastIndex], {
      responseTime: metrics.responseTime.current,
      cpu: metrics.system.cpu[lastIndex],
      memory: metrics.system.memory[lastIndex],
    });
  }
}

// Update metrics chart with new data
function updateMetricsChart(timestamp, metrics) {
  if (!window.metricsChart) return;

  const now = new Date();
  const timeStr = now.toLocaleTimeString();

  try {
    // Add new data points
    window.metricsChart.data.labels.push(timeStr);

    // Response time in ms
    window.metricsChart.data.datasets[0].data.push(metrics.responseTime);

    // CPU usage (convert from microseconds to milliseconds and then to percentage)
    const cpuUsage = metrics.cpu / 1000; // Convert to ms
    window.metricsChart.data.datasets[1].data.push(cpuUsage);

    // Memory usage in MB
    const memoryUsedMB = Math.round(metrics.memory / 1024 / 1024);
    window.metricsChart.data.datasets[2].data.push(memoryUsedMB);

    // Keep only the last 20 data points
    const maxPoints = 20;
    if (window.metricsChart.data.labels.length > maxPoints) {
      window.metricsChart.data.labels.shift();
      window.metricsChart.data.datasets.forEach(dataset => {
        if (dataset && dataset.data) {
          dataset.data.shift();
        }
      });
    }

    window.metricsChart.update('none');
  } catch (error) {
    console.error('Error updating metrics chart:', error);
    // Reinitialize the chart if there's an error
    initMetricsChart();
  }
}

// Clean up chart on page unload
window.addEventListener('beforeunload', () => {
  if (window.metricsChart) {
    try {
      window.metricsChart.destroy();
    } catch (e) {
      console.warn('Error destroying chart on unload:', e);
    }
    window.metricsChart = null;
  }
});

// Initialize the page
document.addEventListener('DOMContentLoaded', () => {
  // Ensure all required elements exist
  if (!document.querySelector('.dot') || !document.querySelector('.status-text')) {
    console.error('Required status indicator elements not found');
    return;
  }
  // Breaker functionality disabled - endpoints not implemented
  /*
  // Admin Breaker Panel
  const adminPanel = document.createElement('div');
  adminPanel.className = 'card admin-breaker';
  adminPanel.innerHTML = `
      <h2>Circuit Breaker Admin</h2>
      <div id="breaker-status">Loading...</div>
      <div id="breaker-approvals"></div>
      <div style="margin-top:8px;">
        <input id="owner-token" type="password" placeholder="OWNER_TOKEN" style="width:180px;" />
        <button id="breaker-reset-btn">Reset Breaker</button>
      </div>
    `;
  document.querySelector('.dashboard').appendChild(adminPanel);
  function fetchBreakerStatus() {
    fetch('/breaker/status')
      .then(r => r.json())
      .then(data => {
        document.getElementById('breaker-status').innerText = data.breakerOpen
          ? '🚨 Breaker OPEN'
          : '✅ Breaker CLOSED';
        const approvals = data.pendingRequests || [];
        const approvalsDiv = document.getElementById('breaker-approvals');
        if (approvals.length === 0) {
          approvalsDiv.innerHTML = '<em>No pending approvals.</em>';
        } else {
          approvalsDiv.innerHTML = approvals
            .map(
              (req, i) =>
                `<div style='margin-bottom:6px;'>
              <b>Request #${i + 1}</b> - ${req.type || 'unknown'}<br/>
              <button data-idx='${i}' data-dec='approve'>Approve</button>
              <button data-idx='${i}' data-dec='deny'>Deny</button>
            </div>`
            )
            .join('');
        }
      });
  }
  setInterval(fetchBreakerStatus, 15000); // Reduced from 3s to 15s for bandwidth efficiency
  fetchBreakerStatus();
  document.getElementById('breaker-reset-btn').onclick = () => {
    const token = document.getElementById('owner-token').value;
    fetch('/breaker/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-owner-token': token },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(fetchBreakerStatus);
  };
  document.getElementById('breaker-approvals').onclick = e => {
    if (e.target.tagName === 'BUTTON') {
      const idx = Number(e.target.getAttribute('data-idx'));
      const dec = e.target.getAttribute('data-dec');
      const token = document.getElementById('owner-token').value;
      fetch('/breaker/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-owner-token': token },
        body: JSON.stringify({ index: idx, decision: dec, token }),
      })
        .then(r => r.json())
        .then(fetchBreakerStatus);
    }
  };
  */

  initCharts();
  initMetricsChart();
  initHistoryChart();
  updateStatus();
  updateFunctionResults();
  fetchPerformanceData();

  // Initial history chart update
  updateHistoryChart('hourly', 24);

  // Set up periodic updates
  setInterval(updateStatus, UPDATE_INTERVAL);
  // Disabled function results updates to save bandwidth (was 47MB every 10s)
  // setInterval(updateFunctionResults, UPDATE_INTERVAL);
  // Performance metrics are updated via updateStatus, no need for separate interval

  // Set up event listeners with null checks
  const runTestsBtn = document.getElementById('run-tests');
  const resetStatsBtn = document.getElementById('reset-stats');
  const repairStatsBtn = document.getElementById('repair-stats');

  if (runTestsBtn) runTestsBtn.addEventListener('click', runTests);
  if (resetStatsBtn) resetStatsBtn.addEventListener('click', resetStats);
  if (repairStatsBtn) repairStatsBtn.addEventListener('click', repairStats);

  // Set up history chart button listeners
  const historyButtons = document.querySelectorAll('.history-btn');
  if (historyButtons.length > 0) {
    historyButtons.forEach(button => {
      button.addEventListener('click', () => {
        // Remove active class from all history buttons
        document.querySelectorAll('.history-btn').forEach(btn => btn.classList.remove('active'));

        // Add active class to clicked button
        button.classList.add('active');

        // Update chart with selected period and range
        const period = button.getAttribute('data-period');
        const range = button.getAttribute('data-range') || 24;
        updateHistoryChart(period, range);
      });
    });
  }

  // Set up tab buttons
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons and panes
      document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

      // Add active class to clicked button and corresponding pane
      button.classList.add('active');
      const tabId = button.getAttribute('data-tab');
      document.getElementById(`${tabId}-results`).classList.add('active');
    });
  });

  // Set up image modal functionality
  const modal = document.getElementById('gallery-modal');
  const closeBtn = document.getElementById('modal-close');

  // Close modal when clicking the close button
  closeBtn.addEventListener('click', closeImageModal);

  // Close modal when clicking outside the image
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      closeImageModal();
    }
  });

  // Close modal with Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeImageModal();
    }
  });

  // Function to open image modal
  window.openImageModal = function (imageUrl, prompt) {
    const galleryModal = document.getElementById('gallery-modal');
    const modalImage = document.getElementById('modal-image');
    const modalPrompt = document.getElementById('modal-prompt');

    modalImage.src = imageUrl;
    modalPrompt.textContent = prompt;
    galleryModal.classList.add('active');

    // Prevent scrolling on body when modal is open
    document.body.style.overflow = 'hidden';
  };

  // Function to close image modal
  window.closeImageModal = function () {
    const galleryModal = document.getElementById('gallery-modal');
    galleryModal.classList.remove('active');

    // Re-enable scrolling
    document.body.style.overflow = 'auto';
  };
});

/**
 * Initialize charts for API calls and errors
 */
function initCharts() {
  // API calls chart
  const apiCtx = document.getElementById('api-chart').getContext('2d');
  apiChart = new Chart(apiCtx, {
    type: 'doughnut',
    data: {
      labels: ['OpenAI', 'Weather', 'Time', 'Wolfram', 'Quake', 'GPT Image'],
      datasets: [
        {
          data: [0, 0, 0, 0, 0, 0],
          backgroundColor: [
            '#43b581', // Green
            '#7289da', // Blue
            '#faa61a', // Yellow
            '#f04747', // Red
            '#b9bbbe', // Gray
            '#9b59b6', // Purple (for DALL-E)
          ],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#ffffff',
          },
        },
      },
    },
  });

  // Errors chart
  const errorCtx = document.getElementById('error-chart').getContext('2d');
  errorChart = new Chart(errorCtx, {
    type: 'bar',
    data: {
      labels: ['OpenAI', 'Discord', 'Weather', 'Time', 'Wolfram', 'Quake', 'GPT Image', 'Other'],
      datasets: [
        {
          label: 'Errors',
          data: [0, 0, 0, 0, 0, 0, 0, 0],
          backgroundColor: '#f04747',
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
          ticks: {
            color: '#ffffff',
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.1)',
          },
        },
        x: {
          ticks: {
            color: '#ffffff',
          },
          grid: {
            display: false,
          },
        },
      },
    },
  });
}

/**
 * Update the function results section with the latest data
 */
async function updateFunctionResults() {
  try {
    // Use summary endpoint to avoid massive data transfer (was 47MB!)
    const response = await fetch('/function-results/summary');
    if (!response.ok) {
      console.error(`Error fetching function results: ${response.status} ${response.statusText}`);
      return;
    }

    const data = await response.json();

    if (!data) {
      console.error('Empty function results data received');
      return;
    }

    // Update each tab with summary data (count/latest format)
    updateWeatherResults(data.weather || { count: 0, latest: null });
    updateTimeResults(data.time || { count: 0, latest: null });
    updateWolframResults(data.wolfram || { count: 0, latest: null });
    updateQuakeResults(data.quake || { count: 0, latest: null });
    updateDalleResults(data.gptimage || data.dalle || { count: 0, latest: null });
    // Gallery disabled since we're using summary data (not full image arrays)
    // updateGallery(data.gptimage || data.dalle || []);
  } catch (error) {
    console.error('Error updating function results:', error.message || error);
    // Display a message in each tab indicating there was an error
    document.querySelectorAll('.tab-pane').forEach(pane => {
      if (!pane.querySelector('.error-message')) {
        const errorMsg = document.createElement('div');
        errorMsg.className = 'error-message';
        errorMsg.textContent = 'Error loading function results. Please try again later.';
        pane.appendChild(errorMsg);
      }
    });
  }
}

/**
 * Update the weather results tab
 * @param {Array} results - Weather function results
 */
// Generic function to display summary data
function displaySummary(container, summary, functionName) {
  if (!summary || summary.count === 0) {
    container.innerHTML = `<div class="no-data">No recent ${functionName} calls</div>`;
    return;
  }

  container.innerHTML = `
    <div class="result-summary">
      <div class="summary-stat">
        <span class="stat-label">Total Calls:</span>
        <span class="stat-value">${summary.count}</span>
      </div>
      <div class="summary-stat">
        <span class="stat-label">Last Used:</span>
        <span class="stat-value">${summary.latest ? new Date(summary.latest).toLocaleString() : 'Never'}</span>
      </div>
      <div class="summary-actions">
        <button class="view-details-btn" onclick="loadFullResults('${functionName}', '${container.id}')">
          📋 View Details
        </button>
      </div>
    </div>
  `;
}

// Function to load full results on demand
async function loadFullResults(functionType, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '<div class="loading">Loading full results...</div>';

  try {
    const response = await fetch(`/function-results?limit=5`);
    const data = await response.json();

    if (functionType === 'weather' && data.weather) {
      displayWeatherDetails(container, data.weather);
    } else if (functionType === 'GPT Image-1' && data.gptimage) {
      displayImageDetails(container, data.gptimage);
    } else if (functionType === 'time' && data.time) {
      displayTimeDetails(container, data.time);
    } else if (functionType === 'Wolfram Alpha' && data.wolfram) {
      displayWolframDetails(container, data.wolfram);
    } else {
      container.innerHTML = `<div class="no-data">No ${functionType} results available</div>`;
    }
  } catch (error) {
    container.innerHTML = `<div class="error">Error loading ${functionType} results</div>`;
  }
}

function displayWeatherDetails(container, results) {
  if (!results || results.length === 0) {
    container.innerHTML = '<div class="no-data">No weather results</div>';
    return;
  }

  container.innerHTML = results
    .slice(0, 3)
    .map(
      item => `
    <div class="function-call">
      <div class="function-header">
        <span class="function-location">${item.result?.location?.name || item.params.location || 'Unknown'}</span>
        <span class="function-time">${new Date(item.timestamp).toLocaleString()}</span>
      </div>
      <div class="function-details">${item.result?.formatted || 'Weather data'}</div>
    </div>
  `
    )
    .join('');
}

function displayImageDetails(container, results) {
  if (!results || results.length === 0) {
    container.innerHTML = '<div class="no-data">No image results</div>';
    return;
  }

  container.innerHTML = results
    .slice(0, 3)
    .map(
      item => `
    <div class="function-call">
      <div class="function-header">
        <span class="function-location">GPT Image-1</span>
        <span class="function-time">${new Date(item.timestamp).toLocaleString()}</span>
      </div>
      <div class="function-params">Prompt: "${item.params?.prompt || 'Unknown'}"</div>
      <div class="function-details">
        ${item.result?.success ? '✅ Generated successfully' : '❌ Generation failed'}
        ${item.result?.images?.[0] ? `<br><img src="${item.result.images[0]}" style="max-width: 200px; margin-top: 8px;" alt="Generated image">` : ''}
      </div>
    </div>
  `
    )
    .join('');
}

function displayTimeDetails(container, results) {
  if (!results || results.length === 0) {
    container.innerHTML = '<div class="no-data">No time results</div>';
    return;
  }

  container.innerHTML = results
    .slice(0, 3)
    .map(
      item => `
    <div class="function-call">
      <div class="function-header">
        <span class="function-location">${item.result?.location || item.params.location || 'Unknown'}</span>
        <span class="function-time">${new Date(item.timestamp).toLocaleString()}</span>
      </div>
      <div class="function-details">${item.result?.formatted || 'Time data'}</div>
    </div>
  `
    )
    .join('');
}

function displayWolframDetails(container, results) {
  if (!results || results.length === 0) {
    container.innerHTML = '<div class="no-data">No Wolfram results</div>';
    return;
  }

  container.innerHTML = results
    .slice(0, 3)
    .map(
      item => `
    <div class="function-call">
      <div class="function-header">
        <span class="function-location">${item.params?.query || 'Unknown query'}</span>
        <span class="function-time">${new Date(item.timestamp).toLocaleString()}</span>
      </div>
      <div class="function-details">${item.result?.formatted || JSON.stringify(item.result, null, 2)}</div>
    </div>
  `
    )
    .join('');
}

function updateWeatherResults(summary) {
  const container = document.getElementById('weather-results');
  displaySummary(container, summary, 'weather');
}

/**
 * Update the time results tab
 * @param {Array} results - Time function results
 */
function updateTimeResults(summary) {
  const container = document.getElementById('time-results');
  displaySummary(container, summary, 'time');
}

/**
 * Update the Wolfram results tab
 * @param {Array} results - Wolfram function results
 */
function updateWolframResults(summary) {
  const container = document.getElementById('wolfram-results');
  displaySummary(container, summary, 'Wolfram Alpha');
}

/**
 * Update the Quake results tab
 * @param {Array} results - Quake function results
 */
function updateQuakeResults(summary) {
  const container = document.getElementById('quake-results');
  displaySummary(container, summary, 'Quake server');
}

/**
 * Update the DALL-E results tab
 * @param {Array} results - DALL-E function results
 */
function updateDalleResults(summary) {
  const container = document.getElementById('gptimage-results');
  displaySummary(container, summary, 'GPT Image-1');
}

/**
 * Update the gallery with DALL-E images
 * @param {Array} results - DALL-E function results
 */
function updateGallery(results) {
  const container = document.querySelector('#gallery-results .gallery-container');

  if (!results || results.length === 0 || !container) {
    if (container) {
      container.innerHTML = '<div class="no-data">No images to display</div>';
    }
    return;
  }

  container.innerHTML = '';

  // Filter only successful image generations
  const successfulResults = results.filter(
    item =>
      item.result && item.result.success && item.result.images && item.result.images.length > 0
  );

  if (successfulResults.length === 0) {
    container.innerHTML = '<div class="no-data">No successful image generations found</div>';
    return;
  }

  // Create gallery items for each image
  successfulResults.forEach(item => {
    item.result.images.forEach(image => {
      if (!image.url) return;

      const galleryItem = document.createElement('div');
      galleryItem.className = 'gallery-item';

      const img = document.createElement('img');
      img.src = image.url;
      img.alt = 'Generated image';
      img.loading = 'lazy';

      const promptDiv = document.createElement('div');
      promptDiv.className = 'prompt';
      promptDiv.textContent = image.revisedPrompt || item.params.prompt;

      galleryItem.appendChild(img);
      galleryItem.appendChild(promptDiv);

      // Add click event to open modal
      galleryItem.addEventListener('click', () => {
        window.openImageModal(image.url, image.revisedPrompt || item.params.prompt);
      });

      container.appendChild(galleryItem);
    });
  });
}

/**
 * Safely updates text content of an element if it exists
 * @param {string} elementId - The ID of the element to update
 * @param {string} text - The text to set
 * @param {string} [defaultText='-'] - Default text if text is empty
 */
function safeUpdateText(elementId, text, defaultText = '-') {
  try {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = text !== undefined && text !== null ? text : defaultText;
    } else {
      console.warn(`Element with ID '${elementId}' not found`);
    }
  } catch (error) {
    console.error(`Error updating ${elementId}:`, error);
  }
}

/**
 * Update the status page with the latest data
 */
async function updateStatus() {
  try {
    console.log('Fetching health data...');
    const response = await fetch('/health');

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Error fetching health data: ${response.status} ${response.statusText}`,
        errorText
      );
      setStatusIndicator('offline');
      return;
    }

    const data = await response.json().catch(error => {
      console.error('Error parsing JSON response:', error);
      throw new Error('Invalid JSON response from server');
    });

    if (!data) {
      console.error('Empty health data received');
      setStatusIndicator('offline');
      return;
    }

    console.log('Health data received:', {
      status: data.status,
      name: data.name,
      hasStats: !!data.stats,
      hasMemory: !!data.memory,
      hasSystem: !!data.system,
    });

    // Update bot name in title and header
    const botName = data.name || 'Bot';
    safeUpdateText('page-title', `${botName} Status`);
    safeUpdateText('bot-name-header', `${botName} Status`);

    // Update status indicator
    setStatusIndicator(data.status || 'unknown');

    // Update conversation mode
    updateConversationMode(data.conversationMode);

    // Update overview stats
    safeUpdateText('uptime', data.uptime !== undefined ? formatUptime(data.uptime) : '-');
    safeUpdateText('version', data.version || '-');

    if (data.stats) {
      safeUpdateText(
        'message-count',
        data.stats.messageCount !== undefined ? data.stats.messageCount.toLocaleString() : '0'
      );

      if (data.stats.discord && data.stats.discord.ping !== undefined) {
        safeUpdateText('discord-ping', `${data.stats.discord.ping} ms`);
      } else {
        safeUpdateText('discord-ping', '-- ms');
      }

      // Update API calls
      if (data.stats.apiCalls) {
        updateApiCalls(data.stats.apiCalls);
      }

      // Update errors
      if (data.stats.errors) {
        updateErrors(data.stats.errors);
      }

      // Update plugin statistics
      if (data.stats.plugins && data.stats.apiCalls?.plugins && data.stats.errors?.plugins) {
        updatePluginStats(
          data.stats.plugins,
          data.stats.apiCalls.plugins,
          data.stats.errors.plugins
        );
      }

      // Update rate limits
      if (data.stats.rateLimits) {
        safeUpdateText(
          'rate-limit-hits',
          data.stats.rateLimits.count !== undefined
            ? data.stats.rateLimits.count.toLocaleString()
            : '0'
        );

        safeUpdateText(
          'rate-limit-users',
          data.stats.rateLimits.uniqueUsers !== undefined
            ? data.stats.rateLimits.uniqueUsers.toLocaleString()
            : '0'
        );

        if (Array.isArray(data.stats.rateLimits.userDetails)) {
          updateRateLimitedUsers(data.stats.rateLimits.userDetails);
        }
      }
    }

    // Update memory usage if data is available
    if (data.memory && data.system) {
      updateMemoryUsage(data.memory, data.system);
    }

    // Update last updated time
    safeUpdateText('last-updated', new Date().toLocaleString());

    // Fetch and update performance metrics
    fetchPerformanceData().catch(error => {
      console.error('Error fetching performance data:', error);
    });
  } catch (error) {
    console.error('Error in updateStatus:', error);
    setStatusIndicator('error');

    // Display an error message on the page
    try {
      document.querySelectorAll('.card').forEach(card => {
        if (!card.querySelector('.error-banner')) {
          const errorBanner = document.createElement('div');
          errorBanner.className = 'error-banner';
          errorBanner.textContent = 'Error connecting to server. Please check your connection.';
          card.prepend(errorBanner);
        }
      });
    } catch (domError) {
      console.error('Error displaying error banner:', domError);
    }
  }
}

/**
 * Fetch performance data from the /performance endpoint
 */
async function fetchPerformanceData() {
  try {
    const response = await fetch('/performance');
    if (!response.ok) {
      console.error(`Error fetching performance data: ${response.status} ${response.statusText}`);
      return;
    }

    const data = await response.json();
    if (!data || !data.success) {
      console.error('Invalid performance data received');
      return;
    }

    // Process the performance data into the format expected by updatePerformanceMetrics
    const metrics = {
      responseTime: {
        current: data.summary.message_processing?.avg || 0,
        average: data.summary.message_processing?.avg || 0,
        min: data.detailed.message_processing?.min || 0,
        max: data.detailed.message_processing?.max || 0,
      },
      system: {
        cpu: [data.summary.message_processing?.avg || 0], // Using message processing time as a proxy
        load: [1.0], // Default load value
        memory: [parseFloat(data.serverHealth?.memory?.heapUsed || '0') * 1024 * 1024], // Convert MB to bytes
        timestamps: [Date.now()],
        totalMemory: 8 * 1024 * 1024 * 1024, // Default 8GB
      },
    };

    updatePerformanceMetrics(metrics);
  } catch (error) {
    console.error('Error fetching performance data:', error);
  }
}

/**
 * Set the status indicator based on the current status
 * @param {string} status - Current status (ok, warning, error, offline)
 */
function setStatusIndicator(status) {
  try {
    const dot = document.querySelector('.dot');
    const statusText = document.querySelector('.status-text');

    // If elements don't exist, log a warning and return early
    if (!dot && !statusText) {
      console.warn('Status indicator elements (.dot, .status-text) not found in the DOM');
      return;
    }

    // Update dot class if it exists
    if (dot) {
      // Remove all status classes
      dot.className = 'dot';

      // Add the appropriate status class
      switch (status) {
        case 'ok':
          dot.classList.add('online');
          break;
        case 'warning':
          dot.classList.add('warning');
          break;
        case 'error':
        case 'offline':
          dot.classList.add('offline');
          break;
        default:
          dot.classList.add('offline');
          break;
      }
    }

    // Update status text if it exists
    if (statusText) {
      let statusMessage = 'Unknown';

      switch (status) {
        case 'ok':
          statusMessage = 'Online';
          break;
        case 'warning':
          statusMessage = 'Warning';
          break;
        case 'error':
        case 'offline':
          statusMessage = 'Offline';
          break;
        default:
          statusMessage = 'Unknown';
          break;
      }

      statusText.textContent = statusMessage;
    }
  } catch (error) {
    console.error('Error in setStatusIndicator:', error);
  }
}

/**
 * Update conversation mode display
 * @param {Object} conversationMode - Conversation mode information
 */
function updateConversationMode(conversationMode) {
  try {
    const modeElement = document.querySelector('.mode-text');

    if (!modeElement) {
      console.warn('Conversation mode element not found');
      return;
    }

    if (!conversationMode) {
      modeElement.textContent = 'Mode Unknown';
      modeElement.title = 'Conversation mode information not available';
      return;
    }

    // Set the mode text and tooltip
    modeElement.textContent = conversationMode.mode || 'Unknown Mode';

    // Create detailed tooltip
    const details = [];
    if (conversationMode.blendedConversations !== undefined) {
      details.push(`Blended: ${conversationMode.blendedConversations ? 'Enabled' : 'Disabled'}`);
    }
    if (conversationMode.replyContext !== undefined) {
      details.push(`Reply Context: ${conversationMode.replyContext ? 'Enabled' : 'Disabled'}`);
    }
    if (conversationMode.blendedConversations && conversationMode.maxMessagesPerUser) {
      details.push(`Max msgs/user: ${conversationMode.maxMessagesPerUser}`);
    }

    modeElement.title = details.length > 0 ? details.join(' | ') : 'Conversation Mode';
  } catch (error) {
    console.error('Error in updateConversationMode:', error);
  }
}

/**
 * Update API call statistics
 * @param {Object} apiCalls - API call counts by service
 */
function updateApiCalls(apiCalls) {
  // Update individual counters with null checks
  const openaiElement = document.getElementById('openai-calls');
  const weatherElement = document.getElementById('weather-calls');
  const timeElement = document.getElementById('time-calls');
  const wolframElement = document.getElementById('wolfram-calls');
  const quakeElement = document.getElementById('quake-calls');
  const dalleElement = document.getElementById('dalle-calls');

  if (openaiElement) openaiElement.textContent = apiCalls.openai.toLocaleString();
  if (weatherElement) weatherElement.textContent = apiCalls.weather.toLocaleString();
  if (timeElement) timeElement.textContent = apiCalls.time.toLocaleString();
  if (wolframElement) wolframElement.textContent = apiCalls.wolfram.toLocaleString();
  if (quakeElement) quakeElement.textContent = apiCalls.quake.toLocaleString();
  if (dalleElement)
    dalleElement.textContent = (apiCalls.gptimage || apiCalls.dalle || 0).toLocaleString();

  // Update chart if it exists
  if (apiChart && apiChart.data && apiChart.data.datasets[0]) {
    apiChart.data.datasets[0].data = [
      apiCalls.openai,
      apiCalls.weather,
      apiCalls.time,
      apiCalls.wolfram,
      apiCalls.quake,
      apiCalls.gptimage || apiCalls.dalle || 0,
    ];
    apiChart.update();
  }
}

/**
 * Update error statistics
 * @param {Object} errors - Error counts by service
 */
function updateErrors(errors) {
  // Update individual counters with null checks
  const openaiErrorsElement = document.getElementById('openai-errors');
  const discordErrorsElement = document.getElementById('discord-errors');
  const weatherErrorsElement = document.getElementById('weather-errors');
  const timeErrorsElement = document.getElementById('time-errors');
  const wolframErrorsElement = document.getElementById('wolfram-errors');
  const quakeErrorsElement = document.getElementById('quake-errors');
  const dalleErrorsElement = document.getElementById('dalle-errors');
  const otherErrorsElement = document.getElementById('other-errors');

  if (openaiErrorsElement) openaiErrorsElement.textContent = errors.openai.toLocaleString();
  if (discordErrorsElement) discordErrorsElement.textContent = errors.discord.toLocaleString();
  if (weatherErrorsElement) weatherErrorsElement.textContent = errors.weather.toLocaleString();
  if (timeErrorsElement) timeErrorsElement.textContent = errors.time.toLocaleString();
  if (wolframErrorsElement) wolframErrorsElement.textContent = errors.wolfram.toLocaleString();
  if (quakeErrorsElement) quakeErrorsElement.textContent = errors.quake.toLocaleString();
  if (dalleErrorsElement)
    dalleErrorsElement.textContent = (errors.gptimage || errors.dalle || 0).toLocaleString();
  if (otherErrorsElement) otherErrorsElement.textContent = errors.other.toLocaleString();

  // Handle plugin errors with the new detailed structure
  const pluginErrorsContainer = document.getElementById('plugin-errors-container');
  if (pluginErrorsContainer) {
    // Clear previous content
    pluginErrorsContainer.innerHTML = '';

    // Check if there are any plugin errors
    const pluginIds = Object.keys(errors.plugins || {});

    if (pluginIds.length === 0) {
      pluginErrorsContainer.innerHTML = '<p class="text-success">No plugin errors reported.</p>';
    } else {
      // Create a table to display plugin errors
      const table = document.createElement('table');
      table.className = 'table table-sm table-striped';

      // Create table header
      const thead = document.createElement('thead');
      thead.innerHTML = `
                <tr>
                    <th>Plugin ID</th>
                    <th>Total Errors</th>
                    <th>Hook Details</th>
                </tr>
            `;
      table.appendChild(thead);

      // Create table body
      const tbody = document.createElement('tbody');

      // Add rows for each plugin with errors
      pluginIds.forEach(pluginId => {
        const pluginError = errors.plugins[pluginId];
        const row = document.createElement('tr');

        // Handle both old and new error format
        const errorCount = typeof pluginError === 'number' ? pluginError : pluginError.count || 0;

        // Get hook errors if available in the new format
        const hookErrors =
          pluginError.hooks && typeof pluginError.hooks === 'object' ? pluginError.hooks : {};

        // Create hook details HTML
        let hookDetailsHtml = '';
        const hookNames = Object.keys(hookErrors);

        if (hookNames.length > 0) {
          hookDetailsHtml = '<ul class="mb-0">';
          hookNames.forEach(hookName => {
            hookDetailsHtml += `<li><strong>${hookName}</strong>: ${hookErrors[hookName]} errors</li>`;
          });
          hookDetailsHtml += '</ul>';
        } else {
          hookDetailsHtml = '<span class="text-muted">No detailed hook information</span>';
        }

        // Set row content
        row.innerHTML = `
                    <td><code>${pluginId}</code></td>
                    <td>${errorCount}</td>
                    <td>${hookDetailsHtml}</td>
                `;

        tbody.appendChild(row);
      });

      table.appendChild(tbody);
      pluginErrorsContainer.appendChild(table);
    }
  }

  // Update chart if it exists
  if (errorChart && errorChart.data && errorChart.data.datasets[0]) {
    errorChart.data.datasets[0].data = [
      errors.openai,
      errors.discord,
      errors.weather,
      errors.time,
      errors.wolfram,
      errors.quake,
      errors.gptimage || errors.dalle || 0,
      errors.other,
    ];
    errorChart.update();
  }
}

/**
 * Update memory usage displays
 * @param {Object} memory - Memory usage data
 * @param {Object} system - System information
 */
function updateMemoryUsage(memory, system) {
  console.log('updateMemoryUsage received memory:', JSON.stringify(memory));
  console.log('updateMemoryUsage received system:', JSON.stringify(system));
  // Parse memory values
  const systemFree = parseInt(system.freeMemory, 10);
  const systemTotal = parseInt(system.totalMemory, 10);

  // Update memory display elements with correct IDs
  const memoryRssElement = document.getElementById('memory-rss');
  const memoryHeapTotalElement = document.getElementById('memory-heap-total');
  const memoryHeapUsedElement = document.getElementById('memory-heap-used');
  const systemMemoryElement = document.getElementById('system-memory');

  // Update memory values
  if (memoryRssElement) memoryRssElement.textContent = memory.rss || 'N/A';
  if (memoryHeapTotalElement) memoryHeapTotalElement.textContent = memory.heapTotal || 'N/A';
  if (memoryHeapUsedElement) memoryHeapUsedElement.textContent = memory.heapUsed || 'N/A';

  // Update system memory
  if (systemMemoryElement) {
    systemMemoryElement.textContent =
      systemTotal && systemFree ? `${systemTotal - systemFree} MB / ${systemTotal} MB` : 'N/A';
  }
}

/**
 * Format uptime in seconds to a readable string
 * @param {number} seconds - Uptime in seconds
 * @returns {string} - Formatted uptime string
 */
function formatUptime(seconds) {
  let remainingSeconds = seconds;
  const days = Math.floor(remainingSeconds / 86400);
  remainingSeconds %= 86400;
  const hours = Math.floor(remainingSeconds / 3600);
  remainingSeconds %= 3600;
  const minutes = Math.floor(remainingSeconds / 60);
  remainingSeconds %= 60;

  let result = '';
  if (days > 0) result += `${days}d `;
  if (hours > 0 || days > 0) result += `${hours}h `;
  if (minutes > 0 || hours > 0 || days > 0) result += `${minutes}m `;
  result += `${remainingSeconds}s`;

  return result;
}

/**
 * Update plugin statistics
 * @param {Object} plugins - Plugin statistics
 * @param {Object} pluginApiCalls - Plugin API call counts
 * @param {Object} pluginErrors - Plugin error counts
 */
/**
 * Update plugin statistics display
 * @param {Object} plugins - Plugin information
 * @param {Object} pluginApiCalls - API call counts by plugin
 * @param {Object} pluginErrors - Error counts by plugin
 */
function updatePluginStats(plugins, pluginApiCalls, pluginErrors) {
  // Update plugin counters
  document.getElementById('plugin-count').textContent = plugins?.loaded || 0;
  document.getElementById('plugin-commands').textContent = plugins?.commands || 0;
  document.getElementById('plugin-functions').textContent = plugins?.functions || 0;
  document.getElementById('plugin-hooks').textContent = plugins?.hooks || 0;

  // Update plugin API calls list
  const apiCallsContainer = document.getElementById('plugin-api-calls');
  apiCallsContainer.innerHTML = '';

  if (pluginApiCalls && Object.keys(pluginApiCalls).length > 0) {
    // Sort plugins by API call count (descending)
    const sortedPlugins = Object.entries(pluginApiCalls).sort((a, b) => b[1] - a[1]);

    // Create a list item for each plugin
    sortedPlugins.forEach(([pluginId, count]) => {
      const pluginItem = document.createElement('div');
      pluginItem.className = 'plugin-item';
      pluginItem.innerHTML = `
            <span class="plugin-name">${pluginId}</span>
            <span class="plugin-value">${count.toLocaleString()} calls</span>
        `;
      apiCallsContainer.appendChild(pluginItem);
    });
  } else {
    // Show empty message
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'empty-message';
    emptyMessage.textContent = 'No plugin API calls recorded';
    apiCallsContainer.appendChild(emptyMessage);
  }

  // Update plugin errors list
  const errorsContainer = document.getElementById('plugin-errors');
  errorsContainer.innerHTML = '';

  if (pluginErrors && Object.keys(pluginErrors).length > 0) {
    // Sort plugins by error count (descending)
    const sortedPlugins = Object.entries(pluginErrors).sort((a, b) => b[1] - a[1]);

    // Create a list item for each plugin
    sortedPlugins.forEach(([pluginId, count]) => {
      const pluginItem = document.createElement('div');
      pluginItem.className = 'plugin-item';
      pluginItem.innerHTML = `
            <span class="plugin-name">${pluginId}</span>
            <span class="plugin-value">${count.toLocaleString()} errors</span>
        `;
      errorsContainer.appendChild(pluginItem);
    });
  } else {
    // Show empty message
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'empty-message';
    emptyMessage.textContent = 'No plugin errors recorded';
    errorsContainer.appendChild(emptyMessage);
  }
}

/**
 * Update the rate limited users list
 *
 * @param {Array} userDetailsArray - Array of user-specific rate limit counts
 */
function updateRateLimitedUsers(userDetailsArray) {
  const container = document.getElementById('rate-limited-users-list');
  if (!container) {
    console.warn('Rate limited users container not found');
    return;
  }

  // Clear existing content
  container.innerHTML = '';

  if (!Array.isArray(userDetailsArray) || userDetailsArray.length === 0) {
    container.innerHTML = '<div class="empty-message">No rate limited users</div>';
    return;
  }

  try {
    // Create a table for better formatting
    const table = document.createElement('table');
    table.className = 'rate-limit-table';

    // Create table header
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>User ID</th>
        <th>Count</th>
        <th>Last Updated</th>
      </tr>
    `;

    // Create table body
    const tbody = document.createElement('tbody');

    // Add rows for each rate-limited user
    userDetailsArray.forEach(user => {
      if (!user) return;

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${user.userId || 'Unknown'}</td>
        <td>${typeof user.count !== 'undefined' ? user.count : 0}</td>
        <td>${user.timestamp ? new Date(user.timestamp).toLocaleString() : 'N/A'}</td>
      `;
      tbody.appendChild(row);
    });

    // Append header and body to table
    table.appendChild(thead);
    table.appendChild(tbody);

    // Append table to container
    container.appendChild(table);
  } catch (error) {
    console.error('Error updating rate limited users:', error);
    container.innerHTML = '<div class="error-message">Error loading rate limited users</div>';
  }
}

/**
 * Reset all statistics
 */
async function resetStats() {
  try {
    // Show confirmation dialog
    if (!confirm('Are you sure you want to reset all statistics?')) {
      return;
    }

    const response = await fetch('/reset-stats', {
      method: 'POST',
    });

    const result = await response.json();

    if (result.success) {
      // Update the UI immediately
      updateStatus();
      alert('Statistics reset successfully');
    } else {
      alert('Failed to reset statistics: ' + result.message);
    }
  } catch (error) {
    console.error('Error resetting stats:', error);
    alert('Error resetting statistics');
  }
}

/**
 * Repair the stats file if it's corrupted
 */
async function repairStats() {
  try {
    // Show confirmation dialog
    if (
      !confirm(
        'Are you sure you want to repair the stats file? This will attempt to fix any corruption issues.'
      )
    ) {
      return;
    }

    const response = await fetch('/repair-stats', {
      method: 'POST',
    });

    const result = await response.json();

    if (result.success) {
      // Update the UI immediately
      updateStatus();
      alert('Stats file repaired successfully');
    } else {
      alert('Failed to repair stats file: ' + (result.error || result.message || 'Unknown error'));
    }
  } catch (error) {
    console.error('Error repairing stats:', error);
    alert('Error repairing stats file');
  }
}

/**
 * Run tests and update the test results section
 */
async function runTests() {
  const button = document.getElementById('run-tests');
  button.disabled = true;
  button.textContent = 'Running Tests...';

  // Set all tests to pending
  const testElements = document.querySelectorAll('.test-status');
  testElements.forEach(element => {
    element.className = 'test-status pending';
    element.textContent = 'Running...';
  });

  try {
    // Call the test endpoint
    const response = await fetch('/run-tests');
    const results = await response.json();

    // Update test results
    updateTestResults(results);
  } catch (error) {
    console.error('Error running tests:', error);

    // Mark all tests as failed
    testElements.forEach(element => {
      element.className = 'test-status failure';
      element.textContent = 'Failed';
    });
  } finally {
    button.disabled = false;
    button.textContent = 'Run Tests';
  }
}

/**
 * Update test results in the UI
 * @param {Object} results - Test results
 */
function updateTestResults(results) {
  const testElements = document.querySelectorAll('.test-result');

  // Conversation Log Tests
  updateTestResult(testElements[0], results.conversationLog);

  // OpenAI Integration Tests
  updateTestResult(testElements[1], results.openaiIntegration);

  // Quake Server Stats Tests
  updateTestResult(testElements[2], results.quakeServerStats);
}

/**
 * Update a single test result element
 * @param {Element} element - Test result element
 * @param {Object} result - Test result data
 */
function updateTestResult(element, result) {
  const statusElement = element.querySelector('.test-status');

  if (!result) {
    statusElement.className = 'test-status pending';
    statusElement.textContent = 'Pending';
    return;
  }

  if (result.success) {
    statusElement.className = 'test-status success';
    statusElement.textContent = 'Passed';
  } else {
    statusElement.className = 'test-status failure';
    statusElement.textContent = 'Failed';
  }
}
