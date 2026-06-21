/**
 * Smoke Test Command Module
 *
 * Owner-only self-test that exercises each user-facing function against the real
 * APIs/services and reports per-function pass/fail with live updates. Useful for
 * verifying a deploy end-to-end (AI, weather, time, quake, image generation)
 * without manually trying each one.
 *
 * Usage:
 *   /smoketest [skip_image:true]
 *   !smoketest        (runs everything, incl. image generation ~$0.002)
 *   !smoketest quick  (skips image generation)
 *
 * @module SmokeTestCommand
 */

const { createLogger } = require('../../core/logger');
const logger = createLogger('commands:smoketest');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../core/configValidator');

// Truncate helper for one-line detail snippets.
function snip(value, max = 70) {
  const text = (typeof value === 'string' ? value : JSON.stringify(value)) || '';
  return text.replace(/\s+/g, ' ').slice(0, max);
}

/**
 * Build the list of checks. Each returns a short success detail string or throws.
 */
function buildChecks(includeImage) {
  const checks = [
    {
      name: 'AI conversation (OpenAI)',
      async run() {
        const { client } = require('../../services/openaiConfig');
        const completion = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Reply with exactly: SMOKE_OK' }],
          max_tokens: 10,
        });
        const text = completion.choices?.[0]?.message?.content?.trim();
        if (!text) throw new Error('empty completion');
        return `replied "${snip(text, 30)}"`;
      },
    },
    {
      name: 'Weather lookup',
      async run() {
        const { getWeatherResponse } = require('../../services/simplified-weather');
        const data = await getWeatherResponse('Auckland, New Zealand', 'weather in Auckland?');
        if (!data) throw new Error('no weather data');
        return 'Auckland data returned';
      },
    },
    {
      name: 'Time lookup',
      async run() {
        const lookupTime = require('../../services/timeLookup');
        const data = await lookupTime('Tokyo');
        if (!data) throw new Error('no time data');
        return snip(data, 60);
      },
    },
    {
      name: 'Quake server stats',
      async run() {
        const lookupQuakeServer = require('../../services/quakeLookup');
        const data = await lookupQuakeServer(null, 1);
        if (!data) throw new Error('no quake data');
        return 'service responded';
      },
    },
  ];

  if (includeImage) {
    checks.push({
      name: 'Image generation (OpenAI)',
      async run() {
        const imageGen = require('../../services/imageGeneration');
        const res = await imageGen.generateImage('a small blue test icon', {
          model: 'gpt-image-1-mini',
          size: '1024x1024',
          quality: 'low',
        });
        if (!res || !res.success) throw new Error(res?.error || 'generation failed');
        const img = res.images?.[0] || {};
        if (!img.b64_json && !img.url) throw new Error('no image payload');
        const cost = res.estimatedCost != null ? ` ~$${res.estimatedCost}` : '';
        return `image returned${cost}`;
      },
    });
  }

  return checks;
}

const ICON = { pending: '⏳', running: '🔄', ok: '✅', fail: '❌' };

function renderEmbed(states, { done = false } = {}) {
  const lines = states.map(s => {
    const head = `${ICON[s.status]} **${s.name}**`;
    if (s.status === 'ok') return `${head} — ${s.detail} _(${(s.ms / 1000).toFixed(1)}s)_`;
    if (s.status === 'fail') return `${head} — ${s.error}`;
    return head;
  });
  const passed = states.filter(s => s.status === 'ok').length;
  const failed = states.filter(s => s.status === 'fail').length;
  const total = states.length;
  const embed = new EmbedBuilder()
    .setTitle('🔬 Solvis Self-Test')
    .setDescription(lines.join('\n') || 'Starting…')
    .setColor(done ? (failed === 0 ? 0x2ecc71 : 0xe74c3c) : 0x3498db)
    .setTimestamp();
  if (done) {
    embed.setFooter({ text: `${passed}/${total} passed${failed ? ` · ${failed} failed` : ''}` });
  } else {
    embed.setFooter({ text: 'Running…' });
  }
  return embed;
}

/**
 * Run all checks, calling update(embed) after each state change for live feedback.
 * @returns {Promise<{passed:number,failed:number,total:number}>}
 */
async function runChecks(includeImage, update) {
  const checks = buildChecks(includeImage);
  const states = checks.map(c => ({ name: c.name, status: 'pending' }));

  await update(renderEmbed(states));

  for (let i = 0; i < checks.length; i++) {
    states[i].status = 'running';
    await update(renderEmbed(states));

    const start = Date.now();
    try {
      const detail = await checks[i].run();
      states[i] = { name: checks[i].name, status: 'ok', ms: Date.now() - start, detail };
    } catch (err) {
      states[i] = { name: checks[i].name, status: 'fail', error: snip(err.message, 120) };
      logger.warn({ error: err, check: checks[i].name }, 'Smoke test check failed');
    }
    await update(renderEmbed(states, { done: i === checks.length - 1 }));
  }

  const passed = states.filter(s => s.status === 'ok').length;
  const failed = states.filter(s => s.status === 'fail').length;
  return { passed, failed, total: states.length };
}

module.exports = {
  name: 'smoketest',
  aliases: ['selftest', 'diag'],
  description: 'Owner: run a live self-test of the AI and all functions',
  dmAllowed: true,
  ownerOnly: true,

  slashCommand: new SlashCommandBuilder()
    .setName('smoketest')
    .setDescription('Owner: run a live self-test of the AI and all functions')
    .addBooleanOption(opt =>
      opt
        .setName('skip_image')
        .setDescription('Skip image generation (faster, no cost)')
        .setRequired(false)
    ),

  /**
   * Text command version: !smoketest [quick]
   */
  async execute(message, args = []) {
    if (message.author.id !== config.OWNER_ID) {
      return message.reply('Sorry, only the bot owner can run the smoke test.');
    }
    const includeImage = !args.some(a => /^(quick|fast|noimage|skip-image)$/i.test(a));
    logger.info({ userId: message.author.id, includeImage }, 'Smoke test started (text)');

    const reply = await message.reply({ embeds: [renderEmbed([])] });
    const result = await runChecks(includeImage, embed => reply.edit({ embeds: [embed] }));
    logger.info({ ...result }, 'Smoke test completed (text)');
    return undefined;
  },

  /**
   * Slash command version: /smoketest [skip_image]
   */
  async interactionExecute(interaction) {
    if (interaction.user.id !== config.OWNER_ID) {
      return interaction.reply({
        content: 'Sorry, only the bot owner can run the smoke test.',
        ephemeral: true,
      });
    }
    const includeImage = !interaction.options.getBoolean('skip_image');
    logger.info({ userId: interaction.user.id, includeImage }, 'Smoke test started (slash)');

    await interaction.deferReply();
    const result = await runChecks(includeImage, embed =>
      interaction.editReply({ embeds: [embed] })
    );
    logger.info({ ...result }, 'Smoke test completed (slash)');
    return undefined;
  },
};
