#!/usr/bin/env node
/**
 * Chimp-GPT Performance Benchmark
 *
 * Measures:
 *   1. Command parse time (routing a message to the right handler)
 *   2. Image gen round-trip (mocked OpenAI call, full pipeline)
 *   3. Help command render time (build embed + chunking)
 *   4. Memory / heap usage baseline
 *
 * No live API calls — expensive dependencies are mocked.
 *
 * Usage:  node scripts/benchmark.js [--iterations N]
 */

'use strict';

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const iterIdx = args.indexOf('--iterations');
const ITERATIONS = iterIdx !== -1 ? parseInt(args[iterIdx + 1], 10) || 100 : 100;

// ─── Colours ─────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Run fn N times synchronously, return { min, max, avg, p95 } in ms */
function bench(fn, count) {
  const n = count || ITERATIONS;
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6); // ns → ms
  }
  times.sort(function (a, b) {
    return a - b;
  });
  const sum = times.reduce(function (s, v) {
    return s + v;
  }, 0);
  return {
    min: times[0],
    max: times[times.length - 1],
    avg: sum / n,
    p95: times[Math.floor(n * 0.95)],
  };
}

/** Run async fn N times, return stats */
async function benchAsync(fn, count) {
  const n = count || ITERATIONS;
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort(function (a, b) {
    return a - b;
  });
  const sum = times.reduce(function (s, v) {
    return s + v;
  }, 0);
  return {
    min: times[0],
    max: times[times.length - 1],
    avg: sum / n,
    p95: times[Math.floor(n * 0.95)],
  };
}

function fmt(n) {
  return n.toFixed(3).padStart(9);
}

function colourMs(n) {
  const s = fmt(n);
  if (n < 0.5) return C.green + s + C.reset;
  if (n < 5) return C.yellow + s + C.reset;
  return C.red + s + C.reset;
}

function printTable(rows) {
  const COL_W = [42, 10, 10, 10, 10];
  const header = ['Benchmark', 'min (ms)', 'avg (ms)', 'p95 (ms)', 'max (ms)'];
  const sep = COL_W.map(function (w) {
    return '─'.repeat(w);
  }).join('┼');

  console.log('\n' + C.bold + C.cyan + '┌' + sep.replace(/┼/g, '┬') + '┐' + C.reset);
  console.log(
    C.bold +
      '│' +
      header
        .map(function (c, i) {
          return c.padEnd(COL_W[i]);
        })
        .join('│') +
      '│' +
      C.reset
  );
  console.log('├' + sep + '┤');
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    process.stdout.write('│' + row.label.padEnd(COL_W[0]) + '│');
    process.stdout.write(colourMs(row.min) + ' '.repeat(COL_W[1] - 9) + '│');
    process.stdout.write(colourMs(row.avg) + ' '.repeat(COL_W[2] - 9) + '│');
    process.stdout.write(colourMs(row.p95) + ' '.repeat(COL_W[3] - 9) + '│');
    process.stdout.write(colourMs(row.max) + ' '.repeat(COL_W[4] - 9) + '│');
    process.stdout.write('\n');
  }
  console.log('└' + sep.replace(/┼/g, '┴') + '┘\n');
}

// ─── Setup: mock heavy modules before loading app code ───────────────────────
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = 'sk-bench-mock';
process.env.DISCORD_TOKEN = 'mock-token';
process.env.DISCORD_CLIENT_ID = '000000000000000000';
process.env.ALLOWED_CHANNEL_IDS = '111111111111111111';
process.env.OWNER_ID = '222222222222222222';
process.env.ENABLE_IMAGE_GENERATION = 'true';

// Stub discord.js so we can require commandHandler without a live client
const Module = require('module');
const _origLoad = Module._load.bind(Module);

const DISCORD_STUB = {
  EmbedBuilder: class {
    setTitle() {
      return this;
    }
    setDescription() {
      return this;
    }
    setColor() {
      return this;
    }
    setTimestamp() {
      return this;
    }
    setFooter() {
      return this;
    }
    setImage() {
      return this;
    }
    addFields() {
      return this;
    }
    toJSON() {
      return {};
    }
  },
  ActionRowBuilder: class {
    addComponents() {
      return this;
    }
  },
  ButtonBuilder: class {
    setCustomId() {
      return this;
    }
    setLabel() {
      return this;
    }
    setStyle() {
      return this;
    }
    setDisabled() {
      return this;
    }
  },
  ButtonStyle: { Secondary: 'Secondary', Primary: 'Primary' },
  Collection: Map,
  PermissionFlagsBits: { Administrator: 8n },
  PermissionsBitField: class {
    has() {
      return false;
    }
  },
  SlashCommandBuilder: class {
    setName() {
      return this;
    }
    setDescription() {
      return this;
    }
    addStringOption(fn) {
      fn({ setName: () => ({ setDescription: () => ({ setRequired: () => ({}) }) }) });
      return this;
    }
    toJSON() {
      return {};
    }
  },
};

const OPENAI_MOCK_RESPONSE = {
  data: [{ b64_json: Buffer.alloc(512).toString('base64'), revised_prompt: 'a cat' }],
};

const OPENAI_STUB = {
  OpenAI: class {
    constructor() {
      /* mock — no setup needed */
    }
    get images() {
      return {
        generate: async function () {
          return OPENAI_MOCK_RESPONSE;
        },
      };
    }
    get chat() {
      return {
        completions: {
          create: async function () {
            return { choices: [{ message: { content: 'enhanced' } }] };
          },
        },
      };
    }
  },
};

Module._load = function (request, parent, isMain) {
  if (request === 'discord.js') return DISCORD_STUB;
  if (request === 'openai') return OPENAI_STUB;
  return _origLoad(request, parent, isMain);
};

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const path = require('path');
  const fs = require('fs');
  const ROOT = path.resolve(__dirname, '..');

  // ── Load modules ──────────────────────────────────────────────────────────
  let commandHandler, helpModule;
  try {
    commandHandler = require(path.join(ROOT, 'src/commands/commandHandler'));
    helpModule = require(path.join(ROOT, 'src/commands/modules/help'));
  } catch (err) {
    console.error('Failed to load modules:', err.message);
    process.exit(1);
  }

  // Register all command modules so help has data to render
  try {
    const modulesDir = path.join(ROOT, 'src/commands/modules');
    for (const file of fs.readdirSync(modulesDir).filter(function (f) {
      return f.endsWith('.js');
    })) {
      try {
        const mod = require(path.join(modulesDir, file));
        if (mod && mod.name && mod.execute) commandHandler.registerCommand(mod);
      } catch (_) {
        /* skip if module fails in bench env */
      }
    }
  } catch (_) {
    /* ignore */
  }

  console.log(C.bold + '\nChimp-GPT Performance Benchmark' + C.reset);
  console.log(C.dim + 'Iterations: ' + ITERATIONS + ' per benchmark\n' + C.reset);
  console.log(C.cyan + '► Running benchmarks...' + C.reset);

  // ── Benchmark 1: Command parse time ──────────────────────────────────────
  // Replicate parseCommand logic (same as internal commandHandler function)
  const prefixes = commandHandler.getPrefixes ? commandHandler.getPrefixes() : ['!', '.', '/'];

  function parseCommand(content) {
    for (let i = 0; i < prefixes.length; i++) {
      const prefix = prefixes[i];
      if (content.startsWith(prefix)) {
        const withoutPrefix = content.slice(prefix.length).trim();
        const parts = withoutPrefix.split(/\s+/);
        return { commandName: parts[0].toLowerCase(), args: parts.slice(1), prefix };
      }
    }
    return null;
  }

  const testMessages = [
    '!help',
    '/ping',
    '.stats',
    '!help image',
    '/help commands',
    'just a regular chat message',
    '!unknown-cmd arg1 arg2',
  ];

  const parseStats = bench(function () {
    for (let i = 0; i < testMessages.length; i++) parseCommand(testMessages[i]);
  });
  const perMsg = testMessages.length;
  const parsePerMsg = {
    min: parseStats.min / perMsg,
    max: parseStats.max / perMsg,
    avg: parseStats.avg / perMsg,
    p95: parseStats.p95 / perMsg,
  };

  // ── Benchmark 2: Image gen pipeline (mocked) ──────────────────────────────
  let imageStats = null;
  try {
    const SimpleChimpGPTFlow = require(path.join(ROOT, 'src/conversation/flow/SimpleChimpGPTFlow'));
    const flow = new SimpleChimpGPTFlow(new OPENAI_STUB.OpenAI(), null);

    const mockMessage = {
      id: 'bench-msg-001',
      content: 'draw a cat sitting on a keyboard',
      author: { id: 'user-001', username: 'benchuser', bot: false },
      channel: {
        id: 'ch-001',
        isDMBased: function () {
          return false;
        },
      },
      channelId: 'ch-001',
      reference: null,
    };

    // Cap image bench at 20 — even mocked, each call allocates a Buffer
    imageStats = await benchAsync(
      async function () {
        await flow.handleImageGeneration({}, { message: mockMessage });
      },
      Math.min(ITERATIONS, 20)
    );
  } catch (err) {
    console.warn(C.yellow + '  ⚠ Image pipeline bench skipped: ' + err.message + C.reset);
  }

  // ── Benchmark 3: Help embed build + chunking ──────────────────────────────
  const allCmds = commandHandler.getCommands ? commandHandler.getCommands() : [];
  const helpStats = bench(function () {
    helpModule.buildCommandFields('General', allCmds, '/');
  });

  // ── Benchmark 4: Heap baseline ────────────────────────────────────────────
  const mem = process.memoryUsage();

  // ── Print results ─────────────────────────────────────────────────────────
  const rows = [{ label: 'Command parse (per message)', ...parsePerMsg }];
  if (imageStats)
    rows.push({ label: 'Image gen pipeline (mocked OpenAI, per call)', ...imageStats });
  rows.push({ label: 'Help embed build (' + allCmds.length + ' commands)', ...helpStats });

  printTable(rows);

  const mbUsed = (mem.heapUsed / 1024 / 1024).toFixed(1);
  const mbTotal = (mem.heapTotal / 1024 / 1024).toFixed(1);
  const mbRss = (mem.rss / 1024 / 1024).toFixed(1);
  const mbExternal = (mem.external / 1024 / 1024).toFixed(1);

  console.log(C.bold + C.cyan + 'Memory (heap at benchmark time)' + C.reset);
  console.log('  heapUsed  : ' + C.green + mbUsed + ' MB' + C.reset);
  console.log('  heapTotal : ' + mbTotal + ' MB');
  console.log('  rss       : ' + mbRss + ' MB');
  console.log('  external  : ' + mbExternal + ' MB');

  console.log('\n' + C.bold + C.cyan + 'Key Findings' + C.reset);
  console.log(
    '  • Command parse: avg ' +
      parsePerMsg.avg.toFixed(4) +
      ' ms/msg — ' +
      (parsePerMsg.avg < 0.1 ? C.green + 'excellent' : C.yellow + 'acceptable') +
      C.reset
  );
  if (imageStats) {
    console.log(
      '  • Image pipeline: avg ' +
        imageStats.avg.toFixed(1) +
        ' ms  (dominated by Buffer.from base64 decode + OpenAI mock overhead)'
    );
  }
  console.log(
    '  • Help embed build: avg ' +
      helpStats.avg.toFixed(3) +
      ' ms — ' +
      (helpStats.avg < 1 ? C.green + 'fast' : C.yellow + 'check chunking logic') +
      C.reset
  );
  console.log();
}

main().catch(function (err) {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
