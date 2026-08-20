/**
 * Offline regression test for the conversational image-policy response.
 * It stubs the image service and never calls a provider.
 */
const assert = require('assert');
const SimpleChimpGPTFlow = require('../../src/conversation/flow/SimpleChimpGPTFlow');

async function testImageContentPolicyUx() {
  const flow = new SimpleChimpGPTFlow(null, null, {
    enableKnowledge: false,
    imageService: {
      async generateImage() {
        return {
          success: false,
          error: 'OpenRouter HTTP 400: Gemini blocked the request (IMAGE_PROHIBITED_CONTENT)',
        };
      },
    },
  });

  const result = await flow.handleImageGeneration(flow.store, {
    message: {
      content: 'Draw a fictional robot character',
      author: { id: 'fixture-user' },
    },
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(
    result.response,
    '🚫 The image generator blocked that request based on its content policy, so no image was created. Try describing it differently.'
  );
  assert.match(result.error, /IMAGE_PROHIBITED_CONTENT/);
  return {
    success: true,
    details: 'Content-policy blocks receive a clear, provider-neutral reply.',
  };
}

if (require.main === module) {
  testImageContentPolicyUx()
    .then(result => {
      console.log(`SELFTEST PASS: ${result.details}`);
      process.exit(0);
    })
    .catch(error => {
      console.error(`SELFTEST FAIL: ${error.stack || error.message}`);
      process.exit(1);
    });
}

module.exports = { testImageContentPolicyUx };
