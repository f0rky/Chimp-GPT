const assert = require('node:assert/strict');
const test = require('node:test');
const { CHAT_MODEL, buildChatRequest } = require('../../src/services/chatModel');

const stub = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const log = { debug() {}, info() {}, warn() {}, error() {} };
stub('../../src/core/logger', {
  createLogger: () => log,
  logger: log,
  openai: log,
  discord: log,
  quake: log,
});
stub('../../src/core/healthCheck', { trackApiCall() {}, trackError() {} });
stub('../../src/utils/apiKeyManager', {
  getApiKey: () => 'sk-offline-test',
  recordApiKeyError() {},
});
stub('../../src/utils/retryWithBreaker', async action => action());
stub('../../src/core/functionResults', {});
stub('../../src/core/openaiFetch', {
  openaiFetch() {},
  createOpenAIFetch: () => ({ fetch() {} }),
});

const requests = [];
const createCompletion = async parameters => {
  requests.push(parameters);
  return { choices: [{ message: { content: 'OK' } }], usage: {} };
};
class FakeOpenAI {
  constructor() {
    this.chat = { completions: { create: createCompletion } };
  }
}
FakeOpenAI.OpenAI = FakeOpenAI;
stub('openai', FakeOpenAI);

const openaiConfig = require('../../src/services/openaiConfig');
const imageGeneration = require('../../src/services/imageGeneration');
const FunctionExecutorNode = require('../../src/conversation/flow/nodes/FunctionExecutorNode');
const SimpleChimpGPTFlow = require('../../src/conversation/flow/SimpleChimpGPTFlow');
const { generateNaturalResponse } = require('../../src/core/processors/responseGenerator');

test.beforeEach(() => {
  requests.length = 0;
});

test.afterEach(() => {
  for (const request of requests.filter(request => request.model === CHAT_MODEL)) {
    assert.equal(request.reasoning_effort, 'none');
    assert.equal('max_tokens' in request, false);
  }
});

test('Luna requests disable reasoning and preserve output budgets without mutating callers', () => {
  const parameters = { max_tokens: 150, temperature: 0.7, tools: [] };
  const request = buildChatRequest(parameters);
  assert.equal(request.model, 'gpt-6-luna');
  assert.equal(request.reasoning_effort, 'none');
  assert.equal(request.max_completion_tokens, 150);
  assert.equal(request.temperature, 0.7);
  assert.equal(request.tools, parameters.tools);
  assert.equal('max_tokens' in request, false);
  assert.deepEqual(parameters, { max_tokens: 150, temperature: 0.7, tools: [] });
  assert.equal(
    buildChatRequest({ max_tokens: 150, max_completion_tokens: 80 }).max_completion_tokens,
    80
  );
});

test('explicit model overrides keep their own reasoning and token parameters', () => {
  const parameters = { model: 'custom-model', max_tokens: 150, reasoning_effort: 'low' };
  assert.deepEqual(buildChatRequest(parameters), parameters);
});

test('reported model matches the model sent by legacy response generation', async () => {
  const response = await openaiConfig.generateResponse('clear sky', [
    { role: 'user', content: 'Weather?' },
  ]);
  assert.equal(response, 'OK');
  assert.equal(openaiConfig.getOpenAIModel(), 'gpt-6-luna');
  assert.equal(requests[0].model, openaiConfig.getOpenAIModel());
});

test('prompt enhancement uses the working chat model without requesting an image', async () => {
  assert.equal(await imageGeneration.enhanceImagePrompt('a cat'), 'OK');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, CHAT_MODEL);
});

test('function executor uses the shared model and retains explicit model overrides', async () => {
  const executor = new FunctionExecutorNode(new FakeOpenAI(), {});
  await executor.callOpenAI([{ role: 'user', content: 'Time?' }]);
  assert.equal(requests[0].model, CHAT_MODEL);
  assert.equal(requests[0].tool_choice, 'auto');
  assert.equal(requests[0].max_completion_tokens, 150);
  const overridden = new FunctionExecutorNode(
    new FakeOpenAI(),
    {},
    { config: { model: 'custom-model' } }
  );
  await overridden.callOpenAI([], false);
  assert.equal(requests[1].model, 'custom-model');
  assert.equal(requests[1].max_tokens, 150);
  assert.equal('reasoning_effort' in requests[1], false);
});

test('active conversations use the same model as status reporting', async () => {
  const conversations = new Map();
  const response = await SimpleChimpGPTFlow.prototype.handleConversation.call(
    { options: { maxConversationLength: 4, maxTokens: 20 }, openaiClient: new FakeOpenAI() },
    { get: key => (key === 'conversations' ? conversations : 'Helpful bot') },
    { message: { author: { id: 'user' }, content: 'Hello' } }
  );
  assert.equal(response.success, true);
  assert.equal(response.response, 'OK');
  assert.equal(requests[0].model, openaiConfig.getOpenAIModel());
  assert.equal(requests[0].max_completion_tokens, 20);
});

test('weather and time rephrasing retain their separate output budgets', async () => {
  const flow = {
    openaiClient: new FakeOpenAI(),
    weatherService: { getWeatherResponse: async () => ({ formattedSummary: 'Auckland: 18 C' }) },
    timeLookup: async () => 'Auckland: 3:45 PM NZDT',
  };
  const store = { get: () => 'Helpful bot' };
  const weather = await SimpleChimpGPTFlow.prototype.handleWeatherRequest.call(flow, store, {
    message: { content: 'weather in Auckland' },
  });
  const time = await SimpleChimpGPTFlow.prototype.handleTimeRequest.call(flow, store, {
    message: { content: 'time in Auckland' },
  });
  assert.equal(weather.success, true);
  assert.equal(time.success, true);
  assert.equal(requests[0].max_completion_tokens, 500);
  assert.equal(requests[1].max_completion_tokens, 300);
});

test('function-result responses use the shared model', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const response = await generateNaturalResponse(
    { weather: 'clear' },
    [{ role: 'user', content: 'Weather?' }],
    'lookupWeather',
    null,
    new FakeOpenAI()
  );
  assert.equal(response, 'OK');
  assert.equal(requests[0].model, CHAT_MODEL);
});
