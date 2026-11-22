'use strict';

const ZONES = ['Australia/Sydney', 'Pacific/Auckland'];
function validDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function formatLocalTimes(value) {
  const date = validDate(value);
  if (!date) return 'time unavailable';
  return ZONES.map(
    zone =>
      `${date.toLocaleString('en-NZ', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' })} ${zone === ZONES[0] ? 'Sydney' : 'NZ'}`
  ).join(' · ');
}
module.exports = { formatLocalTimes, validDate };
