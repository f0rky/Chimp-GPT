#!/usr/bin/env node
'use strict';

// Opt-in paid evaluation. Uses synthetic prompts, posts no Discord messages,
// invokes no tools, and never writes credentials to the report.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const OpenAI = require('openai');
const { createOpenAIFetch } = require('../src/core/openaiFetch');
const { buildChatRequest } = require('../src/services/chatModel');

const MODELS = ['gpt-4o-mini', 'gpt-6-luna'];
const PRICES = {
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
};
const tool = (name, description, parameter) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: {
      type: 'object',
      properties: { [parameter]: { type: 'string' } },
      required: [parameter],
    },
  },
});
const imageTool = tool('generateImage', 'Generate an image from a text description.', 'prompt');
const tools = [
  tool('lookupTime', 'Get the current local time for a location.', 'location'),
  tool('lookupWeather', 'Get the current weather for a location.', 'location'),
  imageTool,
];
const personality =
  'You are Solvis, a friendly, casual Discord bot. Be concise and preserve facts.';
const cases = [
  {
    name: 'conversation',
    system: personality,
    messages: [
      { role: 'user', content: 'My cat is named Pixel.' },
      { role: 'assistant', content: 'Pixel is a great name! What is Pixel like?' },
      {
        role: 'user',
        content: 'Write a friendly one-sentence greeting that mentions my cat by name.',
      },
    ],
    maxTokens: 150,
    tools: [imageTool],
    expectedFacts: ['pixel'],
  },
  {
    name: 'time-tool',
    system: `${personality} Use the appropriate tool for live information.`,
    prompt: 'What time is it in Auckland?',
    tools,
    maxTokens: 150,
    expectedTool: 'lookupTime',
    expectedArgument: ['location', 'auckland'],
  },
  {
    name: 'image-tool',
    system: personality,
    prompt: 'Draw the moon casting a duck-shaped shadow, please.',
    tools: [imageTool],
    maxTokens: 150,
    expectedTool: 'generateImage',
    expectedArgument: ['prompt', 'duck'],
  },
  {
    name: 'weather-rephrasing',
    system: personality,
    prompt:
      'Weather data: Auckland, 18 C, clear sky, wind 12 km/h. Respond naturally with your personality while providing this information.',
    maxTokens: 500,
    expectedFacts: ['auckland', '18', 'clear', '12'],
  },
  {
    name: 'time-rephrasing',
    system: personality,
    prompt:
      'Time information: Auckland, 3:45 PM NZDT. Respond naturally with your personality while providing this information.',
    maxTokens: 300,
    expectedFacts: ['auckland', 'nzdt'],
    expectedPattern: /3:45|15:45/,
  },
  {
    name: 'quake-summary',
    system:
      'Summarize Quake Live servers in 3-4 concise sentences. Focus on player counts, maps, and game types. Preserve the supplied facts.',
    prompt: JSON.stringify([
      { name: 'Arena One', players: 8, maxPlayers: 16, map: 'campgrounds', gameType: 'CA' },
      { name: 'Arena Two', players: 2, maxPlayers: 8, map: 'bloodrun', gameType: 'duel' },
    ]),
    maxTokens: 150,
    expectedFacts: ['8', '2', 'campgrounds', 'bloodrun', 'duel'],
  },
  {
    name: 'image-prompt-enhancement',
    system:
      'Enhance image prompts with style, lighting, and composition. Keep the original subject and setting. Return only the enhanced prompt, under 1000 characters.',
    prompt: 'A fox reading a book in a library at night.',
    maxTokens: 300,
    expectedFacts: ['fox', 'book', 'library', 'night'],
    maxCharacters: 1000,
  },
  {
    name: 'knowledge-synthesis',
    system: `${personality} Answer from the supplied search snippets. Do not invent facts.`,
    prompt:
      'Question: When does the fictional Acorn service restart, and how long can jobs wait?\nSnippet 1: Acorn restarts every Tuesday at 02:00 UTC.\nSnippet 2: Queued jobs may wait up to 30 seconds during a restart.\nGive a short friendly answer.',
    maxTokens: 1500,
    expectedFacts: ['tuesday', '02:00', 'utc', '30'],
  },
];

function checkResponse(fixture, response) {
  const choice = response.choices?.[0];
  const message = choice?.message;
  if (fixture.expectedTool) {
    const calls = message?.tool_calls || [];
    if (choice?.finish_reason !== 'tool_calls' || calls.length !== 1) return false;
    const call = calls[0];
    if (call.function?.name !== fixture.expectedTool) return false;
    try {
      const args = JSON.parse(call.function.arguments);
      const [key, value] = fixture.expectedArgument;
      return typeof args[key] === 'string' && args[key].toLowerCase().includes(value);
    } catch {
      return false;
    }
  }
  const text = message?.content?.trim();
  return Boolean(
    choice?.finish_reason === 'stop' &&
      !message?.tool_calls?.length &&
      text &&
      fixture.expectedFacts.every(fact => text.toLowerCase().includes(fact)) &&
      (!fixture.expectedPattern || fixture.expectedPattern.test(text)) &&
      (!fixture.maxCharacters || text.length < fixture.maxCharacters)
  );
}

function estimateCost(model, usage = {}) {
  const rates = PRICES[model];
  const cached = usage.prompt_tokens_details?.cached_tokens || 0;
  const writes = usage.prompt_tokens_details?.cache_write_tokens || 0;
  return (
    ((usage.prompt_tokens - cached - writes) * rates.input +
      cached * rates.cachedInput +
      writes * (rates.cacheWrite || rates.input) +
      usage.completion_tokens * rates.output) /
    1e6
  );
}

function summarize(samples, model) {
  const rows = samples.filter(sample => sample.model === model);
  const latencies = rows
    .filter(sample => sample.success)
    .map(sample => sample.ms)
    .sort((a, b) => a - b);
  const percentile = p => latencies[Math.ceil(latencies.length * p) - 1] ?? null;
  return {
    requests: rows.length,
    apiSuccesses: latencies.length,
    contractPasses: rows.filter(sample => sample.passed).length,
    medianMs: latencies.length
      ? (latencies[Math.floor((latencies.length - 1) / 2)] +
          latencies[Math.floor(latencies.length / 2)]) /
        2
      : null,
    p95Ms: percentile(0.95),
    estimatedCostUsd: rows.reduce((total, sample) => total + (sample.estimatedCostUsd || 0), 0),
    promptTokens: rows.reduce((total, sample) => total + (sample.usage?.prompt_tokens || 0), 0),
    completionTokens: rows.reduce(
      (total, sample) => total + (sample.usage?.completion_tokens || 0),
      0
    ),
    reasoningTokens: rows.reduce(
      (total, sample) => total + (sample.usage?.completion_tokens_details?.reasoning_tokens || 0),
      0
    ),
  };
}

async function main() {
  const output = process.argv[2];
  const repetitions = Number(process.argv[3] || 3);
  if (!output || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) {
    throw new Error('Usage: node scripts/evaluateChatModels.js <output.json> [repetitions: 1-10]');
  }
  const env = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));
  const transport = createOpenAIFetch({ headersTimeout: 20000, bodyTimeout: 20000 });
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    fetch: transport.fetch,
    timeout: 20000,
    maxRetries: 0,
  });
  const report = {
    startedAt: new Date().toISOString(),
    host: os.hostname(),
    repetitions,
    methodology:
      'Sequential alternating model pairs; synthetic prompts; temperature 0.7; SDK retries disabled; 20s timeout; no tools executed. One warmup per model excluded. Narrow automated checks, not a full quality evaluation.',
    pricesPerMillionTokensUsd: PRICES,
    pricingSources: MODELS.map(model => `https://developers.openai.com/api/docs/models/${model}`),
    warmups: [],
    samples: [],
  };
  const save = () => {
    report.summary = Object.fromEntries(
      MODELS.map(model => [model, summarize(report.samples, model)])
    );
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  };
  try {
    for (const model of MODELS) {
      const started = performance.now();
      const response = await client.chat.completions.create(
        buildChatRequest({
          model,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_completion_tokens: 20,
          temperature: 0.7,
        })
      );
      report.warmups.push({ model, ms: performance.now() - started, usage: response.usage });
    }
    for (let round = 0; round < repetitions; round++) {
      for (let index = 0; index < cases.length; index++) {
        const fixture = cases[(index + round) % cases.length];
        const order = (round + index) % 2 ? [...MODELS].reverse() : MODELS;
        for (const model of order) {
          const parameters = buildChatRequest({
            model,
            messages: [
              { role: 'system', content: fixture.system },
              ...(fixture.messages || [{ role: 'user', content: fixture.prompt }]),
            ],
            max_completion_tokens: fixture.maxTokens,
            temperature: 0.7,
            ...(fixture.tools ? { tools: fixture.tools, tool_choice: 'auto' } : {}),
          });
          const started = performance.now();
          let sample;
          try {
            const response = await client.chat.completions.create(parameters);
            sample = {
              case: fixture.name,
              round: round + 1,
              model,
              returnedModel: response.model,
              success: true,
              passed: checkResponse(fixture, response),
              ms: performance.now() - started,
              finishReason: response.choices[0].finish_reason,
              message: response.choices[0].message,
              usage: response.usage,
              estimatedCostUsd: estimateCost(model, response.usage),
            };
          } catch (error) {
            sample = {
              case: fixture.name,
              round: round + 1,
              model,
              success: false,
              passed: false,
              ms: performance.now() - started,
              status: error.status,
              error: error.code || error.name,
            };
          }
          report.samples.push(sample);
          save();
          console.log(
            `${model} ${fixture.name}: ${sample.passed ? 'PASS' : 'FAIL'} ${sample.ms.toFixed(0)} ms`
          );
        }
      }
    }
    report.completedAt = new Date().toISOString();
    save();
    console.log(JSON.stringify(report.summary, null, 2));
    if (report.samples.some(sample => !sample.passed)) process.exitCode = 1;
  } finally {
    await transport.dispatcher.close();
  }
}

main().catch(error => {
  console.error(error.status || error.code || error.name);
  process.exitCode = 1;
});
