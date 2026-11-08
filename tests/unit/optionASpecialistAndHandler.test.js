'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const simpleFlowStub = require('../helpers/simpleFlowStubs');
const originalLoad = Module._load;
const savedEnv = { ...process.env };
process.env.NODE_ENV = 'test';
Module._load = function (request, parent, isMain) {
  const stub = simpleFlowStub(request, parent);
  if (stub !== undefined) return stub;
  if (request === './KnowledgeFlow' && parent?.filename.includes('SimpleChimpGPTFlow'))
    return class KnowledgeFlow {
      processKnowledgeRequest(message) {
        this.recorded = message.content;
        return Promise.resolve({ success: true, response: 'Knowledge answer' });
      }
    };
  if (request === '../../core/logger' && parent?.filename.includes('commands/modules/clear'))
    return { createLogger: () => new Proxy({}, { get: () => () => {} }) };
  if (request === 'discord.js')
    return {
      SlashCommandBuilder: class {
        setName() {
          return this;
        }
        setDescription() {
          return this;
        }
      },
      EmbedBuilder: class {},
      ActionRowBuilder: class {},
      ButtonBuilder: class {},
      ButtonStyle: {},
    };
  if (parent?.filename.includes('messageEventHandler')) {
    const stubs = {
      '../logger': { discord: new Proxy({}, { get: () => () => {} }) },
      '../../middleware/performanceMonitor': { startTimer: () => null, stopTimer: () => {} },
      '../../middleware/rateLimiter': { checkUserRateLimit: async () => ({ limited: false }) },
      '../../utils/maliciousUserManager': {
        DETECTION_CONFIG: { ENHANCED_MESSAGE_MANAGEMENT: false },
        isUserBlocked: () => false,
      },
      '../../utils/enhancedMessageManager': {
        enhancedMessageManager: { cleanupOldRelationships() {} },
      },
      '../../utils/contextExtractionService': { contextExtractionService: {} },
      '../healthCheck': {
        trackMessage() {},
        trackRateLimit() {},
        isStatsCommand: () => false,
        handleStatsCommand() {},
      },
      '../../utils/versionSelfQuery': { processVersionQuery: () => null },
      '../../commands/commandHandler': {
        parseCommand: text => (text === '!clear' ? { commandName: 'clear' } : null),
        handleCommand: async message => {
          if (message.content === '!clear')
            await require('../../commands/modules/clear').execute(message);
          return true;
        },
      },
      '../../plugins/pluginManager': {},
      '../../conversation/conversationManagerSelector': {
        updateMessageById() {},
        saveConversationsToStorage() {},
      },
    };
    if (stubs[request]) return stubs[request];
  }
  return originalLoad.call(this, request, parent, isMain);
};
const SimpleChimpGPTFlow = require('../../src/conversation/flow/SimpleChimpGPTFlow');
const MessageEventHandler = require('../../src/core/eventHandlers/messageEventHandler');
Module._load = originalLoad;
process.env = savedEnv;
const message = (content, id = content) => ({
  id,
  content,
  channelId: 'c',
  guildId: 'g',
  author: { id: 'u', username: 'User', bot: false },
  channel: { id: 'c', isDMBased: () => false, send: async () => ({ edit: async () => {} }) },
  attachments: [],
});
const response = content => ({ choices: [{ message: { content } }] });

test('knowledge context preserves Discord non-enumerable client and channel getters', async () => {
  const flow = new SimpleChimpGPTFlow(
    { chat: { completions: { create: async () => response('ok') } } },
    null,
    { enableKnowledge: true }
  );
  const channel = { id: 'c', send: async () => ({ edit: async () => {} }) };
  const original = Object.assign(
    Object.create({
      get channel() {
        return this.client.channels.get(this.channelId);
      },
    }),
    {
      content: 'search fixture',
      author: { id: 'u' },
      channelId: 'c',
      guildId: 'g',
      id: 'fixture',
    }
  );
  Object.defineProperty(original, 'client', {
    value: { channels: new Map([['c', channel]]) },
    enumerable: false,
  });
  flow.knowledgeFlow.processKnowledgeRequest = async enriched => {
    assert.equal(enriched.client, original.client);
    assert.equal(enriched.channel, channel);
    assert.match(enriched.content, /search fixture/);
    return { success: true, response: 'knowledge result' };
  };
  const result = await flow.processMessage(original);
  assert.equal(result.success, true);
  assert.equal(original.content, 'search fixture');
});

test('weather specialist output is centrally committed and supplied to a follow-up', async () => {
  const requests = [];
  const flow = new SimpleChimpGPTFlow(
    {
      chat: {
        completions: {
          create: async r => {
            requests.push(r);
            return response('Weather answer');
          },
        },
      },
    },
    null,
    {
      enableKnowledge: false,
      weatherService: {
        getWeatherResponse: async () => ({
          formattedSummary: 'Sunny',
          attribution: 'weather source',
        }),
      },
    }
  );
  await flow.processMessage(message('What is the weather in Auckland?'));
  await flow.processMessage(message('Will I need an umbrella?'));
  const later = requests
    .at(-1)
    .messages.map(x => x.content)
    .join('\n');
  assert.match(later, /What is the weather in Auckland\?/);
  assert.match(later, /Weather answer/);
  assert.match(later, /Will I need an umbrella\?/);
});

test('injected actual KnowledgeFlow specialist output is centrally committed and used in follow-up', async () => {
  const requests = [];
  const flow = new SimpleChimpGPTFlow(
    {
      chat: {
        completions: {
          create: async r => {
            requests.push(r);
            return response('Follow-up answer');
          },
        },
      },
    },
    null,
    { enableKnowledge: true }
  );
  await flow.processMessage(message('Search for information about quantum mechanics'));
  await flow.processMessage(message('Can you summarize that?'));
  const later = requests
    .at(-1)
    .messages.map(x => x.content)
    .join('\n');
  assert.match(later, /Search for information about quantum mechanics/);
  assert.match(later, /Knowledge answer/);
  assert.match(later, /Can you summarize that\?/);
});

test('actual handler registers events, binds active flow per client and routes clear to it', async () => {
  const listeners = new Map();
  const client = {
    on: (name, fn) => listeners.set(name, fn),
    isReady: () => true,
    token: 'fixture',
    rest: {},
  };
  const handler = new MessageEventHandler(
    client,
    { IGNORE_MESSAGE_PREFIX: '?' },
    {
      openai: { chat: { completions: { create: async () => response('ok') } } },
      allowedChannelIDs: ['c'],
      DISABLE_PLUGINS: true,
      inProgressOperations: new Set(),
      loadingEmoji: '…',
      statusManager: {},
      pfpManager: null,
    }
  );
  assert.equal(typeof listeners.get('messageCreate'), 'function');
  assert.equal(client[Symbol.for('chimp-gpt.activeConversationFlow')], handler.pocketFlow);
  let cleared;
  handler.pocketFlow.clearConversation = async scope => {
    cleared = scope;
    return true;
  };
  const reply = [];
  await require('../../src/commands/modules/clear').execute({
    ...message('!clear'),
    client,
    reply: async text => reply.push(text),
  });
  assert.deepEqual(cleared, { userId: 'u', channelId: 'c', guildId: 'g' });
  assert.match(reply[0], /cleared/i);
});

test('handler completion currently deletes a preexisting channel busy marker (RED lifecycle regression)', async () => {
  const busy = new Set(['c']);
  const client = { on() {}, isReady: () => true, token: 'fixture', rest: {} };
  const handler = new MessageEventHandler(
    client,
    { IGNORE_MESSAGE_PREFIX: '?' },
    {
      openai: {},
      allowedChannelIDs: ['c'],
      DISABLE_PLUGINS: true,
      inProgressOperations: busy,
      loadingEmoji: '…',
      statusManager: { trackConversation() {} },
      pfpManager: null,
    }
  );
  handler.pocketFlow.clearConversation = async () => true;
  const m = message('!clear');
  m.client = client;
  m.reply = async () => {};
  await handler.handleMessageCreate(m);
  assert.equal(busy.has('c'), true, 'must preserve a marker owned by another in-flight operation');
});
