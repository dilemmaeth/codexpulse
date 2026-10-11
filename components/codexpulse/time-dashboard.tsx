'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { formatCodexTime } from '@/lib/codexpulse/time';
import { defaultTimeDate, shiftTimeDay, shiftTimePeriod, timeCutoff, timeHistoryBounds, timePeriod, type TimeMode } from '@/lib/codexpulse/time-history';
import type { CodexPulseSnapshot, Language } from '@/lib/codexpulse/types';

type Bar = { label: string; value: number | null; date?: string; future?: boolean };
const calendarDate = (date: string, language: Language, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
  new Intl.DateTimeFormat(language === 'hu' ? 'hu-HU' : 'en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

function TimeBars({ bars, language, hourly, onSelect }: { bars: Bar[]; language: Language; hourly?: boolean; onSelect?: (date: string) => void }) {
  const max = Math.max(3_600_000, Math.ceil(Math.max(...bars.map(bar => bar.value ?? 0), 0) / 3_600_000) * 3_600_000);
  const hu = language === 'hu';
  return <fieldset className="time-chart" aria-label={hu ? (hourly ? 'Idő óránként' : 'Idő naponként vagy hetente') : (hourly ? 'Time by hour' : 'Time by day or week')}>
    <div className="time-chart-scale" aria-hidden="true"><span>{formatCodexTime(max, language)}</span><span>{formatCodexTime(max / 2, language)}</span><span>0</span></div>
    <div className={`time-chart-columns ${hourly ? 'time-hour-columns' : ''}`} style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
      {bars.map((bar, index) => {
        const description = `${bar.label}: ${bar.future ? (hu ? 'jövőbeli időszak' : 'future period') : formatCodexTime(bar.value, language)}`;
        const fill = <span className="time-bar-fill" style={{ height: `${(bar.value ?? 0) / max * 100}%` }} />;
        return <div className="time-chart-column" key={`${bar.label}-${index}`} data-future={bar.future || undefined}>
          {onSelect && bar.date ? <button className="time-bar-track" aria-label={description} title={description} disabled={bar.future} onClick={() => onSelect(bar.date!)} data-missing={bar.value === null || undefined}>{fill}</button>
            : <figure className="time-bar-track" aria-label={description} title={description} data-missing={bar.value === null || undefined}>{fill}</figure>}
          <span className="time-bar-label" aria-hidden="true">{hourly ? (index % 6 === 0 ? bar.label : '') : bar.label}</span>
        </div>;
      })}
    </div>
  </fieldset>;
}

export function CodexTimeDashboard({ snapshot, language, selectedMonth, onMonth }: {
  snapshot: CodexPulseSnapshot; language: Language; selectedMonth: string; onMonth: (month: string) => void;
}) {
  const hu = language === 'hu';
  const [mode, setMode] = useState<TimeMode>('week');
  const [selection, setSelection] = useState({ month: selectedMonth, date: defaultTimeDate(snapshot, selectedMonth) });
  const date = selection.month === selectedMonth ? selection.date : defaultTimeDate(snapshot, selectedMonth);
  const period = timePeriod(snapshot, date, mode);
  const bounds = timeHistoryBounds(snapshot);
  const previous = shiftTimePeriod(date, mode, -1), next = shiftTimePeriod(date, mode, 1);
  const available = (target: string) => target >= bounds.first && target <= bounds.last && snapshot.months.some(month => month.id === target.slice(0, 7));
  const chooseDate = (target: string) => {
    setSelection({ date: target, month: target.slice(0, 7) });
    if (target.slice(0, 7) !== selectedMonth) onMonth(target.slice(0, 7));
  };
  const label = mode === 'month' ? calendarDate(period.start, language, { month: 'long', year: 'numeric' })
    : mode === 'day' ? calendarDate(date, language, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' })
      : `${calendarDate(period.start, language)} – ${calendarDate(period.end, language, { year: 'numeric', month: 'short', day: 'numeric' })}`;
  const day = period.days[0];
  let bars: Bar[];
  if (mode === 'day') {
    const currentHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Budapest', hour: '2-digit', hourCycle: 'h23' }).format(new Date(snapshot.generatedAt)));
    bars = Array.from({ length: 24 }, (_, hour) => {
      const future = date === timeCutoff(snapshot) && hour > currentHour;
      return { label: String(hour).padStart(2, '0'), value: future ? null : (day.hourlyMs?.[hour] ?? null), future };
    });
  }
  else if (mode === 'week') bars = period.days.map(item => ({ label: calendarDate(item.date, language, { weekday: 'short' }), value: item.activeMs, date: item.date, future: item.future }));
  else {
    const weeks = new Map<string, typeof period.days>();
    for (const item of period.days) {
      const weekday = new Date(`${item.date}T12:00:00Z`).getUTCDay();
      const monday = shiftTimeDay(item.date, -((weekday + 6) % 7));
      weeks.set(monday, [...(weeks.get(monday) || []), item]);
    }
    bars = [...weeks.values()].map(items => ({
      label: `${Number(items[0].date.slice(8))}–${Number(items.at(-1)!.date.slice(8))}`,
      value: items.some(item => item.activeMs !== null) ? items.reduce((sum, item) => sum + (item.activeMs ?? 0), 0) : null,
      date: items.find(item => !item.future)?.date ?? items[0].date, future: items.every(item => item.future),
    }));
  }
  const months = [...snapshot.months].sort((a, b) => b.id.localeCompare(a.id));
  const historyMax = Math.max(...months.map(month => month.timeEstimate?.activeMs ?? 0), 1);
  return <section className="panel codex-time time-dashboard" aria-label={hu ? 'Codex-idő előzmények' : 'Codex time history'}>
    <div className="panel-heading"><h2><Clock3 aria-hidden="true" />{hu ? 'Becsült Codex-idő' : 'Estimated Codex time'}</h2><span className="estimate-badge">{hu ? 'Becsült' : 'Estimated'}</span></div>
    <fieldset className="time-mode" aria-label={hu ? 'Időbontás' : 'Time breakdown'}>
      {(['day', 'week', 'month'] as TimeMode[]).map(item => <button key={item} aria-pressed={mode === item} onClick={() => setMode(item)}>{hu ? ({ day: 'Nap', week: 'Hét', month: 'Hónap' }[item]) : ({ day: 'Day', week: 'Week', month: 'Month' }[item])}</button>)}
    </fieldset>
    <div className="time-period-nav">
      <button aria-label={hu ? 'Előző időszak' : 'Previous period'} disabled={!available(previous)} onClick={() => chooseDate(previous)}><ChevronLeft /></button>
      <p aria-live="polite">{label}</p>
      <button aria-label={hu ? 'Következő időszak' : 'Next period'} disabled={!available(next)} onClick={() => chooseDate(next)}><ChevronRight /></button>
    </div>
    <strong className="time-total">{formatCodexTime(period.totalMs, language)}</strong>
    <p className="time-total-label">{hu ? ({ day: 'Napi', week: 'Heti', month: 'Havi' }[mode]) : ({ day: 'Daily', week: 'Weekly', month: 'Monthly' }[mode])} {hu ? 'rögzített idő · várakozással együtt' : 'recorded time · including waiting'}</p>
    {mode !== 'day' && <div className="time-stats">
      <div><span>{hu ? 'Napi átlag' : 'Daily average'}</span><strong>{formatCodexTime(period.averageMs, language)}</strong><small>{hu ? `${period.knownDays} rendelkezésre álló nap alapján` : `Based on ${period.knownDays} available days`}</small></div>
      <div><span>{hu ? 'Legaktívabb nap' : 'Most active day'}</span><strong>{formatCodexTime(period.peak?.activeMs ?? null, language)}</strong><small>{period.peak ? calendarDate(period.peak.date, language, { month: 'short', day: 'numeric', weekday: 'short' }) : '—'}</small></div>
    </div>}
    {period.totalMs === null ? <p className="time-empty">{hu ? 'Ehhez az időszakhoz nincs használható időadat. A régebbi napló hiányos lehet.' : 'No usable time data for this period. Older history may be incomplete.'}</p>
      : mode === 'day' && !day.hourlyMs ? <p className="time-empty">{hu ? 'A napi összeg elérhető. Az órás bontás frissített szinkronadatokkal jelenik meg.' : 'The daily total is available. Hourly detail needs updated sync data.'}</p>
        : <TimeBars bars={bars} language={language} hourly={mode === 'day'} onSelect={mode === 'day' ? undefined : target => { chooseDate(target); setMode(mode === 'month' ? 'week' : 'day'); }} />}
    {period.knownDays < period.elapsedDays && <p className="time-coverage">{hu ? `${period.elapsedDays - period.knownDays} eltelt nap időadata hiányzik; az összeg és az átlag csak az elérhető napokat tartalmazza.` : `${period.elapsedDays - period.knownDays} elapsed days have no time data; totals and averages include only available days.`}</p>}
    {mode === 'week' && period.totalMs !== null && <small className="time-chart-hint">{hu ? 'Koppints egy napra az órás bontáshoz. A halvány oszlopok jövőbeli napok.' : 'Tap a day for hourly detail. Faded columns are future days.'}</small>}
    {mode === 'month' && <>
      <small className="time-chart-hint">{period.totalMs === null
        ? (hu ? 'A naptárban a — hiányzó időadatot jelöl.' : 'In the calendar, — marks unavailable time data.')
        : (hu ? 'Az oszlopok heti összesítések. Válassz egy napot alább.' : 'Bars show weekly totals. Choose a day below.')}</small>
      <div className="time-calendar" aria-label={hu ? 'Napi időnaptár' : 'Daily time calendar'}>
        {Array.from({ length: 7 }, (_, index) => <span className="time-weekday" key={`weekday-${index}`}>{calendarDate(shiftTimeDay('2026-01-05', index), language, { weekday: 'short' })}</span>)}
        {Array.from({ length: (new Date(`${period.start}T12:00:00Z`).getUTCDay() + 6) % 7 }, (_, index) => <span key={`padding-${index}`} />)}
        {period.days.map(item => <button key={item.date} disabled={item.future} data-intensity={item.activeMs === null ? 'missing' : item.activeMs === 0 ? 'zero' : item.activeMs >= (period.peak?.activeMs ?? 1) * 0.6 ? 'high' : 'low'} aria-label={`${calendarDate(item.date, language, { month: 'long', day: 'numeric' })}: ${item.future ? (hu ? 'jövőbeli nap' : 'future day') : formatCodexTime(item.activeMs, language)}`} onClick={() => { chooseDate(item.date); setMode('day'); }}><span>{Number(item.date.slice(8))}</span><small>{item.activeMs === null ? '—' : `${Math.round(item.activeMs / 60_000)}′`}</small></button>)}
      </div>
    </>}
    {mode === 'day' && day.hourlyMs && <details className="time-hour-details"><summary>{hu ? 'Órás részletek' : 'Hourly details'}</summary>
      <small>{hu ? 'Az órás idők egész percre kerekítve jelennek meg.' : 'Hourly values are rounded to whole minutes.'}</small>
      <div className="time-hour-list">{day.hourlyMs.map((ms, hour) => ms > 0 ? <div key={hour}><span>{String(hour).padStart(2, '0')}:00–{String(hour + 1).padStart(2, '0')}:00</span><strong>{formatCodexTime(ms, language)}</strong></div> : null)}{day.activeMs === 0 && <p>{hu ? 'Nincs rögzített futás ezen a napon.' : 'No recorded runs on this day.'}</p>}</div>
    </details>}
    <details className="time-history-list"><summary>{hu ? `Havi előzmények · ${months.length} hónap` : `Monthly history · ${months.length} months`}</summary>
      {months.map(month => {
        const timing = month.timeEstimate;
        const value = timing && (timing.recordedTurns > 0 || timing.activeMs > 0) ? timing.activeMs : null;
        return <button key={month.id} aria-pressed={selectedMonth === month.id} onClick={() => { onMonth(month.id); setSelection({ month: month.id, date: defaultTimeDate(snapshot, month.id) }); setMode('month'); }}>
          <span>{calendarDate(`${month.id}-01`, language, { year: 'numeric', month: 'short' })}</span><strong>{formatCodexTime(value, language)}</strong><i aria-hidden="true"><span style={{ width: `${(value ?? 0) / historyMax * 100}%` }} /></i>
        </button>;
      })}
    </details>
    <details className="time-method"><summary>{hu ? 'Mit számolunk?' : 'What is measured?'}</summary>
      <p>{hu ? 'A naplózott fordulók futási idejét, a válaszokra várakozással együtt. Párhuzamos beszélgetések egyszer számítanak. A szünetek és a subagentek külön ideje kimarad. Az olvasást, gépelést és a képernyő előtt töltött időt nem mérjük; háttérben futó munka beleszámíthat. A nulla azt jelenti, hogy nincs rögzített futás, a — hiányzó időadatot jelöl. Hiányos naplók alulbecsülhetik a használatot. A napi átlag az eltelt, elérhető napokat tartalmazza, a nulla idejű napokkal együtt. Budapest időzónája szerint; óraátállításkor az ismétlődő óra összeadódik.' : 'Recorded turn runtime, including waiting for replies. Simultaneous chats count once. Gaps and separate subagent runtime are excluded. Reading, typing and screen time are not measured; background work may count. Zero means no recorded run; — means unavailable time data. Incomplete logs can undercount usage. Daily averages include elapsed, available days, including zero-time days. Uses Budapest time; a repeated DST hour is combined.'}</p>
      {snapshot.months.find(month => month.id === selectedMonth)?.timeEstimate?.skippedTurns ? <p>{hu ? 'A kiválasztott hónapban futó vagy hiányos fordulók is kimaradtak a becslésből.' : 'Running or incomplete turns in the selected month were omitted from the estimate.'}</p> : null}
    </details>
    <small className="time-captured">{hu ? 'Adatok rögzítve: ' : 'Data captured: '}{new Intl.DateTimeFormat(hu ? 'hu-HU' : 'en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Budapest' }).format(new Date(snapshot.generatedAt))} · Europe/Budapest</small>
  </section>;
}
