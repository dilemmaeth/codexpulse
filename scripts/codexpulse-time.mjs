import { usageDay } from './codexpulse-ledger.mjs';

const DAY = 86_400_000;
const TERMINAL = new Set(['completed', 'interrupted', 'failed']);

function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  const ms = number > 10_000_000_000 ? number : number * 1000;
  return Number.isFinite(ms) && ms > 0 && ms <= 8.64e15 ? ms : null;
}

function isSubagent(thread) {
  if (['subagent', 'guardian_review'].includes(thread.thread_source)) return true;
  try { return Boolean(JSON.parse(thread.source)?.subagent); } catch { return false; }
}

// Find the next Budapest midnight, including 23/25-hour DST days.
function nextMidnight(start) {
  const day = usageDay(new Date(start).toISOString());
  let low = Math.floor(start), high = low + 27 * 3_600_000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (usageDay(new Date(mid).toISOString()) === day) low = mid;
    else high = mid;
  }
  return high;
}

/** Recorded root-turn elapsed time; a proxy for usage, never human attention. */
export function buildTimeEstimates({ threads, edges, turns }, generatedAt) {
  const cutoff = Date.parse(generatedAt);
  if (!Number.isFinite(cutoff)) throw new Error('Invalid time estimate cutoff');
  const children = new Set(edges.map(edge => edge.child_thread_id));
  const roots = new Set(threads.filter(thread => !children.has(thread.id) && !isSubagent(thread)).map(thread => thread.id));
  const months = new Map(), intervals = [];
  const ensure = (date) => {
    const id = date.slice(0, 7);
    if (!months.has(id)) months.set(id, { method: 'root-turn-union-v1', activeMs: 0, recordedTurns: 0, skippedTurns: 0, days: new Map() });
    return months.get(id);
  };
  for (const turn of turns) {
    if (!roots.has(turn.thread_id)) continue;
    const start = timestamp(turn.started_at), completed = timestamp(turn.completed_at);
    const anchor = start ?? completed;
    if (anchor === null || anchor > cutoff) continue;
    const month = ensure(usageDay(new Date(anchor).toISOString()));
    const hasDuration = turn.duration_ms !== null && turn.duration_ms !== undefined;
    const duration = hasDuration ? Number(turn.duration_ms) : null;
    // Running turns can be stale after an app restart: never extend them to now.
    if (!TERMINAL.has(turn.status) || start === null || (hasDuration && (!Number.isFinite(duration) || duration < 0))) {
      month.skippedTurns += 1;
      continue;
    }
    const end = completed === null ? (duration === null ? null : start + duration)
      : (duration === null ? completed : Math.min(completed, start + duration));
    if (end === null || end < start || end > cutoff || (completed !== null && completed < start)) {
      month.skippedTurns += 1;
      continue;
    }
    month.recordedTurns += 1;
    if (end > start) intervals.push([start, end]);
  }
  // Union across every root, so simultaneous chats and forked history count once.
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of intervals) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  for (const [start, end] of merged) {
    for (let cursor = start; cursor < end;) {
      const date = usageDay(new Date(cursor).toISOString());
      const until = Math.min(end, nextMidnight(cursor));
      const month = ensure(date), elapsed = until - cursor;
      month.activeMs += elapsed;
      month.days.set(date, (month.days.get(date) || 0) + elapsed);
      cursor = until;
    }
  }
  return new Map([...months].map(([id, month]) => [id, {
    ...month,
    days: [...month.days].map(([date, activeMs]) => ({ date, activeMs })).sort((a, b) => a.date.localeCompare(b.date)),
  }]));
}

export const MAX_DAILY_TIME_MS = DAY + 3_600_000;
