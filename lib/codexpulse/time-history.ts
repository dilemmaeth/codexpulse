import type { CodexPulseSnapshot } from './types';

export type TimeMode = 'day' | 'week' | 'month';
export type TimeDay = {
  date: string;
  activeMs: number | null;
  hourlyMs: number[] | null;
  future: boolean;
  tokens: number;
  turns: number;
};

const dateUTC = (date: string) => new Date(`${date}T12:00:00Z`);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
export function shiftTimeDay(date: string, count: number) {
  const result = dateUTC(date);
  result.setUTCDate(result.getUTCDate() + count);
  return isoDay(result);
}

export function monthEndDate(month: string) {
  const date = dateUTC(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return isoDay(date);
}

export function timeCutoff(snapshot: CodexPulseSnapshot) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(snapshot.generatedAt));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export function defaultTimeDate(snapshot: CodexPulseSnapshot, month: string) {
  const cutoff = timeCutoff(snapshot);
  return cutoff.slice(0, 7) === month ? cutoff : monthEndDate(month);
}

export function shiftTimePeriod(date: string, mode: TimeMode, direction: number) {
  if (mode !== 'month') return shiftTimeDay(date, direction * (mode === 'week' ? 7 : 1));
  const result = dateUTC(`${date.slice(0, 7)}-01`);
  result.setUTCMonth(result.getUTCMonth() + direction);
  return isoDay(result);
}

export function timeDay(snapshot: CodexPulseSnapshot, date: string): TimeDay {
  const future = date > timeCutoff(snapshot);
  const month = snapshot.months.find(item => item.id === date.slice(0, 7));
  const time = month?.timeEstimate;
  const usable = time?.method === 'root-turn-union-v1' && Number.isFinite(time.activeMs) && time.activeMs >= 0 && (time.recordedTurns > 0 || time.activeMs > 0);
  const timing = time?.days.find(day => day.date === date);
  const usage = month?.days.find(day => day.date === date);
  const activeMs = future || !usable ? null : (timing?.activeMs ?? 0);
  const hours = timing?.hourlyMs;
  const validHours = hours?.length === 24 && hours.every(ms => Number.isFinite(ms) && ms >= 0)
    && Math.abs(hours.reduce((sum, ms) => sum + ms, 0) - (activeMs ?? 0)) < 1;
  return {
    date, activeMs, future, tokens: usage?.totalTokens ?? 0, turns: usage?.turns ?? 0,
    hourlyMs: activeMs === null ? null : (validHours ? hours! : (activeMs === 0 ? Array<number>(24).fill(0) : null)),
  };
}

export function timePeriod(snapshot: CodexPulseSnapshot, date: string, mode: TimeMode) {
  let start = date, end = date;
  if (mode === 'week') {
    start = shiftTimeDay(date, -((dateUTC(date).getUTCDay() + 6) % 7));
    end = shiftTimeDay(start, 6);
  } else if (mode === 'month') {
    start = `${date.slice(0, 7)}-01`;
    end = monthEndDate(date.slice(0, 7));
  }
  const days: TimeDay[] = [];
  for (let cursor = start; cursor <= end; cursor = shiftTimeDay(cursor, 1)) days.push(timeDay(snapshot, cursor));
  const elapsed = days.filter(day => !day.future);
  const known = elapsed.filter(day => day.activeMs !== null);
  const totalMs = known.length ? known.reduce((sum, day) => sum + day.activeMs!, 0) : null;
  const averageMs = totalMs === null ? null : totalMs / known.length;
  const peak = known.reduce<TimeDay | null>((best, day) => day.activeMs! > (best?.activeMs ?? 0) ? day : best, null);
  return { start, end, days, totalMs, averageMs, peak, knownDays: known.length, elapsedDays: elapsed.length, activeDays: known.filter(day => day.activeMs! > 0).length };
}

export function timeHistoryBounds(snapshot: CodexPulseSnapshot) {
  const months = snapshot.months.map(month => month.id).sort();
  return { first: `${months[0]}-01`, last: [monthEndDate(months.at(-1)!), timeCutoff(snapshot)].sort()[0] };
}
