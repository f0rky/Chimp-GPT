const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('../src/core/logger');
const logger = createLogger('deployment');

const TIMESTAMP_FILE_PATH = path.join(__dirname, '..', '.last_slash_deployment');
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * Reads the timestamp of the last successful slash command deployment.
 * @returns {Promise<number|null>} Timestamp in milliseconds or null if not found/error.
 */
async function getLastDeploymentTimestamp() {
  try {
    const timestampStr = await fs.readFile(TIMESTAMP_FILE_PATH, 'utf8');
    const timestamp = parseInt(timestampStr, 10);
    return isNaN(timestamp) ? null : timestamp;
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info('Last deployment timestamp file not found. Assuming first deployment.');
    } else {
      logger.error({ error }, 'Error reading last deployment timestamp');
    }
    return null;
  }
}

/**
 * Records the current time as the last successful slash command deployment timestamp.
 * @returns {Promise<void>}
 */
async function recordSuccessfulDeployment() {
  try {
    const now = Date.now();
    await fs.writeFile(TIMESTAMP_FILE_PATH, now.toString(), 'utf8');
    logger.info(`Recorded successful slash command deployment at ${new Date(now).toISOString()}`);
  } catch (error) {
    logger.error({ error }, 'Error writing last deployment timestamp');
  }
}

/**
 * Determines if slash commands should be deployed based on config and last deployment time.
 * @param {Object} config - The application configuration object.
 * @returns {Promise<boolean>} True if deployment should proceed, false otherwise.
 */
async function shouldDeploy(config) {
  if (!config.DEPLOY_COMMANDS) {
    logger.info('Slash command deployment is disabled by config (DEPLOY_COMMANDS=false).');
    return false;
  }

  const lastDeploymentTime = await getLastDeploymentTimestamp();
  if (lastDeploymentTime === null) {
    logger.info('No previous deployment timestamp found. Proceeding with deployment.');
    return true; // First time, or error reading timestamp
  }

  const currentTime = Date.now();
  const timeSinceLastDeployment = currentTime - lastDeploymentTime;

  if (timeSinceLastDeployment >= TWELVE_HOURS_MS) {
    logger.info(
      `Last deployment was more than 12 hours ago (${(timeSinceLastDeployment / (60 * 60 * 1000)).toFixed(1)} hours). Proceeding with deployment.`
    );
    return true;
  }

  logger.info(
    `Skipping slash command deployment. Last deployment was less than 12 hours ago (${(timeSinceLastDeployment / (60 * 60 * 1000)).toFixed(1)} hours).`
  );
  return false;
}

module.exports = {
  shouldDeploy,
  recordSuccessfulDeployment,
  getLastDeploymentTimestamp, // Exporting for potential manual checks or other tools
};
