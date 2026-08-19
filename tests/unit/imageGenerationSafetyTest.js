/**
 * Regression tests for the billable OpenAI image-generation request policy.
 * These are deliberately offline: a test must never create a chargeable image.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { IMAGE_REQUEST_POLICY } = require('../../src/services/imageGeneration');

async function testImageGenerationSafety() {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/services/imageGeneration.js'),
    'utf8'
  );

  assert.deepStrictEqual(IMAGE_REQUEST_POLICY, { maxRetries: 0, timeout: 300000 });
  assert.match(source, /maxRetries:\s*0/);
  assert.doesNotMatch(source, /Promise\.race\(\[openai\.images\.generate/);

  return {
    success: true,
    details: 'Image API calls are configured as one-shot SDK-abortable requests.',
  };
}

module.exports = { testImageGenerationSafety };
