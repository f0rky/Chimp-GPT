const os = require('os');
const { getBotVersion } = require('../../core/getBotVersion');
const fs = require('fs');
const path = require('path');

// Helper to get uptime in human-readable format
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// Helper to get recent log lines from the main log file (if available)
function getRecentLogs(logFilePath, maxLines = 10) {
  try {
    const data = fs.readFileSync(logFilePath, 'utf8');
    const lines = data.trim().split('\n');
    return lines.slice(-maxLines).join('\n');
  } catch (err) {
    return 'No recent logs available.';
  }
}

// Owner check utility
function isOwner(userId, config) {
  // config.OWNER_ID or process.env.OWNER_ID can be used
  const ownerId = config?.OWNER_ID || process.env.OWNER_ID;

  // If no owner ID is configured, allow anyone to use the command in development
  if (!ownerId && process.env.NODE_ENV === 'development') {
    return true;
  }

  return userId === ownerId;
}

const logFilePath = path.join(__dirname, '../../logs/chimp-gpt.log'); // Adjust as needed

module.exports = {
  id: 'version',
  name: 'Version & Diagnostics',
  version: '1.0.0',
  description: 'Owner-only version and diagnostics reporting for Chimp-GPT.',
  commands: [
    {
      name: 'version',
      description: 'Show bot version and diagnostics (owner only)',
      aliases: ['ver', 'v', 'about'],
      dmAllowed: true,
      async execute(message, args, config) {
        // Check if the user is the owner
        if (!isOwner(message.author.id, config)) {
          return message.reply('This command is owner-only.');
        }
        const version = getBotVersion();
        const uptime = formatUptime(process.uptime());
        const mem = process.memoryUsage();
        const env = process.env.NODE_ENV || 'development';
        const hostname = os.hostname();
        const statusUrl = `http://localhost:${process.env.PORT || 3006}`;
        // Get loaded plugins from global plugin manager if available
        let loadedPlugins = 'None';
        try {
          const pluginManager = require('../pluginManager');
          if (pluginManager && pluginManager.getPluginMetadata) {
            loadedPlugins =
              Object.values(pluginManager.getPluginMetadata())
                .map(p => `${p.name}@${p.version}`)
                .join(', ') || 'None';
          }
        } catch (err) {
          // If plugin manager is not available, just continue with 'None'
        }
        const logs = getRecentLogs(logFilePath, 10);
        return message.reply({
          content:
            `**Chimp-GPT Version:** ${version}\n` +
            `**Uptime:** ${uptime}\n` +
            `**Environment:** ${env}\n` +
            `**Hostname:** ${hostname}\n` +
            `**Memory:** RSS: ${Math.round(mem.rss / 1024 / 1024)}MB, Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB/${Math.round(mem.heapTotal / 1024 / 1024)}MB\n` +
            `**Status Page:** ${statusUrl}\n` +
            `**Loaded Plugins:** ${loadedPlugins}\n\n` +
            `**Recent Logs:**\n\`\`\`\n${logs}\n\`\`\``,
        });
      },
    },
  ],
  hooks: {
    // No hooks needed for this plugin
  },
};
