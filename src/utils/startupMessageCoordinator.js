/**
 * Startup Message Coordinator for ChimpGPT
 *
 * Coordinates startup messages to the bot owner:
 * - Persists the startup message ID across restarts so it can be edited in place
 * - Shows last shutdown reason in the startup embed
 * - Cleans up old bot startup messages in owner DM on startup
 * - Supports dying gasp: edits the message with shutdown reason before process exits
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

// ─── Old message cleanup ──────────────────────────────────────────────────────

/**
 * Delete old bot startup/status messages from the owner DM channel.
 * Skips the current startup message if we just edited it.
 *
 * @param {import('discord.js').User} owner
 * @param {string} [skipMessageId] - ID of the message to keep
 */
async function cleanupOldOwnerMessages(owner, skipMessageId) {
  try {
    const dmChannel = owner.dmChannel || (await owner.createDM());
    const messages = await dmChannel.messages.fetch({ limit: 50 });

    const toDelete = messages.filter(
      m =>
        m.author.bot &&
        m.author.id === dmChannel.client.user.id &&
        m.id !== skipMessageId &&
        m.embeds.length > 0 &&
        (m.embeds[0]?.title?.includes('ChimpGPT') ||
          m.embeds[0]?.title?.includes('Solvis') ||
          m.embeds[0]?.title?.includes('Starting') ||
          m.embeds[0]?.title?.includes('Online') ||
          m.embeds[0]?.title?.includes('Offline') ||
          m.embeds[0]?.title?.includes('Plugin Status') ||
          m.embeds[0]?.title?.includes('Status Report'))
    );

    let deleted = 0;
    for (const [, msg] of toDelete) {
      try {
        await msg.delete();
        deleted++;
      } catch (_) {}
    }

    if (deleted > 0) logger.info({ deleted }, 'Cleaned up old owner startup messages');
  } catch (e) {
    logger.warn({ error: e.message }, 'Could not clean up old owner messages');
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
 * Send (or edit) the startup message to the bot owner.
 * Cleans up old messages first, then tries to edit the last known message.
 *
 * @param {import('discord.js').User} owner
 * @returns {Promise<boolean>}
 */
async function sendStartupMessage(owner) {
  if (messageSent) {
    logger.warn('Attempted to send startup message more than once');
    return false;
  }
  if (!owner) {
    logger.error('Cannot send startup message: owner is undefined');
    return false;
  }

  sessionStartTime = new Date();
  const state = loadState();
  const lastShutdown = state.lastShutdownReason
    ? `**Last session:** ${state.lastShutdownReason}${state.lastShutdownError ? ` — \`${state.lastShutdownError}\`` : ''} *(uptime: ${state.lastSessionUptime || '?'})*`
    : null;

  const startingEmbed = {
    title: '🟡 Solvis Starting Up...',
    description: ['Initializing systems...', lastShutdown].filter(Boolean).join('\n'),
    color: 0xffaa00,
    timestamp: new Date(),
  };

  try {
    // Try to clean up old messages and edit the last one
    let edited = false;

    if (state.messageId && state.channelId) {
      try {
        const dmChannel = owner.dmChannel || (await owner.createDM());
        const oldMsg = await dmChannel.messages.fetch(state.messageId).catch(() => null);
        if (oldMsg) {
          await oldMsg.edit({ embeds: [startingEmbed] });
          startupMessageRef = oldMsg;
          edited = true;
          logger.info('Edited existing startup message in place');
        }
      } catch (e) {
        logger.info('Could not find old startup message, will post fresh');
      }
    }

    // Clean up other old bot messages (but not the one we just edited)
    await cleanupOldOwnerMessages(owner, startupMessageRef?.id);

    // Post fresh if we couldn't edit
    if (!edited) {
      startupMessageRef = await owner.send({ embeds: [startingEmbed] });
      logger.info('Posted fresh startup message to owner');
    }

    // Persist the reference
    saveState({
      messageId: startupMessageRef.id,
      channelId: startupMessageRef.channel.id,
      sessionStartTime: sessionStartTime.toISOString(),
      lastShutdownReason: null,
      lastShutdownTime: null,
      lastShutdownError: null,
      lastSessionUptime: null,
    });

    messageSent = true;
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to send startup message to owner');
    return false;
  }
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
      fields: [
        {
          name: 'Started',
          value: sessionStartTime.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }),
          inline: true,
        },
      ],
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

function reset() {
  startupMessageRef = null;
  contributingComponents.clear();
  messageSent = false;
  embeds.length = 0;
  sessionStartTime = new Date();
  logger.info('Startup message coordinator reset');
}

module.exports = {
  registerComponent,
  addEmbed,
  sendStartupMessage,
  updateStartupMessage,
  dyingGasp,
  reset,
  get messageRef() {
    return startupMessageRef;
  },
  get hasMessage() {
    return messageSent;
  },
};
