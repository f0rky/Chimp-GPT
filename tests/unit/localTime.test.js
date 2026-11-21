'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatLocalTimes } = require('../../src/utils/localTime');
test('formats Sydney and NZ summer/winter clocks and rollover', () => {
  assert.equal(
    formatLocalTimes('2026-01-01T11:30:00Z'),
    '1 Jan 2026, 10:30 pm Sydney · 2 Jan 2026, 12:30 am NZ'
  );
  assert.equal(
    formatLocalTimes('2026-06-30T13:00:00Z'),
    '30 Jun 2026, 11:00 pm Sydney · 1 Jul 2026, 1:00 am NZ'
  );
});
test('Sydney and New Zealand daylight-saving transitions are independently reflected', () => {
  assert.match(formatLocalTimes('2026-04-04T15:59:00Z'), /5 Apr 2026, 2:59 am Sydney/);
  assert.match(formatLocalTimes('2026-04-04T16:01:00Z'), /5 Apr 2026, 2:01 am Sydney/);
  assert.match(formatLocalTimes('2026-04-04T13:59:00Z'), /5 Apr 2026, 2:59 am NZ/);
  assert.match(formatLocalTimes('2026-04-04T14:01:00Z'), /5 Apr 2026, 2:01 am NZ/);
  assert.match(formatLocalTimes('2026-10-03T15:59:00Z'), /4 Oct 2026, 1:59 am Sydney/);
  assert.match(formatLocalTimes('2026-10-03T16:01:00Z'), /4 Oct 2026, 3:01 am Sydney/);
  assert.match(formatLocalTimes('2026-09-26T13:59:00Z'), /27 Sept 2026, 1:59 am NZ/);
  assert.match(formatLocalTimes('2026-09-26T14:01:00Z'), /27 Sept 2026, 3:01 am NZ/);
});
test('missing and invalid input never becomes the Unix epoch', () => {
  for (const value of ['not-a-date', undefined, null, '', NaN, Infinity, -Infinity]) {
    assert.equal(formatLocalTimes(value), 'time unavailable');
  }
});
