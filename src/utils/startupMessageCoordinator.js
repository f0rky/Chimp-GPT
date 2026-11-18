/**
 * Startup Message Coordinator for ChimpGPT
 *
 * Coordinates private daily server-monitoring messages:
 * - Sends the bot owner one monitoring message per Auckland calendar day
 * - Reuses and edits that message across restarts and scheduled updates
 * - Shows last shutdown reason in the monitoring embed
 *
 * @module startupMessageCoordinator
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../core/logger');
const logger = createLogger('startup');

const STATE_FILE = path.join(__dirname, '../../data/startup-state.json');

// In-memory state
let startupMessageRef = null;
const contributingComponents = new Set();
let messageSent = false;
const embeds = [];
let sessionStartTime = new Date();
let currentRestartCount = 0;
let sessionInitialized = false;

function nextRestartCount(state = {}) {
  const previousCount = Number(state.restartCount);
  return Number.isSafeInteger(previousCount) && previousCount >= 0 ? previousCount + 1 : 1;
}

function initializeSession(state = {}, now = new Date()) {
  if (!sessionInitialized) {
    sessionStartTime = now;
    currentRestartCount = nextRestartCount(state);
    sessionInitialized = true;
  }
  return { sessionStartTime, restartCount: currentRestartCount };
}

function lifecycleFields({ includeLastChecked = false } = {}) {
  const fields = [
    {
      name: 'Started at',
      value: sessionStartTime.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }),
      inline: true,
    },
    {
      name: 'Restart number',
      value: String(currentRestartCount || 1),
      inline: true,
    },
  ];
  if (includeLastChecked) {
    fields.push({
      name: 'Last checked',
      value: new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }),
      inline: true,
    });
  }
  return fields;
}

function getMonitoringDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    logger.warn({ error: e.message }, 'Could not load startup state');
  }
  return {};
}

function saveState(patch) {
  try {
    const current = loadState();
    const updated = { ...current, ...patch };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(updated, null, 2));
  } catch (e) {
    logger.warn({ error: e.message }, 'Could not save startup state');
  }
}

// ─── Dying Gasp ──────────────────────────────────────────────────────────────

/**
 * Called on shutdown — edits the startup message with shutdown reason.
 * Best-effort: never throws.
 *
 * @param {string} reason - Shutdown reason (e.g. 'SIGTERM', 'crash', 'restart command')
 * @param {Error} [error] - Optional error if it was a crash
 */
async function dyingGasp(reason, error) {
  const uptime = Math.round((Date.now() - sessionStartTime.getTime()) / 1000);
  const uptimeStr =
    uptime < 60
      ? `${uptime}s`
      : uptime < 3600
        ? `${Math.floor(uptime / 60)}m ${uptime % 60}s`
        : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

  saveState({
    lastShutdownReason: reason,
    lastShutdownTime: new Date().toISOString(),
    lastShutdownError: error ? error.message : null,
    lastSessionUptime: uptimeStr,
  });

  if (!startupMessageRef) return;

  try {
    await startupMessageRef.edit({
      embeds: [
        {
          title: '🔴 Solvis Offline',
          description: `Session ended: **${reason}**${error ? `\n\`${error.message}\`` : ''}`,
          fields: [
            { name: 'Session Uptime', value: uptimeStr, inline: true },
            {
              name: 'Stopped At',
              value: new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }),
              inline: true,
            },
          ],
          color: 0xff4444,
          timestamp: new Date(),
        },
      ],
    });
    logger.info({ reason }, 'Dying gasp sent');
  } catch (e) {
    logger.warn({ error: e.message }, 'Dying gasp edit failed');
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

function registerComponent(componentName) {
  contributingComponents.add(componentName);
  logger.info(`Component ${componentName} registered for startup message`);
}

function addEmbed(componentName, embed) {
  if (!contributingComponents.has(componentName)) {
    logger.warn(`Component ${componentName} tried to add embed but is not registered`);
    return false;
  }
  embeds.push(embed);
  logger.info(`Embed added from component ${componentName}`);
  return true;
}

/**
 * Create or reuse the bot owner's monitoring message for the current Auckland
 * day. This is private by design; server channels never receive health reports.
 *
 * @param {import('discord.js').User} owner
 * @returns {Promise<boolean>}
 */
let monitoringCreation = null;

function ensureDailyMonitoringMessage(owner) {
  if (!monitoringCreation) {
    monitoringCreation = createDailyMonitoringMessage(owner).finally(() => {
      monitoringCreation = null;
    });
  }
  return monitoringCreation;
}

async function createDailyMonitoringMessage(owner) {
  if (!owner) {
    logger.error('Cannot create daily monitoring message: owner is undefined');
    return false;
  }

  const state = loadState();
  initializeSession(state);
  const monitoringDate = getMonitoringDate();
  const lastShutdown = state.lastShutdownReason
    ? `**Last session:** ${state.lastShutdownReason}${state.lastShutdownError ? ` — \`${state.lastShutdownError}\`` : ''} *(uptime: ${state.lastSessionUptime || '?'})*`
    : null;
  const startingEmbed = {
    title: '🟡 Solvis Starting Up...',
    description: ['Initializing systems...', lastShutdown].filter(Boolean).join('\n'),
    color: 0xffaa00,
    fields: lifecycleFields(),
    timestamp: new Date(),
  };

  try {
    const dmChannel = owner.dmChannel || (await owner.createDM());
    if (state.monitoringDate === monitoringDate && state.messageId) {
      const existing = await dmChannel.messages.fetch(state.messageId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [startingEmbed] });
        startupMessageRef = existing;
        saveState({
          monitoringDate,
          sessionStartTime: sessionStartTime.toISOString(),
          restartCount: currentRestartCount,
          lastShutdownReason: null,
          lastShutdownTime: null,
          lastShutdownError: null,
          lastSessionUptime: null,
        });
        messageSent = true;
        logger.info({ monitoringDate }, 'Reused daily server monitoring message in owner DM');
        return true;
      }
    }

    startupMessageRef = await owner.send({ embeds: [startingEmbed] });
    saveState({
      messageId: startupMessageRef.id,
      channelId: startupMessageRef.channel.id,
      monitoringDate,
      sessionStartTime: sessionStartTime.toISOString(),
      restartCount: currentRestartCount,
      lastShutdownReason: null,
      lastShutdownTime: null,
      lastShutdownError: null,
      lastSessionUptime: null,
    });
    messageSent = true;
    logger.info({ monitoringDate }, 'Posted new daily server monitoring message to owner DM');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to create or reuse daily server monitoring message');
    return false;
  }
}

async function sendStartupMessage(owner) {
  if (messageSent) return true;
  return ensureDailyMonitoringMessage(owner);
}

async function updateStartupMessage() {
  if (!startupMessageRef) {
    logger.error('Cannot update startup message: no message reference');
    return false;
  }
  try {
    const finalEmbed = {
      title: '🟢 Solvis Online',
      color: 0x00cc66,
      timestamp: new Date(),
      fields: lifecycleFields(),
    };

    // Merge in any component embeds as fields
    const allEmbeds = embeds.length > 0 ? embeds : [finalEmbed];
    // Put the online status embed first
    if (embeds.length > 0) allEmbeds.unshift(finalEmbed);

    await startupMessageRef.edit({ embeds: allEmbeds.slice(0, 10) }); // Discord max 10 embeds
    logger.info('Startup message updated to Online');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to update startup message');
    return false;
  }
}

/**
 * Replace the health portion of this process's monitoring message. Scheduled
 * reports call this instead of posting a new Discord message.
 *
 * @param {string} report
 * @returns {Promise<boolean>}
 */
async function updateHealthReport(report) {
  if (!startupMessageRef) {
    logger.error('Cannot update health report: no monitoring message reference');
    return false;
  }

  try {
    const safeReport = String(report || 'No health data available.').slice(0, 4096);
    await startupMessageRef.edit({
      embeds: [
        {
          title: '🟢 Solvis Online',
          color: 0x00cc66,
          timestamp: new Date(),
          fields: lifecycleFields({ includeLastChecked: true }),
        },
        {
          title: '📊 Server Monitoring',
          description: safeReport,
          color: 0x00cc66,
          timestamp: new Date(),
        },
      ],
    });
    logger.info('Updated server monitoring message in place');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to update server monitoring message');
    return false;
  }
}

function reset() {
  startupMessageRef = null;
  contributingComponents.clear();
  messageSent = false;
  embeds.length = 0;
  sessionStartTime = new Date();
  currentRestartCount = 0;
  sessionInitialized = false;
  logger.info('Startup message coordinator reset');
}

module.exports = {
  registerComponent,
  addEmbed,
  sendStartupMessage,
  ensureDailyMonitoringMessage,
  updateStartupMessage,
  updateHealthReport,
  dyingGasp,
  reset,
  getMonitoringDate,
  _test: { nextRestartCount, initializeSession, lifecycleFields },
  get messageRef() {
    return startupMessageRef;
  },
  get hasMessage() {
    return messageSent;
  },
};
