'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { canCloseMonth, closeMonthReview, EMPTY_REVIEW, reviewSummary } from '@/lib/codexpulse/month-review';
import { useClock } from '@/lib/codexpulse/use-clock';
import type { MonthView } from '@/lib/codexpulse/analytics';
import type { Language, LocalVault } from '@/lib/codexpulse/types';

export function MonthReviewPanel({ language, view, vault, onVault }: {
  language: Language; view: MonthView; vault: LocalVault;
  onVault: (updater: (current: LocalVault) => LocalVault) => void;
}) {
  const hu = language === 'hu';
  const now = useClock();
  const [message, setMessage] = useState('');
  const review = vault.monthReviews?.[view.month.id] || EMPTY_REVIEW;
  const summary = review.summary || reviewSummary(view);
  const update = (next: typeof review) => onVault(current => ({ ...current, monthReviews: { ...current.monthReviews, [view.month.id]: next } }));
  const close = () => {
    try { update(closeMonthReview(review, view, new Date().toISOString())); setMessage(''); }
    catch { setMessage(hu ? 'Ez a hónap még nem zárható le.' : 'This month cannot be closed yet.'); }
  };
  const fields = [
    ['achievements', hu ? 'Mi készült el?' : 'What was completed?'],
    ['unfinished', hu ? 'Mi maradt nyitva?' : 'What remains open?'],
    ['nextFocus', hu ? 'Következő hónap fókusza' : 'Focus for next month'],
  ] as const;
  return <section className="panel month-review-panel" aria-label={hu ? 'Havi értékelés' : 'Monthly review'}>
    <div className="panel-heading"><h2>{hu ? 'Havi értékelés' : 'Monthly review'}</h2><span className="activity-subtle">{review.closedAt ? (hu ? 'Lezárt' : 'Closed') : (hu ? 'Piszkozat' : 'Draft')}</span></div>
    <p className="activity-hint">{summary.success} {hu ? 'sikeres' : 'successful'} · {summary.partial} {hu ? 'részleges' : 'partial'} · {summary.failed} {hu ? 'sikertelen' : 'failed'} · {summary.open} {hu ? 'nyitott' : 'open'}</p>
    {review.closedAt && <p className="activity-hint">{hu ? 'Lezáráskor rögzített állapot' : 'State captured at closure'}: {summary.tasks} {hu ? 'feladat' : 'tasks'}, {summary.activeDays} {hu ? 'aktív nap' : 'active days'}, {new Intl.NumberFormat(hu ? 'hu-HU' : 'en-US').format(summary.totalTokens)} token. {hu ? 'Forrásadat' : 'Source captured'}: {summary.generatedAt.slice(0, 10)}.</p>}
    {fields.map(([field, label]) => <label className="review-field" key={field}><span>{label}</span><textarea value={review[field]} readOnly={Boolean(review.closedAt)} maxLength={2000} rows={3} onChange={event => update({ ...review, [field]: event.target.value })} /></label>)}
    <p className="activity-hint">{hu ? 'A jegyzetek a titkosított helyi mentés részei, és nem kerülnek a megosztható PNG/PDF riportba. A lezárt értékelést az új adatok nem írják át.' : 'Notes are included in your encrypted local backup and excluded from shared PNG/PDF reports. New data does not change a closed review.'}</p>
    {review.closedAt ? <AlertDialog><AlertDialogTrigger render={<Button variant="outline" />}>{hu ? 'Értékelés újranyitása' : 'Reopen review'}</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{hu ? 'Újranyitod az értékelést?' : 'Reopen this review?'}</AlertDialogTitle><AlertDialogDescription>{hu ? 'A jegyzetek megmaradnak. A következő lezárás az akkor elérhető mutatókat rögzíti.' : 'Notes are preserved. Closing again captures the metrics available at that time.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{hu ? 'Mégse' : 'Cancel'}</AlertDialogCancel><AlertDialogAction onClick={() => update({ ...review, closedAt: null, summary: undefined })}>{hu ? 'Újranyitás' : 'Reopen'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> : <Button variant="outline" disabled={!canCloseMonth(view, new Date(now).toISOString())} onClick={close}>{hu ? 'Havi értékelés lezárása' : 'Close monthly review'}</Button>}
    {!review.closedAt && !canCloseMonth(view, new Date(now).toISOString()) && <p className="activity-hint">{hu ? 'Lezárás a hónap vége után, egy következő havi szinkronnal lehetséges.' : 'Close after month end and a sync captured in a later month.'}</p>}
    {message && <output className="activity-hint">{message}</output>}
  </section>;
}
