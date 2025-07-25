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

  // Set up auto-refresh (optimized from 5s to 10s for bandwidth efficiency)
  updateInterval = setInterval(loadPerformanceData, 10000);

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

    // Create cells with secure DOM methods
    const opCell = document.createElement('td');
    opCell.textContent = formattedOp;

    const countCell = document.createElement('td');
    countCell.textContent = metrics.count;

    const avgCell = document.createElement('td');
    avgCell.textContent = `${metrics.avg}ms`;

    const p95Cell = document.createElement('td');
    p95Cell.textContent = `${metrics.p95}ms`;

    const maxCell = document.createElement('td');
    maxCell.textContent = `${metrics.max}ms`;

    row.appendChild(opCell);
    row.appendChild(countCell);
    row.appendChild(avgCell);
    row.appendChild(p95Cell);
    row.appendChild(maxCell);

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

    // Create accordion header
    const accordionHeader = document.createElement('h2');
    accordionHeader.className = 'accordion-header';

    const accordionButton = document.createElement('button');
    accordionButton.className = 'accordion-button collapsed';
    accordionButton.type = 'button';
    accordionButton.setAttribute('data-bs-toggle', 'collapse');
    accordionButton.setAttribute('data-bs-target', `#collapse-${op}`);
    accordionButton.textContent = `${formattedOp} (${metrics.count} calls)`;

    accordionHeader.appendChild(accordionButton);

    // Create accordion collapse div
    const accordionCollapse = document.createElement('div');
    accordionCollapse.id = `collapse-${op}`;
    accordionCollapse.className = 'accordion-collapse collapse';

    // Create accordion body
    const accordionBody = document.createElement('div');
    accordionBody.className = 'accordion-body';

    // Create metrics table
    const metricsTable = document.createElement('table');
    metricsTable.className = 'table table-sm';

    // Create table header
    const tableHeaderRow = document.createElement('tr');
    const metricHeader = document.createElement('th');
    metricHeader.textContent = 'Metric';
    const valueHeader = document.createElement('th');
    valueHeader.textContent = 'Value';
    tableHeaderRow.appendChild(metricHeader);
    tableHeaderRow.appendChild(valueHeader);
    metricsTable.appendChild(tableHeaderRow);

    // Create metric rows
    const metricData = [
      ['Count', metrics.count],
      ['Minimum', `${Math.round(metrics.min)}ms`],
      ['Maximum', `${Math.round(metrics.max)}ms`],
      ['Average', `${Math.round(metrics.avg)}ms`],
      ['Median', `${Math.round(metrics.median)}ms`],
      ['95th Percentile', `${Math.round(metrics.p95)}ms`],
      ['99th Percentile', `${Math.round(metrics.p99)}ms`],
    ];

    metricData.forEach(([metric, value]) => {
      const row = document.createElement('tr');
      const metricCell = document.createElement('td');
      metricCell.textContent = metric;
      const valueCell = document.createElement('td');
      valueCell.textContent = value;
      row.appendChild(metricCell);
      row.appendChild(valueCell);
      metricsTable.appendChild(row);
    });

    accordionBody.appendChild(metricsTable);

    // Create Recent Calls section
    const recentCallsHeader = document.createElement('h6');
    recentCallsHeader.textContent = 'Recent Calls';
    accordionBody.appendChild(recentCallsHeader);

    const recentCallsContainer = document.createElement('div');
    recentCallsContainer.className = 'recent-calls-container';

    const recentCallsTable = document.createElement('table');
    recentCallsTable.className = 'table table-sm table-striped';

    // Create recent calls table header
    const recentHeaderRow = document.createElement('tr');
    const timeHeader = document.createElement('th');
    timeHeader.textContent = 'Time';
    const durationHeader = document.createElement('th');
    durationHeader.textContent = 'Duration';
    const detailsHeader = document.createElement('th');
    detailsHeader.textContent = 'Details';
    recentHeaderRow.appendChild(timeHeader);
    recentHeaderRow.appendChild(durationHeader);
    recentHeaderRow.appendChild(detailsHeader);
    recentCallsTable.appendChild(recentHeaderRow);

    // Add recent timing rows
    createRecentCallsRows(metrics.recentTimings, recentCallsTable);

    recentCallsContainer.appendChild(recentCallsTable);
    accordionBody.appendChild(recentCallsContainer);

    accordionCollapse.appendChild(accordionBody);
    accordionItem.appendChild(accordionHeader);
    accordionItem.appendChild(accordionCollapse);

    detailedBody.appendChild(accordionItem);
  }
}

/**
 * Create DOM rows for recent calls
 *
 * @param {Array} recentTimings - Array of recent timing data
 * @param {HTMLElement} table - Table element to append rows to
 */
function createRecentCallsRows(recentTimings, table) {
  if (!recentTimings || recentTimings.length === 0) {
    const noDataRow = document.createElement('tr');
    const noDataCell = document.createElement('td');
    noDataCell.colSpan = 3;
    noDataCell.textContent = 'No recent calls';
    noDataRow.appendChild(noDataCell);
    table.appendChild(noDataRow);
    return;
  }

  recentTimings.forEach(timing => {
    const timestamp = new Date(timing.timestamp).toLocaleTimeString();
    const duration = Math.round(timing.duration);

    const row = document.createElement('tr');

    // Add warning class for slow operations
    if (duration > 3000) {
      row.className = 'table-danger';
    } else if (duration > 1000) {
      row.className = 'table-warning';
    }

    // Time cell
    const timeCell = document.createElement('td');
    timeCell.textContent = timestamp;

    // Duration cell
    const durationCell = document.createElement('td');
    durationCell.textContent = `${duration}ms`;

    // Details cell
    const detailsCell = document.createElement('td');

    if (timing.metadata) {
      // Create metadata elements
      Object.entries(timing.metadata).forEach(([key, value], index) => {
        if (index > 0) {
          detailsCell.appendChild(document.createElement('br'));
        }

        const strongElement = document.createElement('strong');
        strongElement.textContent = `${key}:`;
        detailsCell.appendChild(strongElement);

        // Truncate long values
        const displayValue =
          typeof value === 'string' && value.length > 50 ? value.substring(0, 47) + '...' : value;

        detailsCell.appendChild(document.createTextNode(` ${displayValue}`));
      });
    }

    row.appendChild(timeCell);
    row.appendChild(durationCell);
    row.appendChild(detailsCell);

    table.appendChild(row);
  });
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
});

// Initialize when the DOM is ready
document.addEventListener('DOMContentLoaded', initPerformanceMonitoring);
