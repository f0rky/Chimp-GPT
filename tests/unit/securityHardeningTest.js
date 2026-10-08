const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { parseHtmlContent } = require('../../src/services/webFetch');
const { sanitizeText } = require('../../src/utils/inputSanitizer');
const { sanitizeMessage, validateMessage } = require('../../src/utils/messageSanitizer');
const { setStatValue, DEFAULT_STATS } = require('../../src/core/statsStorage');

async function testSecurityHardening() {
  const results = [];

  try {
    const parsed = await parseHtmlContent(`
      <html><head><title>Safe title</title>
      <meta content="Safe description" name="description"></head>
      <body>Visible <script >secret()</script > <style>hidden {}</style>
      <template>template text</template><noscript>fallback</noscript>
      <a href="https://example.com/path">Example</a>
      <a href="javascript:alert(1)">Unsafe</a>
      <img alt="Preview" src="https://example.com/image.png"></body></html>
    `);
    assert.equal(parsed.title, 'Safe title');
    assert.equal(parsed.description, 'Safe description');
    assert.equal(parsed.links.length, 1);
    assert.deepEqual(parsed.links[0], { url: 'https://example.com/path', text: 'Example' });
    assert.deepEqual(parsed.images[0], { url: 'https://example.com/image.png', alt: 'Preview' });
    for (const omittedText of ['secret()', 'hidden {}', 'template text', 'fallback']) {
      assert.equal(parsed.text.includes(omittedText), false);
      assert.equal(parsed.markdown.includes(omittedText), false);
    }
    results.push({ name: 'Parser-backed fetched HTML extraction', success: true });
  } catch (error) {
    results.push({
      name: 'Parser-backed fetched HTML extraction',
      success: false,
      error: error.message,
    });
  }

  try {
    const input = 'Hello <ScRiPt data-value="safe">alert(1)</ScRiPt > <span title=">">world</span>';
    const plainText = sanitizeText(input);
    assert.equal(plainText.includes('<'), false);
    assert.equal(plainText.includes('alert(1)'), true);

    const message = sanitizeMessage('Hello <script >discard me</script > <b>world</b>');
    assert.equal(message.includes('discard me'), false);
    assert.equal(message.includes('<'), false);
    assert.equal(message.includes('world'), true);
    assert.equal(validateMessage('<script >discard me</script >').valid, false);
    results.push({ name: 'Parser-backed message and input sanitization', success: true });
  } catch (error) {
    results.push({
      name: 'Parser-backed message and input sanitization',
      success: false,
      error: error.message,
    });
  }

  try {
    const stats = structuredClone(DEFAULT_STATS);
    assert.equal(setStatValue(stats, 'messageCount', 1, true), true);
    assert.equal(stats.messageCount, 1);
    assert.equal(setStatValue(stats, 'plugins.loaded', 3), true);
    assert.equal(stats.plugins.loaded, 3);
    const legacyStats = { messageCount: 0 };
    for (const statPath of [
      'apiCalls.gptimage',
      'errors.gptimage',
      'apiCalls.plugins.example-plugin',
      'errors.plugins.example-plugin.count',
      'errors.plugins.example-plugin.hooks.onMessage',
      'errors.discordHooks.onMessage',
    ]) {
      assert.equal(setStatValue(legacyStats, statPath, 1, true), true, statPath);
    }
    assert.equal(legacyStats.apiCalls.gptimage, 1);
    assert.equal(legacyStats.errors.gptimage, 1);
    assert.equal(legacyStats.apiCalls.plugins['example-plugin'], 1);
    assert.equal(legacyStats.errors.plugins['example-plugin'].count, 1);
    assert.equal(legacyStats.errors.plugins['example-plugin'].hooks.onMessage, 1);
    assert.equal(legacyStats.errors.discordHooks.onMessage, 1);

    for (const dangerousPath of [
      '__proto__.polluted',
      'constructor.prototype.polluted',
      'prototype.polluted',
      'plugins..loaded',
    ]) {
      assert.equal(setStatValue(stats, dangerousPath, true), false);
    }
    assert.equal({}.polluted, undefined);
    results.push({ name: 'Prototype-safe stat updates', success: true });
  } catch (error) {
    results.push({
      name: 'Prototype-safe stat updates',
      success: false,
      error: error.message,
    });
  }

  try {
    const workflowPath = path.join(__dirname, '../../.github/workflows/ci.yml');
    const workflow = yaml.load(fs.readFileSync(workflowPath, 'utf8'));
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    results.push({ name: 'CI uses read-only repository permissions', success: true });
  } catch (error) {
    results.push({
      name: 'CI uses read-only repository permissions',
      success: false,
      error: error.message,
    });
  }

  return { success: results.every(result => result.success), results };
}

module.exports = testSecurityHardening;

if (require.main === module) {
  testSecurityHardening()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
