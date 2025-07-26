/**
 * Service Discovery Utility
 *
 * Comprehensive service discovery for ChimpGPT bot instances
 * Scans ports 3000-3020 to find active bot services and check their health
 *
 * @module ServiceDiscovery
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../core/logger');
const logger = createLogger('service-discovery');

/**
 * Service Discovery Configuration
 */
const DISCOVERY_CONFIG = {
  // Port range to scan
  PORT_RANGE: {
    START: 3000,
    END: 3020,
  },

  // Timeouts and retry settings
  TIMEOUTS: {
    HEALTH_CHECK: 3000, // 3 seconds per health check
    CONNECT_TIMEOUT: 2000, // 2 seconds connection timeout
    RESPONSE_TIMEOUT: 1000, // 1 second response timeout
  },

  // Concurrent discovery settings
  CONCURRENCY: {
    MAX_PARALLEL: 5, // Max parallel port checks
    BATCH_SIZE: 5, // Process ports in batches
  },

  // Health check endpoints to try
  HEALTH_ENDPOINTS: ['/health', '/api', '/status', '/'],

  // Expected service indicators
  SERVICE_INDICATORS: {
    BOT_NAMES: ['chimpgpt', 'chimp-gpt', 'discord-bot', 'bot'],
    FRAMEWORKS: ['express', 'fastify', 'koa'],
    HEADERS: ['x-powered-by', 'server', 'x-bot-name', 'x-service-name'],
  },
};

/**
 * Port scanner utility using native Node.js net module
 * @param {number} port - Port to check
 * @param {string} host - Host to check (default: localhost)
 * @param {number} timeout - Connection timeout in ms
 * @returns {Promise<boolean>} True if port is open
 */
async function isPortOpen(
  port,
  host = 'localhost',
  timeout = DISCOVERY_CONFIG.TIMEOUTS.CONNECT_TIMEOUT
) {
  return new Promise(resolve => {
    const net = require('net');
    const socket = new net.Socket();

    let isResolved = false;

    const cleanup = () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
      }
    };

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      cleanup();
      resolve(true);
    });

    socket.on('timeout', () => {
      cleanup();
      resolve(false);
    });

    socket.on('error', () => {
      cleanup();
      resolve(false);
    });

    try {
      socket.connect(port, host);
    } catch (error) {
      cleanup();
      resolve(false);
    }
  });
}

/**
 * HTTP health check for a specific port and endpoint
 * @param {number} port - Port to check
 * @param {string} endpoint - Endpoint to check
 * @param {string} host - Host to check
 * @returns {Promise<Object>} Health check result
 */
async function checkEndpointHealth(port, endpoint, host = 'localhost') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DISCOVERY_CONFIG.TIMEOUTS.HEALTH_CHECK);

  try {
    const url = `http://${host}:${port}${endpoint}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/html, */*',
        'User-Agent': 'ChimpGPT-ServiceDiscovery/1.0',
      },
    });

    clearTimeout(timeoutId);

    const responseTime = Date.now();
    const contentType = response.headers.get('content-type') || '';
    const server = response.headers.get('server') || '';
    const poweredBy = response.headers.get('x-powered-by') || '';
    const botName = response.headers.get('x-bot-name') || '';
    const serviceName = response.headers.get('x-service-name') || '';

    let responseData = null;
    let isJson = false;

    try {
      if (contentType.includes('application/json')) {
        responseData = await response.json();
        isJson = true;
      } else {
        // For HTML responses, get a small snippet
        const text = await response.text();
        responseData = text.substring(0, 500);
      }
    } catch (parseError) {
      logger.debug({ port, endpoint, error: parseError.message }, 'Failed to parse response data');
    }

    return {
      port,
      endpoint,
      url,
      accessible: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType,
      server,
      poweredBy,
      botName,
      serviceName,
      isJson,
      responseData,
      responseTime: responseTime - Date.now(),
      headers: Object.fromEntries(response.headers.entries()),
    };
  } catch (error) {
    clearTimeout(timeoutId);

    let errorType = 'unknown';
    if (error.name === 'AbortError') {
      errorType = 'timeout';
    } else if (error.code === 'ECONNREFUSED') {
      errorType = 'connection_refused';
    } else if (error.code === 'ETIMEDOUT') {
      errorType = 'timeout';
    }

    return {
      port,
      endpoint,
      url: `http://${host}:${port}${endpoint}`,
      accessible: false,
      error: error.message,
      errorType,
    };
  }
}

/**
 * Comprehensive service analysis for a specific port
 * @param {number} port - Port to analyze
 * @param {string} host - Host to check
 * @returns {Promise<Object>} Service analysis result
 */
async function analyzeService(port, host = 'localhost') {
  const startTime = Date.now();

  // First check if port is open
  const isOpen = await isPortOpen(port, host);

  if (!isOpen) {
    return {
      port,
      host,
      status: 'closed',
      accessible: false,
      analysisTime: Date.now() - startTime,
    };
  }

  // Port is open, try different endpoints
  const endpointResults = [];

  for (const endpoint of DISCOVERY_CONFIG.HEALTH_ENDPOINTS) {
    const result = await checkEndpointHealth(port, endpoint, host);
    endpointResults.push(result);

    // If we get a successful response, we can break early for efficiency
    if (result.accessible && result.isJson) {
      break;
    }
  }

  // Analyze results to determine service type and health
  const analysis = analyzeServiceResults(port, host, endpointResults);
  analysis.analysisTime = Date.now() - startTime;

  return analysis;
}

/**
 * Analyze endpoint results to determine service characteristics
 * @param {number} port - Port being analyzed
 * @param {string} host - Host being analyzed
 * @param {Array} endpointResults - Results from endpoint checks
 * @returns {Object} Service analysis
 */
function analyzeServiceResults(port, host, endpointResults) {
  const workingEndpoints = endpointResults.filter(r => r.accessible);
  const hasHealthEndpoint = workingEndpoints.some(r => r.endpoint === '/health');
  const hasApiEndpoint = workingEndpoints.some(r => r.endpoint === '/api');

  // Default analysis
  const analysis = {
    port,
    host,
    url: `http://${host}:${port}`,
    status: workingEndpoints.length > 0 ? 'active' : 'unreachable',
    accessible: workingEndpoints.length > 0,
    endpointResults,
    workingEndpoints: workingEndpoints.length,
    totalEndpoints: endpointResults.length,
  };

  if (workingEndpoints.length === 0) {
    return analysis;
  }

  // Use the best endpoint result for detailed analysis
  const bestEndpoint = workingEndpoints.find(r => r.isJson) || workingEndpoints[0];

  // Extract service information
  const serviceInfo = extractServiceInfo(bestEndpoint);

  // Determine service type
  const serviceType = determineServiceType(bestEndpoint, serviceInfo);

  // Check if it's likely a ChimpGPT bot
  const isBotService = isBotLikeService(bestEndpoint, serviceInfo);

  return {
    ...analysis,
    serviceType,
    isBotService,
    botConfidence: calculateBotConfidence(bestEndpoint, serviceInfo),
    serviceInfo: {
      ...serviceInfo,
      bestEndpoint: bestEndpoint.endpoint,
      responseTime: bestEndpoint.responseTime,
      server: bestEndpoint.server,
      poweredBy: bestEndpoint.poweredBy,
    },
    health: {
      hasHealthEndpoint,
      hasApiEndpoint,
      responseTime: bestEndpoint.responseTime,
      status: bestEndpoint.status,
    },
    dashboardUrl: `http://${host}:${port}/#performance`,
    lastChecked: new Date().toISOString(),
  };
}

/**
 * Extract service information from endpoint response
 * @param {Object} endpointResult - Endpoint check result
 * @returns {Object} Extracted service information
 */
function extractServiceInfo(endpointResult) {
  const info = {
    name: 'Unknown Service',
    version: 'unknown',
    type: 'unknown',
    botName: null,
    instanceName: null,
  };

  // Extract from headers
  if (endpointResult.botName) {
    info.botName = endpointResult.botName;
    info.name = endpointResult.botName;
  }

  if (endpointResult.serviceName) {
    info.instanceName = endpointResult.serviceName;
  }

  // Extract from JSON response data
  if (endpointResult.isJson && endpointResult.responseData) {
    const data = endpointResult.responseData;

    if (data.name) {
      info.name = data.name;
      info.botName = data.name;
    }

    if (data.version) {
      info.version = data.version;
    }

    if (data.status) {
      info.status = data.status;
    }

    // ChimpGPT specific fields
    if (data.versionInfo) {
      info.version = data.versionInfo.version || info.version;
      info.environment = data.versionInfo.environment;
      info.author = data.versionInfo.author;
    }

    if (data.discord) {
      info.discordStatus = data.discord.status;
      info.discordGuilds = data.discord.guilds;
    }

    if (data.memory) {
      info.memoryUsage = data.memory;
    }

    if (data.uptime) {
      info.uptime = data.uptime;
      info.formattedUptime = data.formattedUptime;
    }
  }

  return info;
}

/**
 * Determine the type of service based on response characteristics
 * @param {Object} endpointResult - Endpoint check result
 * @param {Object} serviceInfo - Extracted service information
 * @returns {string} Service type
 */
function determineServiceType(endpointResult, serviceInfo) {
  // Check for bot-specific indicators
  if (serviceInfo.botName || serviceInfo.discordStatus) {
    return 'discord-bot';
  }

  // Check server headers
  if (endpointResult.server) {
    const server = endpointResult.server.toLowerCase();
    if (server.includes('express')) return 'express-app';
    if (server.includes('fastify')) return 'fastify-app';
    if (server.includes('nginx')) return 'nginx-proxy';
  }

  // Check powered-by header
  if (endpointResult.poweredBy) {
    const poweredBy = endpointResult.poweredBy.toLowerCase();
    if (poweredBy.includes('express')) return 'express-app';
    if (poweredBy.includes('next.js')) return 'nextjs-app';
  }

  // Check content type and response structure
  if (endpointResult.isJson) {
    const data = endpointResult.responseData;
    if (data && data.health) return 'health-service';
    if (data && data.api) return 'api-service';
  }

  // Check endpoint pattern
  if (endpointResult.endpoint === '/health') return 'health-service';
  if (endpointResult.endpoint === '/api') return 'api-service';

  return 'web-service';
}

/**
 * Check if the service appears to be a bot service
 * @param {Object} endpointResult - Endpoint check result
 * @param {Object} serviceInfo - Extracted service information
 * @returns {boolean} True if likely a bot service
 */
function isBotLikeService(endpointResult, serviceInfo) {
  // Direct indicators
  if (serviceInfo.botName) return true;
  if (serviceInfo.discordStatus) return true;

  // Check response data for bot indicators
  if (endpointResult.isJson && endpointResult.responseData) {
    const data = endpointResult.responseData;
    const dataString = JSON.stringify(data).toLowerCase();

    const botIndicators = ['discord', 'bot', 'guild', 'channel', 'chimp', 'gpt'];
    return botIndicators.some(indicator => dataString.includes(indicator));
  }

  return false;
}

/**
 * Calculate confidence score that this is a ChimpGPT bot instance
 * @param {Object} endpointResult - Endpoint check result
 * @param {Object} serviceInfo - Extracted service information
 * @returns {number} Confidence score 0-100
 */
function calculateBotConfidence(endpointResult, serviceInfo) {
  let confidence = 0;

  // Strong indicators (20 points each)
  if (serviceInfo.botName && serviceInfo.botName.toLowerCase().includes('chimp')) confidence += 20;
  if (serviceInfo.discordStatus) confidence += 20;
  if (endpointResult.endpoint === '/health' && endpointResult.isJson) confidence += 20;

  // Medium indicators (10 points each)
  if (serviceInfo.version && serviceInfo.version !== 'unknown') confidence += 10;
  if (serviceInfo.author) confidence += 10;
  if (serviceInfo.memoryUsage) confidence += 10;

  // Weak indicators (5 points each)
  if (serviceInfo.uptime) confidence += 5;
  if (endpointResult.server && endpointResult.server.includes('Express')) confidence += 5;

  return Math.min(confidence, 100);
}

/**
 * Discover services across the configured port range
 * @param {Object} options - Discovery options
 * @returns {Promise<Object>} Discovery results
 */
async function discoverServices(options = {}) {
  const {
    startPort = DISCOVERY_CONFIG.PORT_RANGE.START,
    endPort = DISCOVERY_CONFIG.PORT_RANGE.END,
    host = 'localhost',
    maxParallel = DISCOVERY_CONFIG.CONCURRENCY.MAX_PARALLEL,
  } = options;

  const startTime = Date.now();
  logger.info({ startPort, endPort, host, maxParallel }, 'Starting service discovery');

  // Generate port list
  const ports = [];
  for (let port = startPort; port <= endPort; port++) {
    ports.push(port);
  }

  // Process ports in parallel batches
  const results = [];
  const batchSize = Math.min(maxParallel, ports.length);

  for (let i = 0; i < ports.length; i += batchSize) {
    const batch = ports.slice(i, i + batchSize);

    logger.debug({ batch: batch.join(',') }, 'Processing port batch');

    const batchPromises = batch.map(port => analyzeService(port, host));
    const batchResults = await Promise.allSettled(batchPromises);

    // Process results
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        logger.warn({ error: result.reason }, 'Failed to analyze service');
      }
    }
  }

  // Filter and categorize results
  const activeServices = results.filter(r => r.accessible);
  const botServices = activeServices.filter(r => r.isBotService);
  const closedPorts = results.filter(r => r.status === 'closed');

  const discoveryTime = Date.now() - startTime;

  const summary = {
    success: true,
    discoveryTime,
    portRange: { start: startPort, end: endPort },
    totalPorts: ports.length,
    activePorts: activeServices.length,
    closedPorts: closedPorts.length,
    botServices: botServices.length,
    timestamp: new Date().toISOString(),
  };

  logger.info(summary, 'Service discovery completed');

  return {
    ...summary,
    services: activeServices,
    botServices: botServices,
    allResults: results,
  };
}

/**
 * Get current bot information for comparison
 * @param {number} currentPort - Current bot's port
 * @returns {Object} Current bot information
 */
function getCurrentBotInfo(currentPort) {
  const config = require('../core/configValidator');

  return {
    name: config.BOT_NAME || process.env.BOT_NAME || 'ChimpGPT',
    port: currentPort || config.PORT || process.env.PORT || 3001,
    instanceName: process.env.PM2_INSTANCE_NAME || 'current',
    url: `http://localhost:${currentPort || config.PORT || 3001}`,
    isCurrent: true,
    status: 'current',
  };
}

module.exports = {
  discoverServices,
  analyzeService,
  isPortOpen,
  checkEndpointHealth,
  getCurrentBotInfo,
  DISCOVERY_CONFIG,
};
