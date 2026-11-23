'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderGauntReport, appendGauntContext } = require('../../src/handlers/gauntCardRenderer');
const report = require('../helpers/gauntFixtures');
test('renders interface v1 report with evidence distinctions', () => {
  const j = renderGauntReport(report).toJSON(),
    v = [j.description, ...j.fields.map(f => `${f.name}\n${f.value}`)].join('\n');
  assert.match(v, /7 – 5/);
  assert.match(v, /15 shared \(3 teammates, 12 opponents\)/);
  assert.match(v, /Player A → Player B 3 · Player B → Player A 1/);
  assert.match(v, /lifetime pummels 14/);
  assert.match(v, /<t:1800000000:R>/);
  assert.doesNotMatch(v, /7656119800000000[12]/);
  assert.equal(j.fields.find(f => f.name === 'VS').inline, false);
});
test('bounds hostile content, suppresses pings, respects astral UTF16 limits and reports omitted rows', () => {
  const h = {
    ...report,
    players: Array.from({ length: 70 }, (_, i) => ({
      ...report.players[i % 2],
      name: i === 0 ? '@everyone <@12345678901234567> ' + '😀'.repeat(1200) : `Player ${i}`,
      team: i % 2 ? 2 : 1,
    })),
    facts: Array.from({ length: 32 }, (_, i) => '@here warning ' + i + ' '.repeat(80)),
    warnings: Array.from({ length: 32 }, (_, i) => 'note ' + i),
  };
  const j = renderGauntReport(h).toJSON(),
    v = [j.title, j.description, ...j.fields.flatMap(f => [f.name, f.value])].join('\n');
  assert(j.fields.every(f => f.name.length <= 256 && f.value.length <= 1024));
  assert(j.fields.length <= 25);
  assert(v.length <= 6000);
  for (const color of ['Red', 'Blue']) {
    const section = j.fields.find(f => f.name.includes(color));
    assert(section);
    const shown = (section.value.match(/^•/gm) || []).length,
      omitted = Number(section.value.match(/(\d+) more players omitted/)?.[1] || 0);
    assert.equal(shown + omitted, 35);
  }
  assert.match(v, /😀/);
  assert.doesNotMatch(v, /@everyone|@here|<@123/);
});
test('one-sided teams omit VS; append context preserves full base scoreboard', () => {
  const { EmbedBuilder } = require('discord.js');
  const one = { ...report, players: [{ ...report.players[0], team: 'red' }] };
  assert(
    !renderGauntReport(one)
      .toJSON()
      .fields.some(f => f.name === 'VS')
  );
  const base = new EmbedBuilder()
    .setTitle('Scoreboard')
    .setDescription('Base score rows')
    .addFields({ name: '🔴 Red', value: 'Full existing roster' });
  const out = appendGauntContext(base, report);
  assert.equal(base.data.fields.length, 1);
  assert.equal(out.data.fields[0].value, 'Full existing roster');
  assert(out.toJSON().fields.some(f => f.name.startsWith('Gaunt context')));
  assert(out.toJSON().fields.length <= 25);
});

test('append context handles fieldless bases and exact-match final gaunts with named scope', () => {
  const { EmbedBuilder } = require('discord.js');
  const base = new EmbedBuilder().setTitle('Final').setDescription('Unchanged');
  const out = appendGauntContext(
    base,
    { ...report, players: report.players.map((p, i) => ({ ...p, matchGaunts: i ? null : 4 })) },
    { kind: 'final' }
  ).toJSON();
  assert.equal(out.description, 'Unchanged');
  assert.match(
    out.fields.map(f => `${f.name}\\n${f.value}`).join('\\n'),
    /this match.*4|4.*this match/i
  );
  assert.doesNotMatch(out.fields.map(f => f.value).join('\\n'), /7656119800000000/);
});

test('append context omits additions when base has no field or character capacity', () => {
  const { EmbedBuilder } = require('discord.js');
  const base = new EmbedBuilder().setTitle('x'.repeat(256)).setDescription('d'.repeat(4096));
  base.addFields({ name: 'n', value: 'v'.repeat(1024) }, { name: 'n', value: 'v'.repeat(622) });
  const out = appendGauntContext(base, report).toJSON();
  assert.equal(out.fields.length, 2);
  assert.equal(out.title, 'x'.repeat(256));
});
