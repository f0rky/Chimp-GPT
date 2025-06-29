/**
 * Bot Version Utilities
 *
 * This module provides functions to retrieve version information about the bot
 * and its environment. It reads from package.json and can provide detailed
 * information about the bot's configuration.
 *
 * @module BotVersion
 * @author Brett
 * @version 1.2.2
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get the bot's version from package.json
 *
 * @returns {string} The bot version
 */
function getBotVersion() {
  try {
    const pkgPath = path.join(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

/**
 * Get detailed version information about the bot and its environment
 *
 * @returns {Object} Detailed version information
 */
function getDetailedVersionInfo() {
  const botVersion = getBotVersion();

  // Get package.json information
  let pkg = {};
  try {
    const pkgPath = path.join(__dirname, '../../package.json');
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    // Ignore errors
  }

  // Get OpenAI model information
  let aiModel = 'unknown';
  try {
    // Import and call getOpenAIModel directly for robustness
    const { getOpenAIModel } = require('../services/openaiConfig');
    aiModel = getOpenAIModel();
  } catch (err) {
    // Ignore errors
  }

  return {
    version: botVersion,
    name: pkg.name || 'ChimpGPT',
    description: pkg.description || 'Discord bot with AI capabilities',
    author: pkg.author || 'Brett',
    aiModel: aiModel,
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.release()}`,
    uptime: process.uptime(),
    memory: process.memoryUsage().rss,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format the uptime into a human-readable string
 *
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime string
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

module.exports = {
  getBotVersion,
  getDetailedVersionInfo,
  formatUptime,
};
