import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const importTS = async path => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'))).toString('base64')}`);
const history = await importTS('../lib/codexpulse/time-history.ts');
const { DEMO_SNAPSHOT } = await importTS('../lib/codexpulse/demo.ts');
const minute = 60_000;

test('partial weeks and months exclude future days from totals and daily averages', () => {
  const week = history.timePeriod(DEMO_SNAPSHOT, '2026-09-08', 'week');
  assert.equal(week.start, '2026-09-07');
  assert.equal(week.end, '2026-09-13');
  assert.equal(week.totalMs, 100 * minute);
  assert.equal(week.averageMs, 50 * minute);
  assert.equal(week.knownDays, 2);
  assert.equal(week.days.filter(day => day.future).length, 5);
  assert.equal(week.peak.date, '2026-09-07');
  const month = history.timePeriod(DEMO_SNAPSHOT, '2026-09-08', 'month');
  assert.equal(month.totalMs, DEMO_SNAPSHOT.months[2].timeEstimate.activeMs);
  assert.equal(month.elapsedDays, 8);
  assert.equal(month.averageMs, 450 * minute / 8);
  assert.equal(month.days.length, 30);
});

test('missing historical months stay unknown in weeks crossing a month boundary', () => {
  const week = history.timePeriod(DEMO_SNAPSHOT, '2026-09-01', 'week');
  assert.equal(week.start, '2026-08-31');
  assert.equal(week.days[0].activeMs, null);
  assert.equal(week.knownDays, 6);
  assert.equal(week.elapsedDays, 7);
  assert.equal(week.totalMs, 350 * minute);
  assert.equal(week.averageMs, 350 * minute / 6);
  const missing = history.timePeriod(DEMO_SNAPSHOT, '2026-08-10', 'week');
  assert.equal(missing.totalMs, null);
  assert.equal(missing.averageMs, null);
  assert.equal(missing.knownDays, 0);
});

test('known zero days count toward averages without fabricating hourly detail for old positive days', () => {
  const snapshot = structuredClone(DEMO_SNAPSHOT);
  snapshot.generatedAt = '2026-09-30T20:00:00Z';
  const month = history.timePeriod(snapshot, '2026-09-01', 'month');
  assert.equal(month.knownDays, 30);
  assert.equal(month.activeDays, 8);
  assert.equal(month.averageMs, 15 * minute);
  assert.deepEqual(history.timeDay(snapshot, '2026-09-20').hourlyMs, Array(24).fill(0));
  delete snapshot.months[2].timeEstimate.days[0].hourlyMs;
  assert.equal(history.timeDay(snapshot, '2026-09-01').activeMs, 45 * minute);
  assert.equal(history.timeDay(snapshot, '2026-09-01').hourlyMs, null);
  assert.equal(history.timeDay(snapshot, '2026-10-02').activeMs, null);
});

test('date navigation handles leap years, DST and year boundaries using Budapest cutoff', () => {
  assert.equal(history.monthEndDate('2028-02'), '2028-02-29');
  assert.equal(history.shiftTimeDay('2026-10-25', 1), '2026-10-26');
  assert.equal(history.shiftTimePeriod('2026-12-31', 'month', 1), '2027-01-01');
  assert.equal(history.shiftTimePeriod('2026-10-25', 'week', -1), '2026-10-18');
  const snapshot = { ...DEMO_SNAPSHOT, generatedAt: '2026-09-30T22:15:00Z' };
  assert.equal(history.timeCutoff(snapshot), '2026-10-01');
  assert.equal(history.defaultTimeDate(snapshot, '2026-09'), '2026-09-30');
  assert.equal(history.defaultTimeDate(snapshot, '2026-10'), '2026-10-01');
  assert.deepEqual(history.timeHistoryBounds(snapshot), { first: '2026-07-01', last: '2026-09-30' });
});

test('a cross-month interval with no new turn starts still provides a valid day', () => {
  const snapshot = structuredClone(DEMO_SNAPSHOT);
  snapshot.months[2].timeEstimate.recordedTurns = 0;
  assert.equal(history.timeDay(snapshot, '2026-09-01').activeMs, 45 * minute);
  snapshot.months[2].timeEstimate.days[0].hourlyMs[0] = 100;
  assert.equal(history.timeDay(snapshot, '2026-09-01').hourlyMs, null);
});
