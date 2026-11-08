'use strict';

// Shared offline boundaries for tests that load the real SimpleChimpGPTFlow.
// Keep KnowledgeFlow selection in each suite, where its behavior is asserted.
const stubs = {
  '../../core/configValidator': {
    ENABLE_KNOWLEDGE_SYSTEM: false,
    BOT_PERSONALITY: 'test',
    KNOWLEDGE_MAX_SEARCH_RESULTS: 1,
    KNOWLEDGE_CONFIDENCE_THRESHOLD: 0.5,
  },
  '../../core/logger': { createLogger: () => new Proxy({}, { get: () => () => {} }) },
  '../../services/chatModel': { CHAT_MODEL: 'fixture', buildChatRequest: x => x },
  '../../utils/systemPromptBuilder': { buildSystemPrompt: x => x },
  '../../services/weatherClient': { withWeatherAttribution: x => x },
  '../../utils/imageDownloader': { downloadImage: async () => Buffer.from('image') },
  '../../utils/errorHandler': { isModerationError: () => false },
};

module.exports = function simpleFlowStub(request, parent) {
  if (!parent?.filename.includes('SimpleChimpGPTFlow')) return undefined;
  return Object.hasOwn(stubs, request) ? stubs[request] : undefined;
};
