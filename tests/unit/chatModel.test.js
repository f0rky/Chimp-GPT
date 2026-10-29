const assert = require('node:assert/strict');
const test = require('node:test');
const { CHAT_MODEL } = require('../../src/services/chatModel');

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

test('reported model matches the model sent by legacy response generation', async () => {
  const response = await openaiConfig.generateResponse('clear sky', [
    { role: 'user', content: 'Weather?' },
  ]);
  assert.equal(response, 'OK');
  assert.equal(openaiConfig.getOpenAIModel(), 'gpt-4o-mini');
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
  const overridden = new FunctionExecutorNode(
    new FakeOpenAI(),
    {},
    { config: { model: 'custom-model' } }
  );
  await overridden.callOpenAI([], false);
  assert.equal(requests[1].model, 'custom-model');
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
