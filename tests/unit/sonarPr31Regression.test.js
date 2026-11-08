const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('bot navigation catches rejected discovery from the unlock event callback', async () => {
  const source = read('src/web/public/bot-navigation.js');
  const callbackMatch = source.match(
    /this\.unsubscribeAuth = window\.OwnerAuth\.onChange\(status => \{([\s\S]*?)\n        \}\);/
  );
  assert.ok(callbackMatch, 'production unlock callback should exist');
  const errors = [];
  let reported;
  const instance = {
    locked: true,
    discoverBots: () => Promise.reject(new Error('offline discovery failure')),
    showError: message => {
      reported = message;
    },
  };
  const context = {
    console: { error: (...args) => errors.push(args) },
    instance,
  };
  vm.runInNewContext(
    `(function (status) {${callbackMatch[1]}\n}).call(instance, { state: 'unlocked' })`,
    context
  );
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(instance.locked, false);
  assert.equal(reported, 'offline discovery failure');
  assert.equal(errors.length, 1);
  assert.match(source, /this\.discoverBots\(\)\.catch\(/);
  assert.doesNotMatch(source, /void\s+this\.discoverBots\(/);
});

test('owner auth header construction still tolerates missing headers and preserves auth token', () => {
  const source = read('src/web/public/owner-auth.js');
  assert.match(source, /headers: \{ \.\.\.options\.headers, 'X-Owner-Token': token \}/);
  const headers = { ...undefined, 'X-Owner-Token': 'fixture-token' };
  assert.deepEqual(headers, { 'X-Owner-Token': 'fixture-token' });
});

test('discovery keeps scan bounds and sanitizes each exposed service field', () => {
  const source = read('src/web/routes/discoveryRoutes.js');
  assert.match(source, /startPort < PORT_WINDOW\.START/);
  assert.match(source, /endPort > PORT_WINDOW\.END/);
  assert.match(source, /const safeServices = sanitizeEntries\(services\)/);
  assert.match(source, /function sanitizeEntry\(entry\)[\s\S]*?return sanitizeValidEntry\(entry\)/);
  assert.match(source, /Number\.parseInt\(value, 10\)/);
});

test('Sonar source cleanup preserves escaped rendering and selection guards', () => {
  const navigation = read('src/web/public/bot-navigation.js');
  const escapeFn = navigation.match(/function escapeHtml\(value\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(escapeFn);
  assert.match(escapeFn, /replaceAll\('&', '&amp;'/);
  assert.match(escapeFn, /replaceAll\('<', '&lt;'/);
  assert.match(escapeFn, /replaceAll\('>', '&gt;'/);
  assert.match(escapeFn, /replaceAll\("'", '&#39;'/);
  const app = read('src/web/public/app-unified.js');
  assert.match(app, /if \(selectedMessages\.size === 0\)/);
  assert.match(app, /if \(!OwnerAuth\.isUnlocked\(\)\)/);
});
