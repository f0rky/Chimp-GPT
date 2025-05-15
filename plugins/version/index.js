// Version Plugin for Chimp-GPT: Owner-only diagnostics and version reporting
const os = require('os');
const { getBotVersion } = require('../../getBotVersion');
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
      async execute(context, ...args) {
        const { user, config } = context;
        if (!isOwner(user.id, config)) {
          return { content: 'This command is owner-only.' };
        }
        const version = getBotVersion();
        const uptime = formatUptime(process.uptime());
        const mem = process.memoryUsage();
        const env = process.env.NODE_ENV || 'development';
        const hostname = os.hostname();
        const statusUrl = `http://${process.env.STATUS_HOSTNAME || 'localhost'}:${process.env.STATUS_PORT || 3000}`;
        const loadedPlugins = Object.values(context.plugins?.metadata || {}).map(p => `${p.name}@${p.version}`).join(', ') || 'None';
        const logs = getRecentLogs(logFilePath, 10);
        return {
          content:
            `**Chimp-GPT Version:** ${version}\n` +
            `**Uptime:** ${uptime}\n` +
            `**Environment:** ${env}\n` +
            `**Host:** ${hostname}\n` +
            `**Status Page:** ${statusUrl}\n` +
            `**Loaded Plugins:** ${loadedPlugins}\n` +
            `**Memory Usage:** ${(mem.rss / 1024 / 1024).toFixed(1)} MB RSS\n` +
            `**Recent Logs:**\n\`\`\`\n${logs}\n\`\`\``
        };
      }
    }
  ],
  // Optionally add a slash command for Discord.js v14+
  slashCommands: [
    {
      name: 'version',
      description: 'Show bot version and diagnostics (owner only)',
      async execute(interaction, context) {
        const { user, config } = context;
        if (!isOwner(user.id, config)) {
          await interaction.reply({ content: 'This command is owner-only.', ephemeral: true });
          return;
        }
        const version = getBotVersion();
        const uptime = formatUptime(process.uptime());
        const mem = process.memoryUsage();
        const env = process.env.NODE_ENV || 'development';
        const hostname = os.hostname();
        const statusUrl = `http://${process.env.STATUS_HOSTNAME || 'localhost'}:${process.env.STATUS_PORT || 3000}`;
        const loadedPlugins = Object.values(context.plugins?.metadata || {}).map(p => `${p.name}@${p.version}`).join(', ') || 'None';
        const logs = getRecentLogs(logFilePath, 10);
        await interaction.reply({
          content:
            `**Chimp-GPT Version:** ${version}\n` +
            `**Uptime:** ${uptime}\n` +
            `**Environment:** ${env}\n` +
            `**Host:** ${hostname}\n` +
            `**Status Page:** ${statusUrl}\n` +
            `**Loaded Plugins:** ${loadedPlugins}\n` +
            `**Memory Usage:** ${(mem.rss / 1024 / 1024).toFixed(1)} MB RSS\n` +
            `**Recent Logs:**\n\`\`\`\n${logs}\n\`\`\``,
          ephemeral: true
        });
      }
    }
  ]
};
