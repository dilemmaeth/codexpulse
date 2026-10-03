import type { MonthView } from './analytics';
import type { MonthReview } from './types';

export const EMPTY_REVIEW: MonthReview = { achievements: '', unfinished: '', nextFocus: '', closedAt: null };

export function reviewSummary(view: MonthView): NonNullable<MonthReview['summary']> {
  return {
    generatedAt: view.generatedAt, totalTokens: view.month.usage.totalTokens,
    tasks: view.tasks.length, activeDays: view.month.days.filter(day => day.totalTokens > 0).length,
    ...view.outcomes, resultPoints: view.resultPoints,
  };
}

export function canCloseMonth(view: MonthView, now: string) {
  const currentMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit' }).format(new Date(now));
  return view.month.id < currentMonth && view.month.id < view.generatedDate.slice(0, 7);
}

export function closeMonthReview(review: MonthReview, view: MonthView, now: string): MonthReview {
  if (!canCloseMonth(view, now) || review.closedAt) throw new Error('MONTH_NOT_CLOSABLE');
  return { ...review, closedAt: now, summary: reviewSummary(view) };
}
