'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MonthHeading } from './screens';
import { CATEGORY_ORDER, effectiveCategory, effectiveOutcome, projectName, type MonthView } from '@/lib/codexpulse/analytics';
import { categoryLabel, outcomeLabel, t } from '@/lib/codexpulse/i18n';
import type { CategoryId, Language, LocalVault, OutcomeId, TokenUsage } from '@/lib/codexpulse/types';

function UsageDetails({ usage, language }: { usage: TokenUsage; language: Language }) {
  const fields: [string, number | null][] = [
    ['Input', usage.inputTokens], ['Cache read', usage.cacheReadTokens],
    ['Cache write', usage.cacheWriteTokens], ['Output', usage.outputTokens],
    ['Reasoning', usage.reasoningTokens],
    [language === 'hu' ? 'Összes token' : 'Total tokens', usage.totalTokens],
  ];
  return <dl className="usage-breakdown">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === null ? '—' : new Intl.NumberFormat(language === 'hu' ? 'hu-HU' : 'en-US').format(Math.round(value))}</dd></div>)}</dl>;
}

export function ActivityScreen({ language, view, months, selectedMonth, onMonth, vault, onVault }: {
  language: Language; view: MonthView; months: string[]; selectedMonth: string;
  onMonth: (month: string) => void; vault: LocalVault;
  onVault: (updater: (current: LocalVault) => LocalVault) => void;
}) {
  const [daysExpanded, setDaysExpanded] = useState(false);
  const [taskLimit, setTaskLimit] = useState(8);
  const hu = language === 'hu';
  const locale = hu ? 'hu-HU' : 'en-US';
  const number = (value: number) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const money = (value: number | null) => value === null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  const days = [...view.month.days].sort((a, b) => b.date.localeCompare(a.date));
  const activeDays = days.filter((day) => day.totalTokens > 0).length;
  const maxTokens = Math.max(1, ...days.map((day) => day.totalTokens));
  return <div className="screen-stack activity-screen">
    <MonthHeading language={language} selectedMonth={selectedMonth} months={months} onMonth={onMonth} />
    <section className="panel activity-overview" aria-label={hu ? 'Havi tokenösszesítő' : 'Monthly token summary'}>
      <div className="activity-totals"><div><span>{t(language, 'totalTokens')}</span><strong>{number(view.month.usage.totalTokens)}</strong></div><div><span>{hu ? 'API-költség · becslés' : 'API cost · estimate'}</span><strong>{money(view.month.usage.costUSD)}</strong></div></div>
      <p className="activity-counts">{activeDays} {t(language, 'activeDays').toLowerCase()}<span>·</span>{view.tasks.length} {t(language, 'tasks').toLowerCase()}<span>·</span>{view.totalTurns} {t(language, 'turns').toLowerCase()}</p>
      <details className="monthly-token-details"><summary>{hu ? 'Havi tokenbontás' : 'Monthly token breakdown'}<ChevronDown aria-hidden="true" /></summary><UsageDetails usage={view.month.usage} language={language} /></details>
    </section>
    <section className="panel daily-usage-panel" aria-labelledby="daily-usage-heading">
      <div className="panel-heading"><h2 id="daily-usage-heading">{hu ? 'Napi használat' : 'Daily usage'}</h2><span className="activity-subtle">{hu ? 'Legfrissebb elöl' : 'Newest first'}</span></div>
      <p className="activity-hint">{hu ? 'Koppints egy napra a részletekért.' : 'Tap a day to see the breakdown.'}</p>
      <div className="daily-table-head" aria-hidden="true"><span>{hu ? 'Nap' : 'Day'}</span><span>Token</span><span>{hu ? 'API-becslés' : 'API estimate'}</span><span /></div>
      <div className="daily-usage-list">{(daysExpanded ? days : days.slice(0, 7)).map((day) => <details className="daily-usage-row" key={day.date}>
        <summary>
          <span className="daily-date"><strong>{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`))}</strong><small>{day.estimated ? (hu ? 'Becsült' : 'Estimated') : (hu ? 'Naplóadat' : 'Logged')}</small></span>
          <span className="daily-token"><strong>{number(day.totalTokens)}</strong><i aria-hidden="true"><b style={{ width: `${day.totalTokens / maxTokens * 100}%` }} /></i></span>
          <span className="daily-cost">{money(day.costUSD)}</span><ChevronDown aria-hidden="true" />
        </summary>
        <div className="daily-expanded"><UsageDetails usage={day} language={language} />
          <div className="daily-models"><span>{hu ? 'Modellek' : 'Models'}</span>{day.models?.length ? <ul>{day.models.map((model) => <li key={model}>{model}</li>)}</ul> : <p>{hu ? 'Ehhez a naphoz nincs modellbontás.' : 'No model breakdown is available for this day.'}</p>}</div>
          <p className="activity-hint">{day.turns} {t(language, 'turns').toLowerCase()} · {day.activeTasks} {t(language, 'tasks').toLowerCase()}</p>
          {day.estimated && <p className="activity-hint">{hu ? 'Ez a nap becsült vagy részben becsült adatokat tartalmaz.' : 'This day contains estimated or partly estimated data.'}</p>}
        </div>
      </details>)}</div>
      {!days.length && <p className="activity-hint">{hu ? 'Ehhez a hónaphoz még nincs napi kimutatás.' : 'No daily records for this month yet.'}</p>}
      {days.length > 7 && <Button variant="ghost" className="activity-more" onClick={() => setDaysExpanded(!daysExpanded)}>{daysExpanded ? (hu ? 'Kevesebb nap' : 'Fewer days') : (hu ? `Mind a ${days.length} nap` : `All ${days.length} days`)}</Button>}
      <p className="activity-explainer">{hu ? 'Az USD-összeg API-áron számolt becslés, nem az előfizetésed számlája. A Reasoning az Output része; nem adódik hozzá újra az összeshez. A — hiányzó adatot jelent.' : 'USD amounts estimate API pricing, not your subscription bill. Reasoning is part of Output and is not added again to the total. — means unavailable.'}</p>
    </section>
    <section className="panel compact-tasks" aria-labelledby="activity-tasks-heading">
      <div className="panel-heading"><h2 id="activity-tasks-heading">{t(language, 'recentTasks')}</h2><span className="activity-subtle">{view.tasks.length}</span></div>
      <p className="activity-hint">{hu ? 'Nyiss meg egy feladatot a besorolás módosításához.' : 'Open a task to change its category or outcome.'}</p>
      {view.tasks.slice(0, taskLimit).map((task) => <details key={task.id} className="compact-task">
        <summary><div><strong>{task.title}</strong><span>{projectName(task, vault, view.tasks)} · {number(task.months[selectedMonth].tokens)} token</span><small>{categoryLabel(language, effectiveCategory(task, vault))} · {outcomeLabel(language, effectiveOutcome(task, vault))}</small></div><ChevronDown aria-hidden="true" /></summary>
        <div className="task-controls">
          <label><span>{t(language, 'category')}</span><Select value={effectiveCategory(task, vault)} onValueChange={(value) => onVault((current) => ({ ...current, categoryOverrides: { ...current.categoryOverrides, [task.id]: value as CategoryId } }))}>
            <SelectTrigger className="task-select" aria-label={t(language, 'category')}><SelectValue>{categoryLabel(language, effectiveCategory(task, vault))}</SelectValue></SelectTrigger><SelectContent>{CATEGORY_ORDER.map((category) => <SelectItem key={category} value={category}>{categoryLabel(language, category)}</SelectItem>)}</SelectContent>
          </Select></label>
          <label><span>{t(language, 'outcome')}</span><Select value={effectiveOutcome(task, vault)} onValueChange={(value) => onVault((current) => ({ ...current, outcomeOverrides: { ...current.outcomeOverrides, [task.id]: value as OutcomeId } }))}>
            <SelectTrigger className="task-select" aria-label={t(language, 'outcome')}><SelectValue>{outcomeLabel(language, effectiveOutcome(task, vault))}</SelectValue></SelectTrigger><SelectContent>{(['success', 'partial', 'failed', 'open'] as OutcomeId[]).map((outcome) => <SelectItem key={outcome} value={outcome}>{outcomeLabel(language, outcome)}</SelectItem>)}</SelectContent>
          </Select></label>
        </div>
      </details>)}
      {view.tasks.length > taskLimit && <Button variant="ghost" className="activity-more" onClick={() => setTaskLimit(taskLimit + 10)}>{hu ? 'További feladatok' : 'More tasks'} ({view.tasks.length - taskLimit})</Button>}
    </section>
  </div>;
}
