'use client';

import { useState, type CSSProperties } from 'react';
import { useClock } from '@/lib/codexpulse/use-clock';
import {
  CheckCircle2,
  Download,
  FileText,
  FolderKanban,
  Info,
  Layers3,
  Share2,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  monthlyHighlights,
  type MonthView,
} from '@/lib/codexpulse/analytics';
import { categoryLabel, outcomeLabel, t } from '@/lib/codexpulse/i18n';
import { exportReport } from '@/lib/codexpulse/report';
import type {
  CodexPulseSnapshot,
  Language,
  LocalVault,
  OutcomeId,
} from '@/lib/codexpulse/types';

const compact = (value: number, language: Language) =>
  new Intl.NumberFormat(language === 'hu' ? 'hu-HU' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

const integer = (value: number, language: Language) =>
  new Intl.NumberFormat(language === 'hu' ? 'hu-HU' : 'en-US').format(Math.round(value));

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value)}%`);
const dateLocale = (language: Language) => (language === 'hu' ? 'hu-HU' : 'en-US');

export function monthLabel(monthId: string, language: Language) {
  return new Intl.DateTimeFormat(dateLocale(language), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${monthId}-01T12:00:00Z`));
}

function EstimateBadge({ language }: { language: Language }) {
  return <span className="estimate-badge"><Info />{t(language, 'estimated')}</span>;
}

function Metric({ label, value, detail, accent }: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <article className={`metric-card ${accent ? 'metric-accent' : ''}`}>
      <p>{label}</p><strong>{value}</strong><span>{detail}</span>
    </article>
  );
}

export function MonthHeading({ language, selectedMonth, months, onMonth }: {
  language: Language;
  selectedMonth: string;
  months: string[];
  onMonth: (month: string) => void;
}) {
  return (
    <section className="month-heading">
      <div><p className="eyebrow">{t(language, 'monthlyOverview')}</p><h1>{monthLabel(selectedMonth, language)}</h1></div>
      <Select value={selectedMonth} onValueChange={(value) => onMonth(String(value))}>
        <SelectTrigger className="month-picker" aria-label={t(language, 'month')}><SelectValue>{selectedMonth}</SelectValue></SelectTrigger>
        <SelectContent className="month-options">
          {months.map((month) => <SelectItem value={month} key={month}>{monthLabel(month, language)}</SelectItem>)}
        </SelectContent>
      </Select>
    </section>
  );
}

function MonthlySummary({ language, view }: { language: Language; view: MonthView }) {
  const hu = language === 'hu';
  const highlights = monthlyHighlights(view);
  const categories = highlights.leadingCategories;
  const project = highlights.leadingProject;
  const change = view.previousMonthChange;
  const roundedChange = change === null ? null : Math.round(Math.abs(change));
  return <section className="panel monthly-summary" aria-label={hu ? 'Hónap röviden' : 'Month in brief'}>
    <h2>{hu ? 'Hónap röviden' : 'Month in brief'}</h2>
    <p>{hu ? `${view.tasks.length} feladat, ${highlights.activeDays} aktív nap a rögzített adatokban.` : `${view.tasks.length} tasks and ${highlights.activeDays} active days in the recorded data.`}</p>
    {categories.length > 0 && <p>{hu ? (categories.length > 1 ? 'Megosztott fókusz: ' : 'Fő fókusz: ') : (categories.length > 1 ? 'Shared focus: ' : 'Main focus: ')}<strong>{categories.map((category) => categoryLabel(language, category.id)).join(', ')}</strong>{hu ? ` — ${Math.round(categories[0].taskShare)}%${categories.length > 1 ? ' kategóriánként' : ''}, feladatszám alapján.` : ` — ${Math.round(categories[0].taskShare)}%${categories.length > 1 ? ' each' : ''}, by task count.`}</p>}
    {project && <p>{hu ? 'A látható projektek közül a legtöbb becsült token: ' : 'Most estimated tokens among visible projects: '}<strong>{project.name}</strong>{hu ? ` (${Math.round(project.share)}% az összes feladat becsült tokenjeiből).` : ` (${Math.round(project.share)}% of all task-level estimated tokens).`}</p>}
    <p>{change !== null && view.comparisonMonth
      ? (hu ? `Tokenhasználat: ${roundedChange === 0 ? 'közel változatlan' : `${roundedChange}%-kal ${change > 0 ? 'több' : 'kevesebb'}`}. Viszonyítás: ${monthLabel(view.comparisonMonth, language)}${view.comparisonThroughDay ? `, mindkét hónap első ${view.comparisonThroughDay} napját nézve` : ''}.` : `Token usage: ${roundedChange === 0 ? 'approximately unchanged' : `${roundedChange}% ${change > 0 ? 'higher' : 'lower'}`} compared with ${monthLabel(view.comparisonMonth, language)}${view.comparisonThroughDay ? `, comparing the first ${view.comparisonThroughDay} days of each month` : ''}.`)
      : (hu ? 'A változás kiszámításához nincs elegendő korábbi használati adat.' : 'Not enough prior usage data to calculate a change.')}</p>
    <small>{hu ? 'Helyben készül, a mentett statisztikákból. A projektadatok becslések.' : 'Generated locally from saved statistics. Project figures are estimates.'} {view.month.estimated && (hu ? 'Ez a hónap becsült adatokat is tartalmaz.' : 'This month also contains estimated data.')} {change !== null && view.comparisonEstimated && (hu ? 'Az összehasonlítás is tartalmaz becslést.' : 'The comparison also includes estimates.')} {view.comparisonThroughDay && (hu ? `Részleges hónap, rögzítve: ${view.generatedDate}.` : `Partial month, captured: ${view.generatedDate}.`)}</small>
  </section>;
}

export function MonthScreen({ language, view, months, selectedMonth, onMonth, rateLimits }: {
  language: Language;
  view: MonthView;
  months: string[];
  selectedMonth: string;
  onMonth: (month: string) => void;
  rateLimits: CodexPulseSnapshot['rateLimits'];
}) {
  const [shareMode, setShareMode] = useState<'tasks' | 'tokens'>('tasks');
  const now = useClock();
  const change = view.previousMonthChange;
  return (
    <div className="screen-stack">
      <MonthHeading language={language} selectedMonth={selectedMonth} months={months} onMonth={onMonth} />
      {view.month.estimated && (
        <div className="quality-note"><EstimateBadge language={language} /><span>{language === 'hu' ? 'Becsült történeti adatok vagy API-költség. A feladatok tokeneloszlása külön becslés, nem a havi naplóösszeg felosztása.' : 'Includes historical estimates or estimated API costs. Task token allocation is a separate estimate, not a split of the monthly log total.'}</span></div>
      )}
      <section className="hero-card" aria-labelledby="usage-index-title">
        <div className="hero-copy">
          <p className="eyebrow" id="usage-index-title">{t(language, 'usageIndex')}</p>
          <strong className="hero-value">{percent(view.usageIndex)}</strong>
          <p className="hero-caption">{t(language, 'comparedBaseline')}</p>
          {change !== null && (
            <div className={`trend-chip ${change < 0 ? 'trend-down' : ''}`}>
              {change < 0 ? <TrendingDown /> : <TrendingUp />}
              {change > 0 ? '+' : ''}{Math.round(change)}% {t(language, 'comparedPrevious')}
            </div>
          )}
        </div>
        <div
          className="pulse-orbit"
          style={{ '--pulse-value': `${Math.min(100, view.usageIndex ?? 0)}%` } as CSSProperties}
          aria-label={percent(view.usageIndex)}
        >
          <div className="pulse-orbit-inner"><span>{percent(view.resultsIndex)}</span><small>{t(language, 'resultsIndex')}</small></div>
        </div>
      </section>
      <section className="metric-row" aria-label={t(language, 'monthlyOverview')}>
        <Metric label={t(language, 'totalTokens')} value={compact(view.month.usage.totalTokens, language)} detail={t(language, 'withCache')} accent />
        <Metric label={t(language, 'tasks')} value={integer(view.tasks.length, language)} detail={`${view.projects.length} ${t(language, 'projectsCount')}`} />
        <Metric label={t(language, 'activeDays')} value={integer(view.month.days.filter((day) => day.totalTokens > 0).length, language)} detail={`${view.totalTurns} ${t(language, 'turns').toLowerCase()}`} />
      </section>
      <MonthlySummary language={language} view={view} />
      <section className="panel category-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">{t(language, 'focus')}</p><h2>{t(language, 'focusQuestion')}</h2></div>
          <div className="segmented">
            <button data-active={shareMode === 'tasks'} onClick={() => setShareMode('tasks')}>{t(language, 'byTasks')}</button>
            <button data-active={shareMode === 'tokens'} onClick={() => setShareMode('tokens')}>{t(language, 'byTokens')}</button>
          </div>
        </div>
        <div className="category-list">
          {view.categories.map((item, index) => {
            const value = shareMode === 'tasks' ? item.taskShare : item.tokenShare;
            return (
              <div className="category-row" key={item.id}>
                <div className="category-label"><span><i className={`category-dot tone-${index}`} />{categoryLabel(language, item.id)}</span><strong>{value.toFixed(0)}%</strong></div>
                <div className="category-track"><span className={`tone-${index}`} style={{ width: `${value}%` }} /></div>
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel pulse-panel">
        <div className="panel-heading"><div><p className="eyebrow">{t(language, 'activityRhythm')}</p><h2>{t(language, 'dailyUsage')}</h2></div><span className="panel-meta">Europe/Budapest</span></div>
        <div className="sparkline" aria-label={t(language, 'dailyUsage')}>
          {view.month.days.map((day) => {
            const max = Math.max(...view.month.days.map((item) => item.totalTokens), 1);
            return <span key={day.date} style={{ height: `${Math.max(5, day.totalTokens / max * 100)}%` }} title={`${day.date}: ${integer(day.totalTokens, language)}`}><i /></span>;
          })}
        </div>
        <div className="sparkline-labels"><span>{view.month.days[0]?.date.slice(5) || selectedMonth}</span><span>{view.month.days.at(-1)?.date.slice(5) || selectedMonth}</span></div>
      </section>
      {rateLimits?.windows.length ? (
        <section className="panel limit-panel">
          <div className="panel-heading"><div><p className="eyebrow">Usage</p><h2>{t(language, 'usageWindows')}</h2></div><span className="panel-meta">{rateLimits.planType || 'Codex'}</span></div>
          <div className="limit-list">
            <p className="activity-hint">{language === 'hu' ? 'Nem élő kvóta. Rögzítve: ' : 'Not a live quota. Captured: '}{new Intl.DateTimeFormat(dateLocale(language), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(rateLimits.capturedAt))}</p>
            {rateLimits.windows.map((window) => (
              <div className="limit-row" key={window.id}>
                <div><span>{window.windowMinutes < 1_440 ? `${Math.round(window.windowMinutes / 60)}h` : `${Math.round(window.windowMinutes / 1_440)}d`}</span><strong>{Date.parse(window.resetsAt) <= now ? (language === 'hu' ? 'Lejárt adat' : 'Expired data') : `${window.usedPercent.toFixed(0)}%`}</strong></div>
                <div className="limit-track"><span style={{ width: `${Date.parse(window.resetsAt) <= now ? 0 : Math.min(100, Math.max(0, window.usedPercent))}%` }} /></div>
                <small>{t(language, 'resets')}: {new Intl.DateTimeFormat(dateLocale(language), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(window.resetsAt))}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ProjectsScreen({ language, view, months, selectedMonth, onMonth }: {
  language: Language;
  view: MonthView;
  months: string[];
  selectedMonth: string;
  onMonth: (month: string) => void;
}) {
  return (
    <div className="screen-stack">
      <MonthHeading language={language} selectedMonth={selectedMonth} months={months} onMonth={onMonth} />
      <section className="screen-title"><div className="title-icon"><FolderKanban /></div><div><p className="eyebrow">{t(language, 'projectOverview')}</p><h2>{t(language, 'projectShare')}</h2></div></section>
      <p className="activity-hint">{language === 'hu' ? 'A százalékok a feladatszintű becslésekből készülnek, nem a havi naplóösszegből.' : 'Percentages use task-level estimates, not the monthly log total.'}</p>
      <div className="project-card-list">
        {view.projects.map((project, index) => (
          <article className="project-card" key={project.id}>
            <div className="project-rank">{String(index + 1).padStart(2, '0')}</div>
            <div className="project-main">
              <div className="project-title"><strong>{project.name}</strong><span>{project.share.toFixed(0)}%</span></div>
              <div className="project-track"><span style={{ width: `${project.share}%` }} /></div>
              <div className="project-meta"><span>{project.tasks} {t(language, 'tasks').toLowerCase()}</span><span>{compact(project.tokens, language)} token</span></div>
            </div>
          </article>
        ))}
      </div>
      <p className="privacy-footnote"><CheckCircle2 />{t(language, 'hiddenProjects')}</p>
    </div>
  );
}


export function AnalysisScreen({ language, view, months, selectedMonth, onMonth }: {
  language: Language;
  view: MonthView;
  months: string[];
  selectedMonth: string;
  onMonth: (month: string) => void;
}) {
  const usage = view.month.usage;
  const tokenParts = [
    { label: 'Input', value: usage.inputTokens, color: 'cyan' },
    { label: 'Cache read', value: usage.cacheReadTokens, color: 'violet' },
    { label: 'Cache write', value: usage.cacheWriteTokens, color: 'blue' },
    { label: 'Output', value: usage.outputTokens, color: 'amber' },
    { label: 'Reasoning ⊂ Output', value: usage.reasoningTokens, color: 'mint' },
  ];
  return (
    <div className="screen-stack">
      <MonthHeading language={language} selectedMonth={selectedMonth} months={months} onMonth={onMonth} />
      <section className="analysis-index-grid">
        <article className="index-card"><Sparkles /><p>{t(language, 'usageIndex')}</p><strong>{percent(view.usageIndex)}</strong></article>
        <article className="index-card"><CheckCircle2 /><p>{t(language, 'resultsIndex')}</p><strong>{percent(view.resultsIndex)}</strong></article>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Token</p><h2>{t(language, 'categoryBreakdown')}</h2></div>{view.month.estimated && <EstimateBadge language={language} />}</div>
        <div className="token-part-list">
          {tokenParts.map((part) => {
            const partValue = part.value ?? 0;
            const share = usage.totalTokens ? partValue / usage.totalTokens * 100 : 0;
            return <div className="token-part" key={part.label}><span className={`part-icon tone-${part.color}`}><Layers3 /></span><div><span>{part.label}</span><strong>{part.value === null ? '—' : compact(partValue, language)}</strong></div><small>{part.value === null ? '—' : `${share.toFixed(1)}%`}</small></div>;
          })}
        </div>
        {usage.costUSD !== null && <div className="cost-note"><div><span>{t(language, 'apiCost')}</span><strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usage.costUSD)}</strong></div><p>{t(language, 'apiCostNote')}</p></div>}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">{t(language, 'outcomes')}</p><h2>{t(language, 'resultsIndex')}</h2></div></div>
        <p className="activity-hint">{language === 'hu' ? 'Sikeres = 1 pont, részben sikeres = 0,5, sikertelen vagy nyitott = 0. Az index az előző hónapok azonos időszakának átlagához viszonyít. Az automatikus besorolás becslés, az Aktivitás lapon javítható.' : 'Success = 1 point, partial = 0.5, failed or open = 0. The index compares with the same period in previous months. Automatic outcomes are estimates; correct them in Activity.'}</p>
        <div className="outcome-grid">{(['success','partial','failed','open'] as OutcomeId[]).map((outcome) => <div className={`outcome-card outcome-${outcome}`} key={outcome}><strong>{view.outcomes[outcome]}</strong><span>{outcomeLabel(language, outcome)}</span></div>)}</div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">AI</p><h2>{t(language, 'modelUsage')}</h2></div></div>
        <div className="model-list">{view.month.models.map((model, index) => <div className="model-row" key={model.model}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{model.model}</strong><i><b style={{ width: `${model.tokens / Math.max(...view.month.models.map((item) => item.tokens), 1) * 100}%` }} /></i></div><small>{compact(model.tokens, language)}</small></div>)}</div>
      </section>
    </div>
  );
}

export function ReportScreen({ language, view, vault, onVault, months, selectedMonth, onMonth }: {
  language: Language;
  view: MonthView;
  vault: LocalVault;
  onVault: (updater: (current: LocalVault) => LocalVault) => void;
  months: string[];
  selectedMonth: string;
  onMonth: (month: string) => void;
}) {
  const [reportLanguage, setReportLanguage] = useState<Language>(language);
  const [status, setStatus] = useState('');
  const create = async (format: 'png' | 'pdf') => {
    setStatus('');
    try {
      await exportReport({
        language: reportLanguage,
        monthLabel: monthLabel(view.month.id, reportLanguage),
        generatedLabel: `${t(reportLanguage, 'lastSync')}: ${new Intl.DateTimeFormat(dateLocale(reportLanguage), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(view.generatedAt))}`,
        view,
        includeProjects: vault.reportIncludesProjects,
      }, format);
      setStatus(t(language, 'reportReady'));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setStatus(t(language, 'shareFailed'));
    }
  };
  return (
    <div className="screen-stack report-screen">
      <section className="screen-title"><div className="title-icon"><FileText /></div><div><p className="eyebrow">CodexPulse</p><h1>{t(language, 'shareableReport')}</h1></div></section>
      <MonthHeading language={language} selectedMonth={selectedMonth} months={months} onMonth={(month) => { setStatus(''); onMonth(month); }} />
      <p className="report-privacy"><Info />{t(language, 'privateDetailsExcluded')}</p>
      <section className="report-preview">
        <div className="report-preview-head"><span>CODEXPULSE</span>{view.month.estimated && <EstimateBadge language={reportLanguage} />}</div>
        <h2>{monthLabel(view.month.id, reportLanguage)}</h2>
        <p>{reportLanguage === 'hu' ? 'Személyes Codex havi riport' : 'Personal Codex monthly report'}</p>
        <div className="report-preview-metrics">
          <div><span>{t(reportLanguage, 'usageIndex')}</span><strong>{percent(view.usageIndex)}</strong></div>
          <div><span>{t(reportLanguage, 'totalTokens')}</span><strong>{compact(view.month.usage.totalTokens, reportLanguage)}</strong></div>
          <div><span>{t(reportLanguage, 'resultsIndex')}</span><strong>{percent(view.resultsIndex)}</strong></div>
        </div>
        <div className="report-preview-bars">{view.categories.slice(0, 5).map((item, index) => <div key={item.id}><span>{categoryLabel(reportLanguage, item.id)}</span><i><b className={`tone-${index}`} style={{ width: `${item.taskShare}%` }} /></i><strong>{item.taskShare.toFixed(0)}%</strong></div>)}</div>
      </section>
      <section className="panel report-controls">
        <div className="report-language-control"><span>{t(language, 'reportLanguage')}</span><Select value={reportLanguage} onValueChange={(value) => setReportLanguage(value as Language)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hu">Magyar</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select></div>
        <div className="report-switch"><span><strong>{t(language, 'includeProjects')}</strong><small>{vault.reportIncludesProjects ? view.projects.slice(0, 3).map((item) => item.name).join(', ') : t(language, 'privateDetailsExcluded')}</small></span><Switch aria-label={t(language, 'includeProjects')} checked={vault.reportIncludesProjects} onCheckedChange={(checked) => onVault((current) => ({ ...current, reportIncludesProjects: checked }))} /></div>
        <div className="report-actions"><Button size="lg" onClick={() => void create('png')}><Share2 />{t(language, 'png')}</Button><Button size="lg" variant="outline" onClick={() => void create('pdf')}><Download />{t(language, 'pdf')}</Button></div>
        {status && <output className="report-status">{status}</output>}
      </section>
    </div>
  );
}
