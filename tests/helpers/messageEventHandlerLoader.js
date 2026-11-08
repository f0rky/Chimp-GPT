'use strict';

// Loads the real MessageEventHandler and SimpleChimpGPTFlow with offline import stubs.
// The stubs apply only while these two modules are being required; the module loader and
// process.env are restored before the caller runs any test body.
const Module = require('node:module');
const simpleFlowStub = require('./simpleFlowStubs');

// Mutable fixture controls for policy checks that must run again for each dispatched message.
const control = { rateLimited: false, blockedUserIds: new Set() };

const messageHandlerStubs = {
  '../logger': { discord: new Proxy({}, { get: () => () => {} }) },
  '../../middleware/performanceMonitor': { startTimer: () => null, stopTimer: () => {} },
  '../../middleware/rateLimiter': {
    checkUserRateLimit: async () => ({
      limited: control.rateLimited,
      remainingPoints: 1,
      secondsBeforeNext: 30,
      message: 'fixture rate limit',
    }),
  },
  '../../utils/maliciousUserManager': {
    DETECTION_CONFIG: { ENHANCED_MESSAGE_MANAGEMENT: false },
    isUserBlocked: id => control.blockedUserIds.has(id),
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
      if (message.content !== '!clear') return false;
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

function loadHandlerModules() {
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
    if (parent?.filename.includes('messageEventHandler') && messageHandlerStubs[request])
      return messageHandlerStubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const SimpleChimpGPTFlow = require('../../src/conversation/flow/SimpleChimpGPTFlow');
    const MessageEventHandler = require('../../src/core/eventHandlers/messageEventHandler');
    return { SimpleChimpGPTFlow, MessageEventHandler };
  } finally {
    Module._load = originalLoad;
    process.env = savedEnv;
  }
}

module.exports = { loadHandlerModules, control };
