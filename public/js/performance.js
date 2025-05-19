/**
 * Performance Monitoring for ChimpGPT
 *
 * This script retrieves and displays performance metrics from the bot,
 * helping to identify bottlenecks and slow operations.
 */

// Performance data
let updateInterval = null;

// Chart objects for visualization
let apiTimeChart = null;
let processingTimeChart = null;

/**
 * Initialize the performance monitoring dashboard
 */
function initPerformanceMonitoring() {
  // Create charts
  createCharts();

  // Load initial data
  loadPerformanceData();

  // Set up auto-refresh
  updateInterval = setInterval(loadPerformanceData, 5000);

  // Set up UI controls
  document.getElementById('refresh-performance').addEventListener('click', loadPerformanceData);
}

/**
 * Load performance data from the server
 */
function loadPerformanceData() {
  fetch('/performance')
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        updatePerformanceUI(data);
      } else {
        console.error('Error loading performance data:', data.error);
      }
    })
    .catch(error => {
      console.error('Error fetching performance data:', error);
    });
}

/**
 * Update the performance monitoring UI with new data
 *
 * @param {Object} data - Performance data from the server
 */
function updatePerformanceUI(data) {
  // Update timestamp
  const timestamp = new Date(data.timestamp);
  document.getElementById('performance-timestamp').textContent =
    `Last updated: ${timestamp.toLocaleString()}`;

  // Update summary table
  updateSummaryTable(data.summary);

  // Update charts
  updateCharts(data.detailed);

  // Update detailed metrics in the accordion
  updateDetailedMetrics(data.detailed);
}

/**
 * Update the summary table with latest performance metrics
 *
 * @param {Object} summary - Summary performance data
 */
function updateSummaryTable(summary) {
  const tableBody = document.getElementById('performance-summary-body');
  tableBody.innerHTML = '';

  // Add rows for each operation
  for (const op in summary) {
    const metrics = summary[op];

    // Skip operations with no data
    if (!metrics || metrics.count === 0) continue;

    const row = document.createElement('tr');

    // Add warning class for slow operations (> 1 second avg)
    if (metrics.avg > 1000) {
      row.classList.add('table-warning');
    }

    // Add danger class for very slow operations (> 3 seconds avg)
    if (metrics.avg > 3000) {
      row.classList.add('table-danger');
    }

    // Format operation name for readability
    const formattedOp = op
      .replace(/_/g, ' ')
      .replace(/api/g, 'API')
      .replace(/openai/g, 'OpenAI')
      .replace(/\b\w/g, c => c.toUpperCase());

    row.innerHTML = `
      <td>${formattedOp}</td>
      <td>${metrics.count}</td>
      <td>${metrics.avg}ms</td>
      <td>${metrics.p95}ms</td>
      <td>${metrics.max}ms</td>
    `;

    tableBody.appendChild(row);
  }
}

/**
 * Create performance charts
 */
function createCharts() {
  // API response time chart
  const apiChartCtx = document.getElementById('api-time-chart').getContext('2d');
  apiTimeChart = new Chart(apiChartCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Average Response Time (ms)',
          data: [],
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1,
        },
        {
          label: '95th Percentile (ms)',
          data: [],
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 1,
        },
      ],
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Time (ms)',
          },
        },
      },
      plugins: {
        title: {
          display: true,
          text: 'API Response Times',
        },
      },
    },
  });

  // Processing time chart
  const processingChartCtx = document.getElementById('processing-time-chart').getContext('2d');
  processingTimeChart = new Chart(processingChartCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Average Processing Time (ms)',
          data: [],
          backgroundColor: 'rgba(54, 162, 235, 0.2)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1,
        },
        {
          label: '95th Percentile (ms)',
          data: [],
          backgroundColor: 'rgba(255, 159, 64, 0.2)',
          borderColor: 'rgba(255, 159, 64, 1)',
          borderWidth: 1,
        },
      ],
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Time (ms)',
          },
        },
      },
      plugins: {
        title: {
          display: true,
          text: 'Processing Times',
        },
      },
    },
  });
}

/**
 * Update charts with new performance data
 *
 * @param {Object} detailed - Detailed performance metrics
 */
function updateCharts(detailed) {
  // API time chart
  const apiOps = ['openai_api', 'weather_api', 'time_api', 'wolfram_api', 'quake_api'];

  const apiLabels = [];
  const apiAvgData = [];
  const apiP95Data = [];

  apiOps.forEach(op => {
    if (detailed[op] && detailed[op].count > 0) {
      // Format label for readability
      const label = op
        .replace(/_/g, ' ')
        .replace(/api/g, 'API')
        .replace(/openai/g, 'OpenAI')
        .replace(/\b\w/g, c => c.toUpperCase());

      apiLabels.push(label);
      apiAvgData.push(Math.round(detailed[op].avg));
      apiP95Data.push(Math.round(detailed[op].p95));
    }
  });

  apiTimeChart.data.labels = apiLabels;
  apiTimeChart.data.datasets[0].data = apiAvgData;
  apiTimeChart.data.datasets[1].data = apiP95Data;
  apiTimeChart.update();

  // Processing time chart
  const processingOps = [
    'message_processing',
    'function_call',
    'plugin_execution',
    'conversation_management',
    'discord_reply',
  ];

  const procLabels = [];
  const procAvgData = [];
  const procP95Data = [];

  processingOps.forEach(op => {
    if (detailed[op] && detailed[op].count > 0) {
      // Format label for readability
      const label = op.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      procLabels.push(label);
      procAvgData.push(Math.round(detailed[op].avg));
      procP95Data.push(Math.round(detailed[op].p95));
    }
  });

  processingTimeChart.data.labels = procLabels;
  processingTimeChart.data.datasets[0].data = procAvgData;
  processingTimeChart.data.datasets[1].data = procP95Data;
  processingTimeChart.update();
}

/**
 * Update detailed metrics in the accordion
 *
 * @param {Object} detailed - Detailed performance metrics
 */
function updateDetailedMetrics(detailed) {
  const detailedBody = document.getElementById('detailed-metrics-body');
  detailedBody.innerHTML = '';

  // Create a table for each operation
  for (const op in detailed) {
    const metrics = detailed[op];

    // Skip operations with no data
    if (!metrics || metrics.count === 0) continue;

    // Create accordion item
    const accordionItem = document.createElement('div');
    accordionItem.className = 'accordion-item';

    // Format operation name for readability
    const formattedOp = op
      .replace(/_/g, ' ')
      .replace(/api/g, 'API')
      .replace(/openai/g, 'OpenAI')
      .replace(/\b\w/g, c => c.toUpperCase());

    accordionItem.innerHTML = `
      <h2 class="accordion-header">
        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${op}">
          ${formattedOp} (${metrics.count} calls)
        </button>
      </h2>
      <div id="collapse-${op}" class="accordion-collapse collapse">
        <div class="accordion-body">
          <table class="table table-sm">
            <tr>
              <th>Metric</th>
              <th>Value</th>
            </tr>
            <tr><td>Count</td><td>${metrics.count}</td></tr>
            <tr><td>Minimum</td><td>${Math.round(metrics.min)}ms</td></tr>
            <tr><td>Maximum</td><td>${Math.round(metrics.max)}ms</td></tr>
            <tr><td>Average</td><td>${Math.round(metrics.avg)}ms</td></tr>
            <tr><td>Median</td><td>${Math.round(metrics.median)}ms</td></tr>
            <tr><td>95th Percentile</td><td>${Math.round(metrics.p95)}ms</td></tr>
            <tr><td>99th Percentile</td><td>${Math.round(metrics.p99)}ms</td></tr>
          </table>
          <h6>Recent Calls</h6>
          <div class="recent-calls-container">
            <table class="table table-sm table-striped">
              <tr>
                <th>Time</th>
                <th>Duration</th>
                <th>Details</th>
              </tr>
              ${getRecentCallsRows(metrics.recentTimings)}
            </table>
          </div>
        </div>
      </div>
    `;

    detailedBody.appendChild(accordionItem);
  }
}

/**
 * Generate HTML rows for recent calls
 *
 * @param {Array} recentTimings - Array of recent timing data
 * @returns {string} HTML for the table rows
 */
function getRecentCallsRows(recentTimings) {
  if (!recentTimings || recentTimings.length === 0) {
    return '<tr><td colspan="3">No recent calls</td></tr>';
  }

  return recentTimings
    .map(timing => {
      const timestamp = new Date(timing.timestamp).toLocaleTimeString();
      const duration = Math.round(timing.duration);

      // Format metadata as a string
      let metadata = '';
      if (timing.metadata) {
        metadata = Object.entries(timing.metadata)
          .map(([key, value]) => {
            // Truncate long values
            if (typeof value === 'string' && value.length > 50) {
              value = value.substring(0, 47) + '...';
            }
            return `<strong>${key}:</strong> ${value}`;
          })
          .join('<br>');
      }

      // Add warning class for slow operations
      let rowClass = '';
      if (duration > 3000) {
        rowClass = 'table-danger';
      } else if (duration > 1000) {
        rowClass = 'table-warning';
      }

      return `
      <tr class="${rowClass}">
        <td>${timestamp}</td>
        <td>${duration}ms</td>
        <td>${metadata}</td>
      </tr>
    `;
    })
    .join('');
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
});

// Initialize when the DOM is ready
document.addEventListener('DOMContentLoaded', initPerformanceMonitoring);
