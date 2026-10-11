import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { buildTimeEstimates } from '../scripts/codexpulse-time.mjs';
import { usageDay } from '../scripts/codexpulse-ledger.mjs';

const importTS = async (name) => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(readFileSync(new URL(name, import.meta.url), 'utf8'))).toString('base64')}`);
const { formatCodexTime, monthTimeSummary } = await importTS('../lib/codexpulse/time.ts');
const minute = 60_000;
const at = (value) => Date.parse(value) / 1000;
const turn = (start, end, extra = {}) => ({ thread_id: 'root', status: 'completed', started_at: at(start), completed_at: at(end), ...extra });
const estimate = (turns, extra = {}, cutoff = '2026-11-02T00:00:00Z') => buildTimeEstimates({ threads: [{ id: 'root' }, { id: 'other' }], edges: [], turns, ...extra }, cutoff);

test('union counts parallel chats and duplicates once, keeping idle gaps out', () => {
  const first = turn('2026-09-01T08:00:00Z', '2026-09-01T08:10:00Z');
  const time = estimate([
    first, first,
    turn('2026-09-01T08:05:00Z', '2026-09-01T08:15:00Z', { thread_id: 'other' }),
    turn('2026-09-01T09:00:00Z', '2026-09-01T09:05:00Z'),
  ]).get('2026-09');
  assert.equal(time.activeMs, 20 * minute);
  assert.deepEqual(time.days, [{ date: '2026-09-01', activeMs: 20 * minute }]);
});

test('spawn edges, orphan subagents, guardians and unknown thread IDs add no time', () => {
  const record = turn('2026-09-01T08:00:00Z', '2026-09-01T09:00:00Z');
  const threads = [{ id: 'root', source: 'vscode', thread_source: 'user' },
    { id: 'child' }, { id: 'orphan', source: JSON.stringify({ subagent: { other: 'guardian' } }) },
    { id: 'guardian', thread_source: 'guardian_review' }, { id: 'subagent', thread_source: 'subagent' }];
  const time = estimate(['root', 'child', 'orphan', 'guardian', 'subagent', 'missing'].map(thread_id => ({ ...record, thread_id })),
    { threads, edges: [{ child_thread_id: 'child', parent_thread_id: 'root' }] }).get('2026-09');
  assert.equal(time.activeMs, 60 * minute);
  assert.equal(time.recordedTurns, 1);
});

test('month crossing is split at Budapest midnight, without assigning all time to start month', () => {
  const times = estimate([turn('2026-09-30T21:50:00Z', '2026-09-30T22:10:00Z')]);
  assert.equal(times.get('2026-09').activeMs, 10 * minute);
  assert.equal(times.get('2026-10').activeMs, 10 * minute);
  assert.equal(monthTimeSummary(timesToMonth('2026-10', times)).dailyAverageMs, 10 * minute);
  assert.equal(times.get('2026-10').days[0].date, '2026-10-01');
});

test('Budapest DST days have 23 and 25 recorded hours, preserving total elapsed time', () => {
  const spring = estimate([turn('2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z')]).get('2026-03');
  const autumn = estimate([turn('2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z')]).get('2026-10');
  assert.deepEqual(spring.days, [{ date: '2026-03-29', activeMs: 23 * 60 * minute }]);
  assert.deepEqual(autumn.days, [{ date: '2026-10-25', activeMs: 25 * 60 * minute }]);
});

test('recorded duration bounds restart/suspend wall time; missing completion uses terminal duration', () => {
  const time = estimate([
    turn('2026-09-01T08:00:00Z', '2026-09-01T14:00:00Z', { duration_ms: 10 * minute }),
    turn('2026-09-01T15:00:00Z', '2026-09-01T16:00:00Z', { completed_at: null, duration_ms: 5 * minute, status: 'interrupted' }),
    turn('2026-09-01T17:00:00Z', '2026-09-01T17:02:00Z', { status: 'failed' }),
  ]).get('2026-09');
  assert.equal(time.activeMs, 17 * minute);
  assert.equal(time.recordedTurns, 3);
});

test('ongoing, reversed, nonfinite, negative and incomplete records never fabricate elapsed time', () => {
  const base = turn('2026-09-01T08:00:00Z', '2026-09-01T08:10:00Z');
  const time = estimate([
    { ...base, status: 'inProgress', completed_at: null },
    { ...base, completed_at: base.started_at - 10 },
    { ...base, duration_ms: NaN }, { ...base, duration_ms: -1 },
    { ...base, completed_at: null }, { ...base, started_at: null },
    { ...base, started_at: Infinity, completed_at: null },
  ]).get('2026-09');
  assert.equal(time.activeMs, 0);
  assert.equal(time.skippedTurns, 6);
  assert.equal(monthTimeSummary({ timeEstimate: time }), null);
  assert.equal(estimate([]).size, 0);
});

test('future and stale running records stay excluded; millisecond timestamps are supported', () => {
  const time = estimate([
    turn('2026-09-01T08:00:00Z', '2026-09-01T08:10:00Z', { started_at: Date.parse('2026-09-01T08:00:00Z'), completed_at: Date.parse('2026-09-01T08:10:00Z') }),
    turn('2026-09-01T08:00:00Z', '2026-09-05T08:00:00Z', { status: 'inProgress' }),
    turn('2026-09-01T10:00:00Z', '2026-09-02T08:00:00Z'),
    turn('2026-09-03T08:00:00Z', '2026-09-03T08:10:00Z'),
  ], {}, '2026-09-01T12:00:00Z').get('2026-09');
  assert.equal(time.activeMs, 10 * minute);
  assert.equal(time.skippedTurns, 2);
});

function timesToMonth(id, times) { return { id, timeEstimate: times.get(id) }; }

test('formatting and daily average distinguish missing time, zero, subminute and hours', () => {
  assert.equal(formatCodexTime(null, 'hu'), '—');
  assert.equal(formatCodexTime(NaN, 'hu'), '—');
  assert.equal(formatCodexTime(0, 'hu'), '0 perc');
  assert.equal(formatCodexTime(1, 'hu'), '<1 perc');
  assert.equal(formatCodexTime(90 * minute, 'hu'), '1 óra 30 perc');
  assert.equal(formatCodexTime(120 * minute, 'en'), '2 h');
  const time = estimate([
    turn('2026-09-01T08:00:00Z', '2026-09-01T08:10:00Z'),
    turn('2026-09-02T08:00:00Z', '2026-09-02T08:20:00Z'),
  ]);
  assert.equal(monthTimeSummary(timesToMonth('2026-09', time)).dailyAverageMs, 15 * minute);
  assert.equal(monthTimeSummary({}), null);
});

test('collector integration adds aggregate time without changing token totals or model allocation', () => {
  const source = readFileSync(new URL('../scripts/codexpulse-sync.mjs', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('function zeroUsage()'), source.indexOf('function readUsageCache()'));
  const build = source.slice(source.indexOf('function buildMonths('), source.indexOf('function countLargeRollouts('));
  const context = vm.createContext({ EXACT_FROM: '2026-09-01', dayId: usageDay, asIso: value => new Date(value * 1000).toISOString() });
  vm.runInContext(`${functions}\n${build}\nthis.build = buildMonths;`, context);
  const cache = { daily: [{ date: '2026-09-01', totalTokens: 100, models: { sol: { totalTokens: 100 } } }] };
  const plain = context.build([], cache, null, new Map());
  const times = estimate([turn('2026-09-30T21:50:00Z', '2026-09-30T22:10:00Z')]);
  const timed = context.build([], cache, null, times);
  assert.equal(timed.length, 2);
  assert.deepEqual(timed[0].usage, plain[0].usage);
  assert.deepEqual(timed[0].days, plain[0].days);
  assert.deepEqual(timed[0].models, plain[0].models);
  assert.equal(timed[1].usage.totalTokens, 0);
  assert.equal(timed[1].timeEstimate.activeMs, 10 * minute);
  assert.deepEqual(Object.keys(timed[1].timeEstimate).sort(), ['activeMs', 'days', 'method', 'recordedTurns', 'skippedTurns']);
  assert.deepEqual(Object.keys(timed[1].timeEstimate.days[0]).sort(), ['activeMs', 'date']);
});
