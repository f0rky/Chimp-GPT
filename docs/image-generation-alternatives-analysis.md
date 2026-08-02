# Image generation architecture

Chimp-GPT uses a two-tier image workflow designed for responsiveness without hidden duplicate billing.

## Default: fast generation through OpenRouter

When `OPENROUTER_API_KEY` is configured, normal conversational image requests use:

- **Model:** `google/gemini-3.1-flash-lite-image` (Nano Banana 2 Lite)
- **Endpoint:** `POST https://openrouter.ai/api/v1/images`
- **Settings:** 1K, low quality, PNG output
- **Policy:** one image per request; no SDK retry; OpenRouter gateway fallback disabled

OpenRouter describes this model as a fast, cost-efficient image option suitable for high-velocity workflows. Exact latency and price depend on provider load and the requested output. The app treats provider-reported usage cost as an estimate when available.

If no OpenRouter key is configured, the app retains the OpenAI image path instead of failing startup.

## Premium action: OpenAI Upscale

Every successfully delivered image includes visible Discord buttons:

- **⬆️ Upscale** — explicitly requests an OpenAI GPT Image 2, high-quality version.
- **🔀 Remix** — creates a new low-quality variation from the source prompt. It is *prompt-based*, not pixel-level editing of the original image.

Upscale is deliberately an explicit action because it is slower and more expensive than the fast default. Each action removes the original message controls while it runs, preventing repeated accidental clicks.

## Billing and retry safety

Image generation is non-idempotent: a request can finish remotely after a client loses the response. Therefore:

1. OpenAI image calls use `maxRetries: 0` and the SDK's abortable timeout.
2. OpenRouter image calls make one HTTP request, use a bounded timeout, and set `provider.allow_fallbacks: false`.
3. The application never races providers or retries a generation automatically.
4. Multi-variation generation must be an explicit user action because every variation is billable.

## Output integrity

OpenAI Images API output is decoded from `b64_json`. Chimp-GPT explicitly requests an opaque PNG and inspects supported PNG output before Discord delivery. A valid PNG with all RGB values at zero is rejected as an all-black provider response; it is not uploaded or retried automatically.

## OpenAI usage

GPT Image 2 remains the premium provider for explicit upscales. The normal OpenAI conversational fallback uses automatic sizing and low quality, rather than forcing a medium-quality square image. This reduces output-token cost and usually improves latency.

The OpenAI integration follows the current Image API pattern: `images.generate()` followed by `b64_json` decoding. `output_format` and `background` are explicit image-output parameters; they are not the legacy `response_format` setting.

## Configuration

```env
# Required for fast default image generation
OPENROUTER_API_KEY=...

# Required for OpenAI upscale and OpenAI fallback
OPENAI_API_KEY=...

# Keep image generation enabled
ENABLE_IMAGE_GENERATION=true
```

Do not commit `.env`, API keys, generated images, or local live-image diagnostic scripts.

## Validation

The following checks are intentionally offline:

```bash
node src/utils/imageIntegrity.js --selftest
node src/utils/imageActionButtons.js --selftest
node src/services/openRouterImageGeneration.js --selftest
node tests/comprehensiveTestRunner.js --filter 'Image Generation Safety'
```

Do not use broad test suites as image smoke tests until their imports are verified as hermetic; a live image request incurs a charge.
