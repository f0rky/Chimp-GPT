const assert = require('node:assert/strict');
const test = require('node:test');

const stub = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const log = { info() {}, debug() {}, warn() {}, error() {} };
stub('../../src/core/logger', { createLogger: () => log, discord: log });
stub('../../src/core/healthCheck', { trackError() {} });
stub('../../src/plugins/pluginManager', {});
stub('../../src/commands/deploySlashCommands', () => {});
let approve = false;
let approvalCount = 0;
stub('../../src/utils/humanCircuitBreaker', {
  SENSITIVE_OPERATIONS: { COMMAND_EXECUTION: 'command_execution' },
  executeWithApproval: async (_details, execute) => {
    approvalCount++;
    if (!approve) return { approved: false };
    await execute();
    return { approved: true };
  },
});
let blocked = false;
stub('../../src/utils/maliciousUserManager', { isUserBlocked: () => blocked });
stub('../../src/services/imageGeneration', {});
const commands = require('../../src/commands/commandHandler');
const Handler = require('../../src/core/eventHandlers/interactionEventHandler');
const handler = new Handler({ on() {} }, { CHANNEL_ID: ['allowed'], OWNER_ID: 'owner' });

function interaction(userId, overrides = {}) {
  const result = {
    user: { id: userId, username: 'test' },
    memberPermissions: { has: () => true },
    channel: { isDMBased: () => false },
    channelId: 'allowed',
    isButton: () => false,
    isChatInputCommand: () => true,
    reply: async payload => {
      result.replyPayload = payload;
      result.replied = true;
    },
    deferReply: async () => {
      result.deferred = true;
    },
    editReply: async payload => {
      result.replyPayload = payload;
    },
    ...overrides,
  };
  return result;
}

test('slash approval denies execution, acknowledges promptly, and executes only on approval', async () => {
  let executed = 0;
  commands.registerCommand({
    name: 'approval-test',
    adminOnly: true,
    requiresApproval: true,
    slashCommand: {},
    execute() {},
    interactionExecute: async i => {
      assert.equal(i.deferred, true);
      executed++;
    },
  });
  const denied = interaction('admin', { commandName: 'approval-test' });
  await commands.handleSlashCommand(denied, { OWNER_ID: 'owner' });
  assert.equal(executed, 0);
  assert.equal(denied.deferred, true);
  approve = true;
  await commands.handleSlashCommand(interaction('admin', { commandName: 'approval-test' }), {
    OWNER_ID: 'owner',
  });
  assert.equal(executed, 1);
  assert.equal(approvalCount, 2);
});

test('blocked users and unauthorized channels never reach image execution', async () => {
  let executed = 0;
  commands.registerCommand({
    name: 'image',
    slashCommand: {},
    execute() {},
    interactionExecute: async () => executed++,
  });
  blocked = true;
  const denied = interaction('blocked', { commandName: 'image' });
  await handler.handleInteractionCreate(denied);
  blocked = false;
  await handler.handleInteractionCreate(
    interaction('wrong-channel', { commandName: 'image', channelId: 'other' })
  );
  assert.equal(executed, 0);
  assert.equal(denied.replyPayload.ephemeral, true);
});

test('image buttons and commands share the 3/min image quota independently of ordinary messages', async () => {
  let executions = 0;
  commands.registerCommand({
    name: 'image',
    slashCommand: {},
    execute() {},
    interactionExecute: async () => executions++,
  });
  commands.registerCommand({
    name: 'ping',
    slashCommand: {},
    execute() {},
    interactionExecute: async () => {},
  });
  await handler.handleInteractionCreate(interaction('quota', { commandName: 'ping' }));
  for (let i = 0; i < 3; i++)
    await handler.handleInteractionCreate(interaction('quota', { commandName: 'image' }));
  handler.handleButtonInteraction = async () => {
    executions++;
  };
  const button = interaction('quota', {
    isButton: () => true,
    isChatInputCommand: () => false,
    customId: 'image_remix:fixture',
  });
  await handler.handleInteractionCreate(button);
  assert.equal(executions, 3);
  assert.match(button.replyPayload.content, /rate limit/);
});
