const assert = require('assert');
const axios = require('axios');
const { createLogger } = require('../core/logger');
const { inspectPngPixels } = require('../utils/imageIntegrity');

const logger = createLogger('openrouter-image');
const FAST_MODEL = 'google/gemini-3.1-flash-lite-image';
const REQUEST_POLICY = Object.freeze({ timeout: 30000, retries: 0 });

function buildRequest(prompt, options = {}) {
  const request = {
    model: options.model || FAST_MODEL,
    prompt,
    // Gemini Flash Lite's current OpenRouter image endpoint accepts 1K only.
    resolution: options.resolution || '1K',
    n: 1,
    // Never permit gateway failover/replay for image generation.
    provider: { allow_fallbacks: false },
  };

  // Do not send quality or output_format. The selected Gemini endpoint does
  // not advertise either parameter, and OpenRouter rejects unknown parameters
  // with HTTP 400. It returns the provider-default media type in the response.
  if (options.aspectRatio) request.aspect_ratio = options.aspectRatio;
  return request;
}

async function generateImage(prompt, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'OpenRouter image generation is not configured', prompt };
  }

  const request = buildRequest(prompt, options);
  const startedAt = Date.now();
  try {
    const response = await axios.post('https://openrouter.ai/api/v1/images', request, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: REQUEST_POLICY.timeout,
    });
    const data = response.data?.data;
    if (!Array.isArray(data) || !data.length) throw new Error('OpenRouter returned no image data');

    const images = data.map(item => {
      const b64 = item.b64_json;
      if (!b64) throw new Error('OpenRouter image response did not include b64_json');
      const inspection = inspectPngPixels(Buffer.from(b64, 'base64'));
      if (inspection.inspectable && inspection.uniformBlack) {
        throw new Error(
          'The image provider returned an all-black PNG. It was not uploaded or retried.'
        );
      }
      return {
        b64_json: b64,
        url: `data:${item.media_type || 'image/png'};base64,${b64}`,
        revisedPrompt: item.revised_prompt || prompt,
      };
    });

    return {
      success: true,
      images,
      prompt,
      revisedPrompt: images[0].revisedPrompt,
      model: request.model,
      quality: request.quality,
      estimatedCost: response.data?.usage?.cost || null,
      apiCallDuration: Date.now() - startedAt,
      totalProcessingTime: Date.now() - startedAt,
      provider: 'openrouter',
    };
  } catch (error) {
    logger.warn({ error: error.message, model: request.model }, 'OpenRouter image request failed');
    return { success: false, error: error.message, prompt, provider: 'openrouter' };
  }
}

function selftest() {
  const request = buildRequest('a quick green kiwi', {
    quality: 'low',
    format: 'png',
    aspectRatio: '16:9',
  });
  assert.strictEqual(request.model, FAST_MODEL);
  assert.strictEqual(request.provider.allow_fallbacks, false);
  assert.strictEqual(request.n, 1);
  assert.strictEqual(request.resolution, '1K');
  assert.strictEqual(request.aspect_ratio, '16:9');
  assert.ok(!Object.hasOwn(request, 'quality'));
  assert.ok(!Object.hasOwn(request, 'output_format'));
  assert.strictEqual(REQUEST_POLICY.retries, 0);
  console.log(
    'SELFTEST PASS: Fast-image requests use only Gemini-supported parameters and disable retries/fallbacks'
  );
}

if (require.main === module && process.argv.includes('--selftest')) {
  try {
    selftest();
    process.exit(0);
  } catch (error) {
    console.error(`SELFTEST FAIL: ${error.stack || error.message}`);
    process.exit(1);
  }
}

module.exports = { FAST_MODEL, REQUEST_POLICY, buildRequest, generateImage };
