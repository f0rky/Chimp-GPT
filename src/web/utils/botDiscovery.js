/**
 * Bot Discovery Utilities
 *
 * Discovers ChimpGPT instances running via PM2 or Docker
 * and checks their health endpoints.
 *
 * @module botDiscovery
 */

const { createLogger } = require('../../core/logger');
const logger = createLogger('botDiscovery');

/**
 * Extract port from environment variables
 * @param {Object} env - Environment variables object
 * @returns {number|null} Extracted port number or null
 */
function extractPortFromEnv(env) {
  if (env.PORT) return parseInt(env.PORT, 10);
  if (env.STATUS_PORT) return parseInt(env.STATUS_PORT, 10);
  return null;
}

/**
 * Discover ChimpGPT instances running via PM2
 * @returns {Promise<Array>} Array of discovered PM2 bot instances
 */
async function discoverPM2Bots() {
  const { spawn } = require('child_process');
  const { validateCommandArguments } = require('../../utils/securityUtils');

  return new Promise((resolve, reject) => {
    try {
      const args = validateCommandArguments(['pm2', 'jlist'], ['pm2']);
      const pm2Process = spawn(args[0], args.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000,
      });
      let output = '';
      let error = '';

      pm2Process.stdout.on('data', data => {
        output += data.toString();
      });
      pm2Process.stderr.on('data', data => {
        error += data.toString();
      });

      pm2Process.on('close', code => {
        if (code !== 0) {
          reject(new Error(`PM2 command failed: ${error}`));
          return;
        }
        try {
          const processes = JSON.parse(output);
          const chimpBots = processes
            .filter(
              proc =>
                proc.name &&
                (proc.name.toLowerCase().includes('chimpgpt') ||
                  proc.name.toLowerCase().includes('chimp-gpt'))
            )
            .map(proc => {
              const env = proc.pm2_env || {};
              const port = env.PORT || extractPortFromEnv(env.env || {}) || 3001;
              return {
                name: proc.name,
                type: 'pm2',
                status: env.status || 'unknown',
                port: parseInt(port, 10),
                botName: env.BOT_NAME || proc.name,
                uptime: env.pm_uptime ? new Date(env.pm_uptime) : null,
                memory: proc.monit ? Math.round(proc.monit.memory / 1024 / 1024) : null,
                cpu: proc.monit ? proc.monit.cpu : null,
                pid: proc.pid,
                restarts: env.restart_time || 0,
              };
            });
          resolve(chimpBots);
        } catch (parseError) {
          reject(new Error(`Failed to parse PM2 output: ${parseError.message}`));
        }
      });

      pm2Process.on('error', err => {
        reject(new Error(`Failed to execute PM2 command: ${err.message}`));
      });
    } catch (spawnError) {
      reject(new Error(`Failed to spawn PM2 process: ${spawnError.message}`));
    }
  });
}

/**
 * Discover ChimpGPT instances running via Docker
 * @returns {Promise<Array>} Array of discovered Docker bot instances
 */
async function discoverDockerBots() {
  const { spawn } = require('child_process');
  const { validateCommandArguments } = require('../../utils/securityUtils');

  return new Promise(resolve => {
    try {
      const args = validateCommandArguments(['docker', 'ps', '--format', 'json'], ['docker']);
      const dockerProcess = spawn(args[0], args.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000,
      });
      let output = '';
      let error = '';

      dockerProcess.stdout.on('data', data => {
        output += data.toString();
      });
      dockerProcess.stderr.on('data', data => {
        error += data.toString();
      });

      dockerProcess.on('close', code => {
        if (code !== 0) {
          logger.warn({ error }, 'Docker command failed, skipping Docker discovery');
          resolve([]);
          return;
        }
        try {
          const lines = output.trim().split('\n');
          const containers = lines
            .filter(line => line.trim())
            .map(line => JSON.parse(line))
            .filter(
              container =>
                container.Names &&
                (container.Names.toLowerCase().includes('chimpgpt') ||
                  (container.Image && container.Image.toLowerCase().includes('chimpgpt')))
            )
            .map(container => {
              const ports = container.Ports || '';
              const portMatch = ports.match(/0\.0\.0\.0:(\d+)->/);
              const port = portMatch ? parseInt(portMatch[1], 10) : null;
              return {
                name: container.Names,
                type: 'docker',
                status: container.State,
                port,
                botName: container.Names.replace(/^\//, ''),
                image: container.Image,
                created: container.CreatedAt,
                ports,
              };
            });
          resolve(containers);
        } catch (parseError) {
          logger.warn({ error: parseError }, 'Failed to parse Docker output');
          resolve([]);
        }
      });

      dockerProcess.on('error', err => {
        logger.warn({ error: err }, 'Docker command execution failed');
        resolve([]);
      });
    } catch (validationError) {
      logger.warn({ error: validationError }, 'Docker command validation failed');
      resolve([]);
    }
  });
}

/**
 * Check health of a discovered bot instance
 * @param {number} port - Port to check
 * @param {string} botName - Name of the bot
 * @param {string} instanceName - Instance name
 * @returns {Promise<Object>} Health check result
 */
async function checkBotHealth(port, botName, instanceName) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const healthData = await response.json();
      return {
        port,
        botName: healthData.name || botName,
        instanceName,
        status: healthData.status || 'unknown',
        uptime: healthData.uptime || 0,
        formattedUptime: healthData.formattedUptime || '0s',
        version: healthData.version || 'unknown',
        accessible: true,
        url: `http://localhost:${port}`,
        dashboardUrl: `http://localhost:${port}/#performance`,
        lastChecked: new Date().toISOString(),
      };
    }

    return {
      port,
      botName,
      instanceName,
      accessible: false,
      error: `HTTP ${response.status}: ${response.statusText}`,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const errorMessage =
      error.name === 'AbortError'
        ? 'Connection timeout'
        : error.code === 'ECONNREFUSED'
          ? 'Connection refused'
          : error.message;

    return {
      port,
      botName,
      instanceName,
      accessible: false,
      error: errorMessage,
      lastChecked: new Date().toISOString(),
    };
  }
}

module.exports = { discoverPM2Bots, discoverDockerBots, checkBotHealth, extractPortFromEnv };
