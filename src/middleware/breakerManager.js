// breakerManager.js
// Handles circuit breaker notifications and owner approvals

// const { Client, Events } = require('discord.js'); // Unused imports
const { OWNER_ID, CHANNEL_ID } = process.env;
let discordClient = null;

// Track pending approval requests
const pendingRequests = [];
let breakerOpen = false;

function setDiscordClient(client) {
  discordClient = client;
}

async function notifyOwnerBreakerTriggered(reason) {
  if (!discordClient || !OWNER_ID) return;
  try {
    const owner = await discordClient.users.fetch(OWNER_ID.replace(/"/g, ''));
    await owner.send(
      `🚨 *Circuit breaker triggered!*
Reason: ${reason}

You can use /resetbreaker to manually reset the breaker after resolving the issue (e.g., topping up API credits).`
    );
  } catch (err) {
    // fallback to channel notification
    if (CHANNEL_ID && discordClient) {
      try {
        const channel = await discordClient.channels.fetch(CHANNEL_ID);
        await channel.send(
          `🚨 <@${OWNER_ID.replace(/"/g, '')}> Circuit breaker triggered!
Reason: ${reason}`
        );
      } catch {}
    }
  }
}

function queueApprovalRequest(request) {
  pendingRequests.push(request);
}

function getPendingRequests() {
  return pendingRequests;
}

function approveRequest(index) {
  const req = pendingRequests.splice(index, 1)[0];
  if (req && req.resolve) req.resolve();
  return req;
}

function setBreakerOpen(state) {
  breakerOpen = state;
}

function isBreakerOpen() {
  return breakerOpen;
}

function resetBreaker() {
  breakerOpen = false;
  pendingRequests.length = 0;
}

module.exports = {
  setDiscordClient,
  notifyOwnerBreakerTriggered,
  queueApprovalRequest,
  getPendingRequests,
  approveRequest,
  setBreakerOpen,
  isBreakerOpen,
  resetBreaker,
};
