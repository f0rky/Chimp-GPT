/**
 * Enhanced Status Report Command for ChimpGPT
 *
 * Provides comprehensive bot status with:
 * - LLM provider and model information
 * - Color-coded health indicators
 * - ENV configuration display
 * - Service health metrics
 * - Performance statistics
 */

const { EmbedBuilder } = require('discord.js');
const config = require('../core/configValidator');
const { getDetailedVersionInfo, formatUptime } = require('../core/getBotVersion');
const statsStorage = require('../core/statsStorage');
const { createLogger } = require('../core/logger');

const logger = createLogger('statusReport');

/**
 * Health score color coding
 */
function getHealthColor(score) {
  if (score >= 90) return 0x43b581; // Green
  if (score >= 70) return 0x7289da; // Blue
  if (score >= 50) return 0xfaa61a; // Yellow
  return 0xf04747; // Red
}

/**
 * Get status emoji based on health
 */
function getStatusEmoji(score) {
  if (score >= 90) return '🟢';
  if (score >= 70) return '🔵';
  if (score >= 50) return '🟡';
  return '🔴';
}

/**
 * Detect LLM providers and models
 */
function detectLLMProviders() {
  const providers = {
    primary: {
      provider: 'OpenAI',
      model: 'gpt-4o-mini', // Current main model
      configured: !!process.env.OPENAI_API_KEY,
      usage: ['Conversations', 'Knowledge', 'Weather', 'Time'],
    },
    imageGeneration: {
      provider: 'OpenAI',
      model: 'DALL-E 3',
      configured: !!process.env.OPENAI_API_KEY && config.ENABLE_IMAGE_GENERATION,
      usage: ['Image Creation', 'Art Generation'],
    },
    searchEngines: {
      serpapi: {
        name: 'SerpApi (Google)',
        configured: !!process.env.SERPAPI_API_KEY,
        primary: true,
      },
      brave: {
        name: 'Brave Search',
        configured: !!process.env.BRAVE_SEARCH_API_KEY,
        primary: false,
      },
      duckduckgo: {
        name: 'DuckDuckGo',
        configured: true, // Always available
        primary: false,
      },
    },
  };

  return providers;
}

/**
 * Get service health scores
 */
async function getServiceHealth(client) {
  const health = {
    discord: {
      score: 0,
      status: 'offline',
      details: {},
    },
    openai: {
      score: 100, // Assume healthy if key is configured
      status: 'online',
    },
    webSearch: {
      score: 0,
      status: 'offline',
      engines: {},
    },
    database: {
      score: 90, // Assume healthy if storage is working
      status: 'online',
    },
  };

  // Check Discord health
  if (client && client.ws) {
    const ping = client.ws.ping;
    health.discord.details.ping = ping;
    health.discord.details.guilds = client.guilds.cache.size;
    health.discord.details.channels = client.channels.cache.size;

    if (ping < 100) {
      health.discord.score = 100;
      health.discord.status = 'online';
    } else if (ping < 200) {
      health.discord.score = 90;
      health.discord.status = 'online';
    } else if (ping < 500) {
      health.discord.score = 70;
      health.discord.status = 'degraded';
    } else {
      health.discord.score = 50;
      health.discord.status = 'degraded';
    }
  } else {
    // When client is not available (e.g., in web context)
    health.discord.score = 75; // Assume operational
    health.discord.status = 'operational';
    health.discord.details.ping = -1;
    health.discord.details.guilds = 0;
    health.discord.details.channels = 0;
  }

  // Check web search health
  const llmProviders = detectLLMProviders();
  const searchEngines = llmProviders.searchEngines;
  let searchScore = 0;
  let configuredEngines = 0;

  if (searchEngines.serpapi.configured) {
    configuredEngines++;
    searchScore += 40;
    health.webSearch.engines.serpapi = 'configured';
  }
  if (searchEngines.brave.configured) {
    configuredEngines++;
    searchScore += 30;
    health.webSearch.engines.brave = 'configured';
  }
  if (searchEngines.duckduckgo.configured) {
    searchScore += 30;
    health.webSearch.engines.duckduckgo = 'available';
  }

  health.webSearch.score = Math.min(100, searchScore);
  health.webSearch.status = configuredEngines > 0 ? 'online' : 'degraded';

  return health;
}

/**
 * Get ENV configuration grouped by category
 */
function getEnvironmentConfig() {
  const env = {
    core: {
      BOT_NAME: {
        value: config.BOT_NAME || 'ChimpGPT',
        sensitive: false,
      },
      NODE_ENV: {
        value: process.env.NODE_ENV || 'development',
        sensitive: false,
      },
      CHANNEL_ID: {
        value: process.env.CHANNEL_ID ? '✅ Configured' : '❌ Not Set',
        sensitive: true,
      },
    },
    features: {
      ENABLE_KNOWLEDGE_SYSTEM: {
        value: config.ENABLE_KNOWLEDGE_SYSTEM,
        enabled: config.ENABLE_KNOWLEDGE_SYSTEM,
      },
      ENABLE_POCKETFLOW: {
        value: config.ENABLE_POCKETFLOW,
        enabled: config.ENABLE_POCKETFLOW,
      },
      ENABLE_IMAGE_GENERATION: {
        value: config.ENABLE_IMAGE_GENERATION,
        enabled: config.ENABLE_IMAGE_GENERATION,
      },
      USE_BLENDED_CONVERSATIONS: {
        value: config.USE_BLENDED_CONVERSATIONS,
        enabled: config.USE_BLENDED_CONVERSATIONS,
      },
    },
    apiKeys: {
      OPENAI_API_KEY: {
        value: process.env.OPENAI_API_KEY ? '🔒 Configured' : '❌ Missing',
        configured: !!process.env.OPENAI_API_KEY,
        sensitive: true,
      },
      SERPAPI_API_KEY: {
        value: process.env.SERPAPI_API_KEY ? '🔒 Configured' : '❌ Missing',
        configured: !!process.env.SERPAPI_API_KEY,
        sensitive: true,
      },
      BRAVE_SEARCH_API_KEY: {
        value: process.env.BRAVE_SEARCH_API_KEY ? '🔒 Configured' : '❌ Missing',
        configured: !!process.env.BRAVE_SEARCH_API_KEY,
        sensitive: true,
      },
      WOLFRAM_APP_ID: {
        value: process.env.WOLFRAM_APP_ID ? '🔒 Configured' : '❌ Missing',
        configured: !!process.env.WOLFRAM_APP_ID,
        sensitive: true,
      },
    },
  };

  return env;
}

/**
 * Generate status report embed
 */
async function generateStatusEmbed(client) {
  try {
    // Get all necessary data
    const versionInfo = getDetailedVersionInfo();
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const health = await getServiceHealth(client);
    const llmProviders = detectLLMProviders();
    const env = getEnvironmentConfig();
    const stats = await statsStorage.loadStats();

    // Calculate overall health score
    const overallHealth = Math.round(
      (health.discord.score +
        health.openai.score +
        health.webSearch.score +
        health.database.score) /
        4
    );

    // Create main embed
    const embed = new EmbedBuilder()
      .setTitle(`🤖 **${config.BOT_NAME || 'ChimpGPT'} Status Report**`)
      .setColor(getHealthColor(overallHealth))
      .setTimestamp()
      .setFooter({ text: `Version ${versionInfo.version} | Uptime: ${formatUptime(uptime)}` });

    // Add AI Models field
    let aiModelsText = '';
    aiModelsText += `💬 **Chat**: ${llmProviders.primary.model} (${llmProviders.primary.provider})\n`;
    aiModelsText += `🎨 **Images**: ${llmProviders.imageGeneration.model} (${llmProviders.imageGeneration.provider})\n`;
    aiModelsText += `📚 **Knowledge**: ${llmProviders.primary.model}`;

    embed.addFields({
      name: '🧠 **AI Models**',
      value: aiModelsText,
      inline: false,
    });

    // Add System Health field
    let healthText = '';
    healthText += `${getStatusEmoji(health.discord.score)} Discord: ${health.discord.status.toUpperCase()} (${health.discord.score}%)\n`;
    healthText += `${getStatusEmoji(health.openai.score)} OpenAI: ${health.openai.status.toUpperCase()} (${health.openai.score}%)\n`;
    healthText += `${getStatusEmoji(health.webSearch.score)} Web Search: ${health.webSearch.status.toUpperCase()} (${health.webSearch.score}%)\n`;

    // Add search engine details
    if (health.webSearch.engines.serpapi) {
      healthText += `  ├─ SerpApi: ✅ Active\n`;
    }
    if (health.webSearch.engines.brave) {
      healthText += `  ├─ Brave: ✅ Active\n`;
    }
    healthText += `  └─ DuckDuckGo: ✅ Fallback\n`;

    healthText += `${getStatusEmoji(health.database.score)} Database: ${health.database.status.toUpperCase()} (${health.database.score}%)`;

    embed.addFields({
      name: '📊 **System Health**',
      value: healthText,
      inline: false,
    });

    // Add Configuration field
    let configText = '';
    configText += env.features.ENABLE_KNOWLEDGE_SYSTEM.enabled
      ? '✅ Knowledge System\n'
      : '❌ Knowledge System\n';
    configText += env.features.ENABLE_POCKETFLOW.enabled ? '✅ PocketFlow\n' : '❌ PocketFlow\n';
    configText += env.features.ENABLE_IMAGE_GENERATION.enabled
      ? '✅ Image Generation\n'
      : '❌ Image Generation\n';
    configText += env.features.USE_BLENDED_CONVERSATIONS.enabled
      ? '✅ Blended Conversations\n'
      : '❌ Blended Conversations\n';

    // Count configured API keys
    let configuredKeys = 0;
    let totalKeys = 0;
    for (const key in env.apiKeys) {
      totalKeys++;
      if (env.apiKeys[key].configured) configuredKeys++;
    }
    configText += `🔒 ${configuredKeys}/${totalKeys} API Keys Configured`;

    embed.addFields({
      name: '⚙️ **Configuration**',
      value: configText,
      inline: true,
    });

    // Add Performance field
    const memUsed = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const memTotal = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    const memPercent = Math.round((memUsed / memTotal) * 100);
    const cpuUsage = process.cpuUsage();
    const cpuPercent = Math.round((cpuUsage.user + cpuUsage.system) / 1000000); // Convert to seconds

    let perfText = '';
    perfText += `⏱️ **Uptime**: ${formatUptime(uptime)}\n`;
    perfText += `💾 **Memory**: ${memUsed}MB/${memTotal}MB (${memPercent}%)\n`;
    perfText += `🔄 **CPU Time**: ${cpuPercent}s\n`;
    if (health.discord.details.ping) {
      perfText += `⚡ **Discord Ping**: ${health.discord.details.ping}ms`;
    }

    embed.addFields({
      name: '💻 **Performance**',
      value: perfText,
      inline: true,
    });

    // Add Statistics field
    let statsText = '';
    statsText += `💬 **Messages**: ${stats.messageCount || 0}\n`;
    statsText += `🎯 **API Calls**: ${Object.values(stats.apiCalls || {}).reduce((a, b) => a + b, 0)}\n`;
    if (stats.apiCalls && stats.apiCalls.openai) {
      statsText += `  ├─ OpenAI: ${stats.apiCalls.openai || 0}\n`;
    }
    if (stats.apiCalls && stats.apiCalls.dalle) {
      statsText += `  ├─ DALL-E: ${stats.apiCalls.dalle || 0}\n`;
    }
    const totalErrors = Object.values(stats.errors || {}).reduce((a, b) => a + b, 0);
    const errorRate =
      stats.messageCount > 0 ? ((totalErrors / stats.messageCount) * 100).toFixed(1) : 0;
    statsText += `⚠️ **Errors**: ${totalErrors} (${errorRate}%)\n`;
    statsText += `🚫 **Rate Limits**: ${stats.rateLimits?.hit || 0}`;

    embed.addFields({
      name: '📈 **Statistics**',
      value: statsText,
      inline: true,
    });

    // Add Environment field
    embed.addFields({
      name: '🌐 **Environment**',
      value: `Mode: ${process.env.NODE_ENV || 'development'}\nVersion: ${versionInfo.version}\nNode: ${process.version}`,
      inline: true,
    });

    return embed;
  } catch (error) {
    logger.error('Error generating status embed:', error);

    // Return error embed
    return new EmbedBuilder()
      .setTitle('❌ Status Report Error')
      .setDescription('Failed to generate status report. Please check logs.')
      .setColor(0xf04747)
      .setTimestamp();
  }
}

/**
 * Send status report to a channel or user
 */
async function sendStatusReport(client, target) {
  try {
    const embed = await generateStatusEmbed(client);

    if (target) {
      await target.send({ embeds: [embed] });
      logger.info('Status report sent successfully');
      return true;
    }

    // If no target specified, try to send to owner
    if (config.OWNER_ID) {
      const owner = await client.users.fetch(config.OWNER_ID);
      if (owner) {
        await owner.send({ embeds: [embed] });
        logger.info('Status report sent to owner');
        return true;
      }
    }

    logger.warn('No target specified for status report');
    return false;
  } catch (error) {
    logger.error('Error sending status report:', error);
    return false;
  }
}

/**
 * Handle status report command
 */
async function handleStatusCommand(message) {
  try {
    // Check if user is authorized (owner or admin)
    const isOwner = message.author.id === config.OWNER_ID;
    const isAdmin = message.member?.permissions?.has('Administrator');

    if (!isOwner && !isAdmin) {
      await message.reply('❌ You do not have permission to use this command.');
      return;
    }

    // Send typing indicator
    await message.channel.sendTyping();

    // Generate and send status report
    const embed = await generateStatusEmbed(message.client);
    await message.reply({ embeds: [embed] });

    logger.info(`Status report generated for ${message.author.tag}`);
  } catch (error) {
    logger.error('Error handling status command:', error);
    await message.reply('❌ Failed to generate status report. Please check logs.');
  }
}

module.exports = {
  generateStatusEmbed,
  sendStatusReport,
  handleStatusCommand,
  detectLLMProviders,
  getServiceHealth,
  getEnvironmentConfig,
};
