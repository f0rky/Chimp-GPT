/**
 * Offline regression tests for fast-provider selection and image action controls.
 * No provider request is made: the OpenRouter module is replaced in Node's cache.
 */
const assert = require('assert');

function loadImageGenerationWithOpenRouterStub(stub) {
  const imageGenerationPath = require.resolve('../../src/services/imageGeneration');
  const openRouterPath = require.resolve('../../src/services/openRouterImageGeneration');
  const previousImageGeneration = require.cache[imageGenerationPath];
  const previousOpenRouter = require.cache[openRouterPath];

  delete require.cache[imageGenerationPath];
  require.cache[openRouterPath] = {
    id: openRouterPath,
    filename: openRouterPath,
    loaded: true,
    exports: { generateImage: stub },
  };

  const imageGeneration = require('../../src/services/imageGeneration');

  return {
    imageGeneration,
    restore() {
      delete require.cache[imageGenerationPath];
      delete require.cache[openRouterPath];
      if (previousImageGeneration) require.cache[imageGenerationPath] = previousImageGeneration;
      if (previousOpenRouter) require.cache[openRouterPath] = previousOpenRouter;
    },
  };
}

async function testImageRoutingAndActions() {
  const previousEnv = {
    ENABLE_IMAGE_GENERATION: process.env.ENABLE_IMAGE_GENERATION,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  };
  const calls = [];
  const harness = loadImageGenerationWithOpenRouterStub(async (prompt, options) => {
    calls.push({ prompt, options });
    return { success: true, images: [], provider: 'openrouter' };
  });

  try {
    process.env.ENABLE_IMAGE_GENERATION = 'true';
    process.env.OPENROUTER_API_KEY = 'fixture-openrouter-key';

    const result = await harness.imageGeneration.generateImage('draw a green kiwi', {
      model: 'gpt-image-2',
      quality: 'low',
    });
    assert.strictEqual(result.provider, 'openrouter');
    assert.deepStrictEqual(calls, [
      {
        prompt: 'draw a green kiwi',
        options: { quality: 'low' },
      },
    ]);

    const { ACTION_PREFIXES, buildImageActionRow } = require('../../src/utils/imageActionButtons');
    const row = buildImageActionRow('Draw a kiwi near <@1234567890>');
    const ids = row.components.map(component => component.data.custom_id);
    assert.strictEqual(ids.length, 2);
    assert.ok(ids.every(id => id.length <= 100));
    assert.ok(ids[0].startsWith(ACTION_PREFIXES.upscale));
    assert.ok(ids[1].startsWith(ACTION_PREFIXES.remix));

    const InteractionEventHandler = require('../../src/core/eventHandlers/interactionEventHandler');
    const dispatched = [];
    const fakeHandler = {
      handleHdUpgrade: async (_interaction, prefix) => dispatched.push(['upscale', prefix]),
      handleRemix: async () => dispatched.push(['remix']),
    };
    await InteractionEventHandler.prototype.handleButtonInteraction.call(fakeHandler, {
      customId: `${ACTION_PREFIXES.upscale}fixture`,
    });
    await InteractionEventHandler.prototype.handleButtonInteraction.call(fakeHandler, {
      customId: `${ACTION_PREFIXES.remix}fixture`,
    });
    assert.deepStrictEqual(dispatched, [['upscale', ACTION_PREFIXES.upscale], ['remix']]);

    return {
      success: true,
      details:
        'Fast-provider routing and action-button dispatch are covered without network calls.',
    };
  } finally {
    harness.restore();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

if (require.main === module) {
  testImageRoutingAndActions()
    .then(result => {
      console.log(`SELFTEST PASS: ${result.details}`);
      process.exit(0);
    })
    .catch(error => {
      console.error(`SELFTEST FAIL: ${error.stack || error.message}`);
      process.exit(1);
    });
}

module.exports = { testImageRoutingAndActions };
