/**
 * Image action button authorization + duplicate-charge prevention tests.
 *
 * Loads the actual interactionEventHandler source in a vm wrapper with explicit stubs for
 * every dependency. generateImage is a counting stub (never a real provider), downloadImage
 * is a stub, and Discord interactions are in-memory fakes. No network, no files, no env.
 *
 * Usage: node tests/unit/imageActionAuthorization.test.js [--selftest]
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE_PATH = path.resolve(
  __dirname,
  '../../src/core/eventHandlers/interactionEventHandler.js'
);
const IMAGE_GENERATION_PATH = path.resolve(__dirname, '../../src/services/imageGeneration.js');
const OWNER_ID = '111111111111111111';
const OTHER_ID = '222222222222222222';
const PROMPT = 'a kiwi bird at sunset';
const ENCODED = encodeURIComponent(PROMPT);

const UPSCALE_OPTIONS = {
  provider: 'openai',
  model: 'gpt-image-2',
  size: '1024x1024',
  quality: 'medium',
};
const REMIX_OPTIONS = { model: 'gpt-image-2', size: '1024x1024', quality: 'low', enhance: false };

function forbidden(name) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`Hermetic test: ${name}.${String(prop)} must not be used`);
      },
    }
  );
}

class StubBuilder {
  constructor() {
    this.data = {};
    this.components = [];
  }
  addComponents(...components) {
    this.components.push(...components);
    return this;
  }
  setCustomId(id) {
    this.data.custom_id = id;
    return this;
  }
  setLabel(label) {
    this.data.label = label;
    return this;
  }
  setStyle(style) {
    this.data.style = style;
    return this;
  }
  setDisabled(disabled) {
    this.data.disabled = disabled;
    return this;
  }
}

/**
 * Builds a fresh module instance (fresh module-level claim state) with a controllable
 * generateImage stub. mode: 'success' | 'failure' | 'throw' | 'deferred'.
 */
function loadHandler({ env = {}, config = { OWNER_ID } } = {}) {
  const noop = () => undefined;
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop };
  const generation = { calls: [], mode: 'success', pending: [] };

  const generateImage = (prompt, options) => {
    generation.calls.push({ prompt, options });
    if (generation.mode === 'failure') {
      return Promise.resolve({ success: false, error: 'provider refused' });
    }
    if (generation.mode === 'throw') {
      return Promise.reject(new Error('provider timeout'));
    }
    const result = { success: true, images: [{ b64_json: 'aW1n' }], model: 'gpt-image-2' };
    if (generation.mode === 'deferred') {
      return new Promise(resolve => generation.pending.push(() => resolve(result)));
    }
    return Promise.resolve(result);
  };

  const stubs = {
    '../logger': { discord: logger },
    'discord.js': {
      ActionRowBuilder: StubBuilder,
      ButtonBuilder: StubBuilder,
      ButtonStyle: { Primary: 1, Secondary: 2 },
    },
    '../../commands/commandHandler': forbidden('commandHandler'),
    '../../services/imageGeneration': { generateImage },
    '../../utils/imageDownloader': { downloadImage: async () => Buffer.from('img') },
    '../../utils/maliciousUserManager': { isUserBlocked: () => false },
    '../../middleware/performanceMonitor': { startTimer: () => 'fixture-timer', stopTimer: noop },
    '../../middleware/rateLimiter': {
      checkUserRateLimit: async () => ({ limited: false }),
      checkImageGenerationRateLimit: async () => ({ limited: false }),
    },
  };
  const hermeticRequire = spec => {
    if (!Object.prototype.hasOwnProperty.call(stubs, spec)) {
      throw new Error(`Hermetic test: unstubbed require "${spec}"`);
    }
    return stubs[spec];
  };
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname, process) {${source}\n})`,
    { filename: MODULE_PATH }
  );
  const mod = { exports: {} };
  wrapper.call(
    mod.exports,
    mod.exports,
    hermeticRequire,
    mod,
    MODULE_PATH,
    path.dirname(MODULE_PATH),
    { env }
  );
  const Handler = mod.exports;
  const handler = new Handler({ on: noop }, config);
  return { handler, generation };
}

function makeInteraction({
  customId,
  userId = OWNER_ID,
  messageId = 'msg-1',
  content = '🖼️ original image',
  message,
}) {
  const calls = { reply: [], deferUpdate: 0, editReply: [], followUp: [] };
  return {
    customId,
    channel: { isDMBased: () => true },
    user: userId === null ? undefined : { id: userId },
    message: message !== undefined ? message : { id: messageId, content },
    replied: false,
    deferred: false,
    calls,
    isButton: () => true,
    isChatInputCommand: () => false,
    async reply(payload) {
      calls.reply.push(payload);
      this.replied = true;
    },
    async deferUpdate() {
      calls.deferUpdate += 1;
      this.deferred = true;
    },
    async editReply(payload) {
      calls.editReply.push(payload);
    },
    async followUp(payload) {
      calls.followUp.push(payload);
    },
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

async function settle(generation, promises) {
  await flush();
  while (generation.pending.length) generation.pending.shift()();
  await Promise.all(promises);
}

function assertEphemeralOnly(interaction, pattern) {
  assert.equal(interaction.calls.reply.length, 1, 'exactly one reply');
  assert.equal(interaction.calls.reply[0].ephemeral, true, 'reply must be ephemeral');
  if (pattern) assert.match(interaction.calls.reply[0].content, pattern);
  assert.equal(interaction.calls.deferUpdate, 0, 'must not defer');
  assert.equal(interaction.calls.editReply.length, 0, 'must not edit source message');
  assert.equal(interaction.calls.followUp.length, 0, 'must not post follow-up image');
}

function lastEdit(interaction) {
  return interaction.calls.editReply[interaction.calls.editReply.length - 1];
}

// a
for (const prefix of ['image_upscale:', 'image_remix:', 'hd_upgrade:']) {
  test(`(a) non-owner ${prefix} click is denied with zero generation calls`, async () => {
    const { handler, generation } = loadHandler();
    const click = makeInteraction({ customId: `${prefix}${ENCODED}`, userId: OTHER_ID });
    await handler.handleInteractionCreate(click);
    assert.equal(generation.calls.length, 0);
    assertEphemeralOnly(click, /owner/i);
  });
}

test('(a) missing OWNER_ID, missing user, and missing message all fail closed', async () => {
  const cases = [
    { load: { config: {}, env: {} }, click: {} },
    { load: { config: { OWNER_ID: '  ' }, env: { OWNER_ID: '' } }, click: {} },
    { load: {}, click: { userId: null } },
    { load: {}, click: { message: null } },
    { load: {}, click: { message: { content: 'no id' } } },
    { load: {}, click: { message: { id: 'msg-1' } } },
  ];
  for (const { load, click } of cases) {
    const { handler, generation } = loadHandler(load);
    const interaction = makeInteraction({ customId: `image_upscale:${ENCODED}`, ...click });
    await handler.handleInteractionCreate(interaction);
    assert.equal(generation.calls.length, 0, JSON.stringify({ load, click }));
    assertEphemeralOnly(interaction);
  }
});

test('(a) OWNER_ID falls back to process.env and is normalized', async () => {
  const { handler, generation } = loadHandler({ config: {}, env: { OWNER_ID: ` "${OWNER_ID}" ` } });
  const click = makeInteraction({ customId: `image_upscale:${ENCODED}` });
  await handler.handleInteractionCreate(click);
  assert.equal(generation.calls.length, 1);
});

// b, c, d
for (const [label, first, second] of [
  ['(b) two concurrent upscales', 'image_upscale:', 'image_upscale:'],
  ['(c) concurrent upscale + remix', 'image_upscale:', 'image_remix:'],
  ['(d) concurrent legacy hd_upgrade + upscale', 'hd_upgrade:', 'image_upscale:'],
]) {
  test(`${label} on the same message produce exactly one generation call`, async () => {
    const { handler, generation } = loadHandler();
    generation.mode = 'deferred';
    const a = makeInteraction({ customId: `${first}${ENCODED}` });
    const b = makeInteraction({ customId: `${second}${ENCODED}` });
    const pa = handler.handleInteractionCreate(a);
    const pb = handler.handleInteractionCreate(b);
    await settle(generation, [pa, pb]);
    assert.equal(generation.calls.length, 1);
    assertEphemeralOnly(b, /already/i);
    assert.equal(a.calls.followUp.length, 1);
  });
}

test('(e) replay after success makes zero extra generation calls', async () => {
  const { handler, generation } = loadHandler();
  await handler.handleInteractionCreate(makeInteraction({ customId: `image_upscale:${ENCODED}` }));
  assert.equal(generation.calls.length, 1);
  for (const prefix of ['image_upscale:', 'image_remix:', 'hd_upgrade:']) {
    const replay = makeInteraction({ customId: `${prefix}${ENCODED}` });
    await handler.handleInteractionCreate(replay);
    assertEphemeralOnly(replay);
  }
  assert.equal(generation.calls.length, 1);
});

for (const mode of ['failure', 'throw']) {
  test(`(f) provider ${mode} after dispatch keeps the claim consumed`, async () => {
    const { handler, generation } = loadHandler();
    generation.mode = mode;
    await handler.handleInteractionCreate(makeInteraction({ customId: `image_remix:${ENCODED}` }));
    assert.equal(generation.calls.length, 1);
    generation.mode = 'success';
    const retry = makeInteraction({ customId: `image_upscale:${ENCODED}` });
    await handler.handleInteractionCreate(retry);
    assert.equal(generation.calls.length, 1);
    assertEphemeralOnly(retry);
  });
}

test('(g) pre-dispatch local failures release the claim so a valid retry is allowed', async () => {
  for (const badId of ['image_upscale:%E0%A4%A', 'image_remix:', 'hd_upgrade:%20%20']) {
    const { handler, generation } = loadHandler();
    const bad = makeInteraction({ customId: badId });
    await handler.handleInteractionCreate(bad);
    assert.equal(generation.calls.length, 0, badId);
    assertEphemeralOnly(bad, /invalid prompt/i);
    const retry = makeInteraction({ customId: `image_upscale:${ENCODED}` });
    await handler.handleInteractionCreate(retry);
    assert.equal(generation.calls.length, 1, `retry after ${badId}`);
  }
});

test('(h) success and post-dispatch failure both remove controls from the source message', async () => {
  for (const [mode, prefix, expect] of [
    ['success', 'image_upscale:', /HD version below/],
    ['success', 'image_remix:', /Remix version below/],
    ['failure', 'image_upscale:', /HD upgrade failed/],
    ['throw', 'image_remix:', /Remix failed/],
  ]) {
    const { handler, generation } = loadHandler();
    generation.mode = mode;
    const click = makeInteraction({ customId: `${prefix}${ENCODED}` });
    await handler.handleInteractionCreate(click);
    const edit = lastEdit(click);
    assert.deepEqual(edit.components, [], `${mode} ${prefix}`);
    assert.match(edit.content, expect);
    assert.equal(click.calls.followUp.length, mode === 'success' ? 1 : 0);
  }
});

test('(i) provider option objects are unchanged', async () => {
  const { handler, generation } = loadHandler();
  for (const [prefix, id] of [
    ['image_upscale:', 'msg-u'],
    ['image_remix:', 'msg-r'],
    ['hd_upgrade:', 'msg-h'],
  ]) {
    await handler.handleInteractionCreate(
      makeInteraction({ customId: `${prefix}${ENCODED}`, messageId: id })
    );
  }
  assert.equal(generation.calls.length, 3);
  assert.deepEqual(generation.calls[0], { prompt: PROMPT, options: UPSCALE_OPTIONS });
  assert.ok(generation.calls[1].prompt.startsWith(`${PROMPT}\n\nCreate a clearly distinct`));
  assert.deepEqual(generation.calls[1].options, REMIX_OPTIONS);
  assert.deepEqual(generation.calls[2], { prompt: PROMPT, options: UPSCALE_OPTIONS });
});

test('(j) no-retry image policy is untouched and handler passes no retry options', () => {
  const imageSource = fs.readFileSync(IMAGE_GENERATION_PATH, 'utf8');
  assert.match(imageSource, /maxRetries:\s*0/);
  assert.doesNotMatch(imageSource, /Promise\.race\(\[openai\.images\.generate/);
  const handlerSource = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.doesNotMatch(handlerSource, /maxRetries|retryWithBreaker/);
});

test('(k) different source messages are processed concurrently without claim leakage', async () => {
  const { handler, generation } = loadHandler();
  generation.mode = 'deferred';
  const a = makeInteraction({ customId: `image_upscale:${ENCODED}`, messageId: 'msg-a' });
  const b = makeInteraction({ customId: `image_remix:${ENCODED}`, messageId: 'msg-b' });
  const pa = handler.handleInteractionCreate(a);
  const pb = handler.handleInteractionCreate(b);
  await settle(generation, [pa, pb]);
  assert.equal(generation.calls.length, 2);
  assert.equal(a.calls.followUp.length, 1);
  assert.equal(b.calls.followUp.length, 1);
});

if (process.argv.includes('--selftest')) {
  process.on('exit', code => {
    if (code === 0) {
      console.log(
        'SELFTEST PASS: image actions are owner-only and charged at most once per message'
      );
    } else {
      console.error(`SELFTEST FAIL: image action authorization tests failed (exit ${code})`);
    }
  });
}
