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

// Update interval in milliseconds
const UPDATE_INTERVAL = 5000; // 5 seconds

// Initialize the page
document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    updateStatus();
    updateFunctionResults();
    
    // Set up periodic updates
    setInterval(updateStatus, UPDATE_INTERVAL);
    setInterval(updateFunctionResults, UPDATE_INTERVAL);
    
    // Set up event listeners
    document.getElementById('run-tests').addEventListener('click', runTests);
    document.getElementById('reset-stats').addEventListener('click', resetStats);
    
    // Set up tab buttons
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons and panes
            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
            
            // Add active class to clicked button and corresponding pane
            button.classList.add('active');
            document.getElementById(`${button.dataset.tab}-results`).classList.add('active');
        });
    });
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
            labels: ['OpenAI', 'Weather', 'Time', 'Wolfram', 'Quake'],
            datasets: [{
                data: [0, 0, 0, 0, 0],
                backgroundColor: [
                    '#43b581', // Green
                    '#7289da', // Blue
                    '#faa61a', // Yellow
                    '#f04747', // Red
                    '#b9bbbe'  // Gray
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#ffffff'
                    }
                }
            }
        }
    });
    
    // Errors chart
    const errorCtx = document.getElementById('error-chart').getContext('2d');
    errorChart = new Chart(errorCtx, {
        type: 'bar',
        data: {
            labels: ['OpenAI', 'Discord', 'Weather', 'Time', 'Wolfram', 'Quake', 'Other'],
            datasets: [{
                label: 'Errors',
                data: [0, 0, 0, 0, 0, 0, 0],
                backgroundColor: '#f04747'
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
                    ticks: {
                        color: '#ffffff'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: '#ffffff'
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

/**
 * Update the function results section with the latest data
 */
async function updateFunctionResults() {
    try {
        const response = await fetch('/function-results');
        const data = await response.json();
        
        if (!data) {
            return;
        }
        
        // Update each tab with its function results
        updateWeatherResults(data.weather || []);
        updateTimeResults(data.time || []);
        updateWolframResults(data.wolfram || []);
        updateQuakeResults(data.quake || []);
    } catch (error) {
        console.error('Error updating function results:', error);
    }
}

/**
 * Update the weather results tab
 * @param {Array} results - Weather function results
 */
function updateWeatherResults(results) {
    const container = document.getElementById('weather-results');
    
    if (results.length === 0) {
        container.innerHTML = '<div class="no-data">No recent weather lookups</div>';
        return;
    }
    
    container.innerHTML = '';
    
    results.forEach(item => {
        const callElement = document.createElement('div');
        callElement.className = 'function-call';
        
        const locationName = item.result.location?.name || item.params.location || 'Unknown';
        const timestamp = new Date(item.timestamp).toLocaleString();
        const isExtended = item.params.extended ? 'Extended Forecast' : 'Current Weather';
        
        callElement.innerHTML = `
            <div class="function-header">
                <span class="function-location">${locationName} (${isExtended})</span>
                <span class="function-time">${timestamp}</span>
            </div>
            <div class="function-params">Query: ${item.params.location}</div>
            <div class="function-details">${item.result.formatted}</div>
        `;
        
        container.appendChild(callElement);
    });
}

/**
 * Update the time results tab
 * @param {Array} results - Time function results
 */
function updateTimeResults(results) {
    const container = document.getElementById('time-results');
    
    if (results.length === 0) {
        container.innerHTML = '<div class="no-data">No recent time lookups</div>';
        return;
    }
    
    container.innerHTML = '';
    
    results.forEach(item => {
        const callElement = document.createElement('div');
        callElement.className = 'function-call';
        
        const locationName = item.result.location || item.params.location || 'Unknown';
        const timestamp = new Date(item.timestamp).toLocaleString();
        
        callElement.innerHTML = `
            <div class="function-header">
                <span class="function-location">${locationName}</span>
                <span class="function-time">${timestamp}</span>
            </div>
            <div class="function-params">Timezone: ${item.result.timezone || 'Unknown'}</div>
            <div class="function-details">${item.result.formatted}</div>
        `;
        
        container.appendChild(callElement);
    });
}

/**
 * Update the Wolfram results tab
 * @param {Array} results - Wolfram function results
 */
function updateWolframResults(results) {
    const container = document.getElementById('wolfram-results');
    
    if (results.length === 0) {
        container.innerHTML = '<div class="no-data">No recent Wolfram Alpha queries</div>';
        return;
    }
    
    container.innerHTML = '';
    
    results.forEach(item => {
        const callElement = document.createElement('div');
        callElement.className = 'function-call';
        
        const query = item.params.query || 'Unknown query';
        const timestamp = new Date(item.timestamp).toLocaleString();
        
        callElement.innerHTML = `
            <div class="function-header">
                <span class="function-location">${query}</span>
                <span class="function-time">${timestamp}</span>
            </div>
            <div class="function-details">${item.result.formatted || JSON.stringify(item.result, null, 2)}</div>
        `;
        
        container.appendChild(callElement);
    });
}

/**
 * Update the Quake results tab
 * @param {Array} results - Quake function results
 */
function updateQuakeResults(results) {
    const container = document.getElementById('quake-results');
    
    if (results.length === 0) {
        container.innerHTML = '<div class="no-data">No recent Quake server stats</div>';
        return;
    }
    
    container.innerHTML = '';
    
    results.forEach(item => {
        const callElement = document.createElement('div');
        callElement.className = 'function-call';
        
        const server = item.params.server || 'Unknown server';
        const timestamp = new Date(item.timestamp).toLocaleString();
        
        callElement.innerHTML = `
            <div class="function-header">
                <span class="function-location">${server}</span>
                <span class="function-time">${timestamp}</span>
            </div>
            <div class="function-details">${item.result.formatted || JSON.stringify(item.result, null, 2)}</div>
        `;
        
        container.appendChild(callElement);
    });
}

/**
 * Update the status page with the latest data
 */
async function updateStatus() {
    try {
        const response = await fetch('/health');
        const data = await response.json();
        
        if (!data) {
            setStatusIndicator('offline');
            return;
        }
        
        // Update bot name in title and header
        const botName = data.name || 'Bot';
        document.getElementById('page-title').textContent = `${botName} Status`;
        document.getElementById('bot-name-header').textContent = `${botName} Status`;
        
        // Update status indicator
        setStatusIndicator(data.status);
        
        // Update overview stats
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('version').textContent = data.version;
        document.getElementById('message-count').textContent = data.stats.messageCount.toLocaleString();
        document.getElementById('discord-ping').textContent = `${data.discord.ping} ms`;
        
        // Update API calls
        updateApiCalls(data.stats.apiCalls);
        
        // Update errors
        updateErrors(data.stats.errors);
        
        // Update memory usage
        updateMemoryUsage(data.memory, data.system);
        
        // Update rate limits
        document.getElementById('rate-limit-hits').textContent = data.stats.rateLimits.count.toLocaleString();
        document.getElementById('rate-limit-users').textContent = data.stats.rateLimits.uniqueUsers.toLocaleString();
        
        // Update rate limited users list
        updateRateLimitedUsers(data.stats.rateLimits.userDetails);
        
        // Update last updated time
        document.getElementById('last-updated').textContent = new Date().toLocaleString();
    } catch (error) {
        console.error('Error fetching health data:', error);
        setStatusIndicator('offline');
    }
}

/**
 * Set the status indicator based on the current status
 * @param {string} status - Current status (ok, warning, error)
 */
function setStatusIndicator(status) {
    const dot = document.querySelector('.dot');
    const statusText = document.querySelector('.status-text');
    
    dot.className = 'dot';
    
    switch (status) {
        case 'ok':
            dot.classList.add('online');
            statusText.textContent = 'Online';
            break;
        case 'warning':
            dot.classList.add('warning');
            statusText.textContent = 'Warning';
            break;
        case 'error':
        case 'offline':
            dot.classList.add('offline');
            statusText.textContent = 'Offline';
            break;
        default:
            statusText.textContent = 'Unknown';
    }
}

/**
 * Update API call statistics
 * @param {Object} apiCalls - API call counts by service
 */
function updateApiCalls(apiCalls) {
    // Update individual counters
    document.getElementById('openai-calls').textContent = apiCalls.openai.toLocaleString();
    document.getElementById('weather-calls').textContent = apiCalls.weather.toLocaleString();
    document.getElementById('time-calls').textContent = apiCalls.time.toLocaleString();
    document.getElementById('wolfram-calls').textContent = apiCalls.wolfram.toLocaleString();
    document.getElementById('quake-calls').textContent = apiCalls.quake.toLocaleString();
    
    // Update chart
    apiChart.data.datasets[0].data = [
        apiCalls.openai,
        apiCalls.weather,
        apiCalls.time,
        apiCalls.wolfram,
        apiCalls.quake
    ];
    apiChart.update();
}

/**
 * Update error statistics
 * @param {Object} errors - Error counts by service
 */
function updateErrors(errors) {
    // Update individual counters
    document.getElementById('openai-errors').textContent = errors.openai.toLocaleString();
    document.getElementById('discord-errors').textContent = errors.discord.toLocaleString();
    document.getElementById('weather-errors').textContent = errors.weather.toLocaleString();
    document.getElementById('other-errors').textContent = errors.other.toLocaleString();
    
    // Update chart
    errorChart.data.datasets[0].data = [
        errors.openai,
        errors.discord,
        errors.weather,
        errors.time,
        errors.wolfram,
        errors.quake,
        errors.other
    ];
    errorChart.update();
}

/**
 * Update memory usage displays
 * @param {Object} memory - Memory usage data
 * @param {Object} system - System information
 */
function updateMemoryUsage(memory, system) {
    // Parse memory values
    const heapUsed = parseInt(memory.heapUsed);
    const heapTotal = parseInt(memory.heapTotal);
    const rss = parseInt(memory.rss);
    const systemFree = parseInt(system.freeMemory);
    const systemTotal = parseInt(system.totalMemory);
    
    // Calculate percentages
    const heapPercent = (heapUsed / heapTotal) * 100;
    const systemPercent = ((systemTotal - systemFree) / systemTotal) * 100;
    
    // Update progress bars
    document.getElementById('heap-used-bar').style.width = `${heapPercent}%`;
    document.getElementById('heap-used').textContent = memory.heapUsed;
    
    document.getElementById('rss-bar').style.width = `${(rss / systemTotal) * 100}%`;
    document.getElementById('rss').textContent = memory.rss;
    
    document.getElementById('system-memory-bar').style.width = `${systemPercent}%`;
    document.getElementById('system-memory').textContent = `${systemTotal - systemFree} / ${systemTotal}`;
}

/**
 * Format uptime in days, hours, minutes, seconds
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime string
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    
    return parts.join(' ');
}

/**
 * Update the rate limited users list
 * 
 * @param {Object} userDetails - User-specific rate limit counts
 */
function updateRateLimitedUsers(userDetails) {
    const userListElement = document.getElementById('rate-limited-users-list');
    
    // Clear existing content
    userListElement.innerHTML = '';
    
    // Get user IDs and sort by count (highest first)
    const userIds = Object.keys(userDetails);
    
    if (userIds.length === 0) {
        userListElement.innerHTML = '<div class="no-data">No rate limited users</div>';
        return;
    }
    
    // Sort users by their rate limit count (highest first)
    userIds.sort((a, b) => userDetails[b] - userDetails[a]);
    
    // Add each user to the list
    userIds.forEach(userId => {
        const count = userDetails[userId];
        const userItem = document.createElement('div');
        userItem.className = 'user-item';
        userItem.innerHTML = `
            <span class="user-id">${userId}</span>
            <span class="user-count">${count}</span>
        `;
        userListElement.appendChild(userItem);
    });
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
            method: 'POST'
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
