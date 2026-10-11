import type { Language, MonthRecord } from './types';

export function formatCodexTime(ms: number | null, language: Language) {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms > 0 && ms < 60_000) return language === 'hu' ? '<1 perc' : '<1 min';
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  const number = new Intl.NumberFormat(language === 'hu' ? 'hu-HU' : 'en-US');
  if (hours === 0) return `${number.format(rest)} ${language === 'hu' ? 'perc' : 'min'}`;
  return `${number.format(hours)} ${language === 'hu' ? 'óra' : 'h'}${rest ? ` ${rest} ${language === 'hu' ? 'perc' : 'min'}` : ''}`;
}

export function monthTimeSummary(month: MonthRecord) {
  const time = month.timeEstimate;
  if (!time || time.method !== 'root-turn-union-v1' || !Number.isFinite(time.activeMs) || time.activeMs < 0
    || (time.recordedTurns === 0 && time.activeMs === 0)) return null;
  const activeDays = time.days.filter(day => day.activeMs > 0).length;
  return { ...time, activeDays, dailyAverageMs: activeDays ? time.activeMs / activeDays : 0 };
}
