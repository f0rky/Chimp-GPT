const assert = require('assert');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const ACTION_PREFIXES = Object.freeze({
  upscale: 'image_upscale:',
  remix: 'image_remix:',
});
const DISCORD_CUSTOM_ID_MAX_LENGTH = 100;

function encodePromptForImageAction(prompt) {
  let encodedPrompt = encodeURIComponent(
    String(prompt || '')
      .replace(/<@\d+>/g, '')
      .trim()
  );
  const maxEncoded =
    DISCORD_CUSTOM_ID_MAX_LENGTH -
    Math.max(...Object.values(ACTION_PREFIXES).map(prefix => prefix.length));

  if (encodedPrompt.length > maxEncoded) {
    encodedPrompt = encodedPrompt.substring(0, maxEncoded);
    const trailingPercent = encodedPrompt.match(/%[0-9A-Fa-f]?$/);
    if (trailingPercent) encodedPrompt = encodedPrompt.slice(0, -trailingPercent[0].length);
    if (encodedPrompt.endsWith('%')) encodedPrompt = encodedPrompt.slice(0, -1);
  }
  return encodedPrompt;
}

function buildImageActionRow(prompt) {
  const encodedPrompt = encodePromptForImageAction(prompt);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ACTION_PREFIXES.upscale}${encodedPrompt}`)
      .setLabel('⬆️ Upscale')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${ACTION_PREFIXES.remix}${encodedPrompt}`)
      .setLabel('🔀 Remix')
      .setStyle(ButtonStyle.Primary)
  );
}

function selftest() {
  const row = buildImageActionRow('Draw a kiwi 🥝 near <@1234567890>');
  const ids = row.components.map(component => component.data.custom_id);
  assert.strictEqual(ids.length, 2);
  assert.ok(ids.every(id => id.length <= DISCORD_CUSTOM_ID_MAX_LENGTH));
  assert.ok(ids[0].startsWith(ACTION_PREFIXES.upscale));
  assert.ok(ids[1].startsWith(ACTION_PREFIXES.remix));
  assert.strictEqual(
    decodeURIComponent(ids[0].slice(ACTION_PREFIXES.upscale.length)),
    'Draw a kiwi 🥝 near'
  );
  console.log('SELFTEST PASS: image action buttons have safe Discord custom IDs');
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

module.exports = { ACTION_PREFIXES, buildImageActionRow, encodePromptForImageAction };
