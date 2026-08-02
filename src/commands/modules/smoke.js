/**
 * Owner-only smoke-test command for ChimpGPT.
 *
 * `!smoke` / `/smoke` runs non-billable readiness checks.
 * `!smoke live` / `/smoke live:true` also invokes every declared core tool,
 * including one low-quality GPT Image canary that may incur an OpenAI charge.
 */
const assert = require('assert');
const { SlashCommandBuilder } = require('discord.js');
const { createLogger } = require('../../core/logger');
const { IMAGE_REQUEST_POLICY, generateImage } = require('../../services/imageGeneration');
const lookupTime = require('../../services/timeLookup');
const { lookupWeather, lookupExtendedForecast } = require('../../services/weatherLookup');
const { getWolframShortAnswer } = require('../../services/wolframLookup');
const lookupQuakeServer = require('../../services/quakeLookup');
const { searchWeb } = require('../../services/webSearch');

const logger = createLogger('commands:smoke');
const LIVE_IMAGE_PROMPT =
  'A minimal green check mark on a plain white square background, no text, smoke-test canary.';

function result(name, passed, detail) {
  return { name, passed: Boolean(passed), detail: String(detail || '') };
}

function evaluateTimeResult(response) {
  const text = typeof response === 'string' ? response.trim() : '';
  const passed = /^The current time in .+ \(.+\) is .+ on .+\.$/.test(text);
  return result('Time lookup', passed, text || 'empty or non-text response');
}

function renderReport(mode, results) {
  const passed = results.filter(entry => entry.passed).length;
  const lines = [
    `🧪 **ChimpGPT ${mode === 'live' ? 'live' : 'safe'} smoke test** — ${passed}/${results.length} checks passed`,
  ];

  for (const entry of results) {
    lines.push(`${entry.passed ? '✅' : '❌'} **${entry.name}:** ${entry.detail}`);
  }

  if (mode !== 'live') {
    lines.push(
      '\nSafe mode does not call third-party tools or generate an image. Use `!smoke live` or `/smoke live:true` for the owner-only full test; it makes real provider calls and generates one low-quality billed canary image.'
    );
  }

  return lines.join('\n');
}

async function runSafeSmoke(client) {
  const discordReady = Boolean(client?.isReady?.());
  const apiKeyConfigured = Boolean(process.env.OPENAI_API_KEY);
  const imagePolicyIsSafe =
    IMAGE_REQUEST_POLICY.maxRetries === 0 && IMAGE_REQUEST_POLICY.timeout >= 120000;

  return [
    result('Discord gateway', discordReady, discordReady ? 'connected' : 'not ready'),
    result(
      'OpenAI configuration',
      apiKeyConfigured,
      apiKeyConfigured ? 'configured' : 'missing API key'
    ),
    result(
      'Image request policy',
      imagePolicyIsSafe,
      `one-shot; SDK timeout ${IMAGE_REQUEST_POLICY.timeout / 1000}s`
    ),
  ];
}

async function runLiveSmoke(client) {
  const results = await runSafeSmoke(client);

  const checks = [
    {
      name: 'Time lookup',
      run: async () => evaluateTimeResult(await lookupTime('Auckland')),
    },
    {
      name: 'Weather lookup',
      run: async () => (await lookupWeather('Auckland')).success === true,
    },
    {
      name: 'Weather forecast lookup',
      run: async () => (await lookupExtendedForecast('Auckland', 1)).success === true,
    },
    {
      name: 'Wolfram Alpha lookup',
      run: async () => {
        const answer = await getWolframShortAnswer('1+1');
        return typeof answer === 'string' && !/sorry|unavailable|error/i.test(answer);
      },
    },
    {
      name: 'Quake server lookup',
      run: async () => {
        const answer = await lookupQuakeServer(null, 1);
        return typeof answer === 'string' && answer.length > 0 && !/^error/i.test(answer);
      },
    },
    {
      name: 'Web search',
      run: async () => {
        const response = await searchWeb('ChimpGPT smoke test', { maxResults: 1 });
        return response.success === true && Array.isArray(response.data?.results);
      },
    },
    {
      name: 'GPT Image canary',
      run: async () => {
        const image = await generateImage(LIVE_IMAGE_PROMPT, {
          model: 'gpt-image-2',
          size: '1024x1024',
          quality: 'low',
          enhance: false,
        });
        return image.success === true;
      },
    },
  ];

  for (const check of checks) {
    try {
      const outcome = await check.run();
      if (outcome && typeof outcome === 'object' && 'passed' in outcome) {
        results.push(outcome);
      } else {
        results.push(
          result(check.name, outcome, outcome ? 'provider responded' : 'unexpected response')
        );
      }
    } catch (error) {
      logger.warn({ error, check: check.name }, 'Live smoke check failed');
      results.push(result(check.name, false, error.message));
    }
  }

  return results;
}

async function executeSmoke({ client, live, reply, edit }) {
  const results = await runSafeSmoke(client);
  const initialReport = renderReport(live ? 'live' : 'safe', results);
  const feedback = await reply(initialReport + (live ? '\n\nRunning live provider checks…' : ''));

  if (!live) return;

  const liveResults = await runLiveSmoke(client);
  await edit(feedback, renderReport('live', liveResults));
}

const command = {
  name: 'smoke',
  aliases: [],
  description: 'Run safe setup checks; live mode exercises all core provider tools',
  dmAllowed: false,
  ownerOnly: true,
  slashCommand: new SlashCommandBuilder()
    .setName('smoke')
    .setDescription('Run ChimpGPT safe checks or the full owner-only provider smoke test')
    .addBooleanOption(option =>
      option
        .setName('live')
        .setDescription('Call providers and generate one low-quality billed GPT Image canary')
        .setRequired(false)
    ),

  async execute(message, args) {
    const live = args[0]?.toLowerCase() === 'live';
    await executeSmoke({
      client: message.client,
      live,
      reply: content => message.reply(content),
      edit: (feedback, content) => feedback.edit(content),
    });
  },

  async executeSlash(interaction) {
    return this.interactionExecute(interaction);
  },

  async interactionExecute(interaction) {
    const live = interaction.options.getBoolean('live') === true;
    await interaction.deferReply();
    await executeSmoke({
      client: interaction.client,
      live,
      reply: async content => {
        await interaction.editReply(content);
        return interaction;
      },
      edit: (_feedback, content) => interaction.editReply(content),
    });
  },
};

async function selftest() {
  const report = renderReport('safe', [result('Discord gateway', true, 'connected')]);
  assert.match(report, /1\/1 checks passed/);
  const acceptedTime = evaluateTimeResult(
    'The current time in Auckland (Pacific/Auckland) is 12:04PM on Sunday, August 2, 2026.'
  );
  const rejectedTime = evaluateTimeResult(
    'Sorry, I couldn\'t get the time for "Auckland" right now.'
  );
  assert.strictEqual(acceptedTime.passed, true);
  assert.strictEqual(rejectedTime.passed, false);
  assert.strictEqual(IMAGE_REQUEST_POLICY.maxRetries, 0);
  assert.ok(IMAGE_REQUEST_POLICY.timeout >= 120000);
  console.log('SELFTEST PASS: smoke command safe and live modes are correctly guarded');
}

if (require.main === module && process.argv.includes('--selftest')) {
  selftest()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`SELFTEST FAIL: ${error.stack || error.message}`);
      process.exit(1);
    });
}

module.exports = { ...command, runSafeSmoke, runLiveSmoke, renderReport, evaluateTimeResult };
