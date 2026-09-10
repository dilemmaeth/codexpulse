'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, CalendarDays, FileText, FolderKanban, RefreshCw, Sparkles } from 'lucide-react';

import { ErrorGate, LockedGate, PinSetupGate, RecoveryGate, UnpairedGate } from '@/components/codexpulse/security-gates';
import { AnalysisScreen, MonthScreen, ProjectsScreen, ReportScreen } from '@/components/codexpulse/screens';
import { ActivityScreen } from '@/components/codexpulse/activity-screen';
import { SettingsDialog } from '@/components/codexpulse/settings-dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCodexPulse, useServiceWorkerUpdate } from '@/hooks/use-codexpulse';
import { buildMonthView } from '@/lib/codexpulse/analytics';
import { t } from '@/lib/codexpulse/i18n';
import { useClock } from '@/lib/codexpulse/use-clock';

const navigation = [
  { value: 'month', key: 'month', icon: CalendarDays },
  { value: 'projects', key: 'projects', icon: FolderKanban },
  { value: 'activity', key: 'activity', icon: Activity },
  { value: 'analysis', key: 'analysis', icon: BarChart3 },
  { value: 'report', key: 'report', icon: FileText },
] as const;

type ModelContext = {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: unknown) => unknown;
  }, options?: { signal?: AbortSignal }) => void | Promise<void>;
};

export default function Home() {
  const app = useCodexPulse();
  const now = useClock();
  const { updateAvailable, updateNow } = useServiceWorkerUpdate();
  const [activeTab, setActiveTab] = useState('month');
  const months = useMemo(
    () => app.snapshot ? [...app.snapshot.months].map((item) => item.id).sort().reverse() : [],
    [app.snapshot],
  );
  const [selectedMonth, setSelectedMonth] = useState('');

  const activeMonth = selectedMonth && months.includes(selectedMonth) ? selectedMonth : (months[0] || '');

  const view = useMemo(
    () => app.snapshot && activeMonth ? buildMonthView(app.snapshot, activeMonth, app.vault) : null,
    [activeMonth, app.snapshot, app.vault],
  );

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool || !view) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: 'get_codexpulse_month_summary',
        title: app.language === 'hu' ? 'CodexPulse havi összegzés' : 'CodexPulse monthly summary',
        description: app.language === 'hu'
          ? 'Visszaadja a kiválasztott hónap összesített, privát részletektől megtisztított mutatóit.'
          : 'Returns sanitized aggregate metrics for the selected month.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: () => ({
          month: view.month.id,
          totalTokens: view.month.usage.totalTokens,
          tasks: view.tasks.length,
          activeDays: view.month.days.filter((day) => day.totalTokens > 0).length,
          usageIndex: view.usageIndex,
          resultsIndex: view.resultsIndex,
          estimated: view.month.estimated,
        }),
      }, { signal: lifecycle.signal });
      await context.registerTool({
        name: 'open_codexpulse_view',
        title: app.language === 'hu' ? 'CodexPulse nézet megnyitása' : 'Open CodexPulse view',
        description: app.language === 'hu' ? 'Megnyitja az öt fő nézet egyikét.' : 'Opens one of the five main views.',
        inputSchema: {
          type: 'object',
          properties: { view: { type: 'string', enum: navigation.map((item) => item.value) } },
          required: ['view'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => {
          const candidate = (input as { view?: string })?.view;
          if (!navigation.some((item) => item.value === candidate)) throw new Error('INVALID_VIEW');
          setActiveTab(candidate!);
          return { view: candidate, status: 'opened' };
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [app.language, view]);

  if (app.phase === 'booting') return <main className="boot-screen"><span className="pulse-loader" /><strong>CodexPulse</strong></main>;
  if (app.phase === 'unpaired') return <UnpairedGate language={app.language} onDemo={app.enterDemo} onRecover={app.recover} />;
  if (app.phase === 'pairing') return <PinSetupGate language={app.language} onSetup={app.setupPin} />;
  if (app.phase === 'recovery' && app.recoveryCode) return <RecoveryGate language={app.language} code={app.recoveryCode} onFinish={app.finishRecovery} />;
  if (app.phase === 'locked') return <LockedGate language={app.language} onUnlock={app.unlock} onRecover={app.recover} />;
  if (app.phase === 'error' || !app.snapshot || !view) return <ErrorGate language={app.language} onRetry={() => window.location.reload()} />;

  return (
    <main className="app-shell">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(String(value))} className="app-tabs">
        <div className="mobile-frame">
          <header className="topbar">
            <div className="brand-lockup" aria-label="CodexPulse"><span className="pulse-mark"><span /></span><span>CodexPulse</span></div>
            <div className="topbar-actions">
              <span className={`sync-pill ${app.offlineData || now - Date.parse(app.snapshot.generatedAt) > 8 * 3600_000 ? 'sync-offline' : ''}`}><span className="sync-dot" />{app.offlineData ? t(app.language, 'offline') : now - Date.parse(app.snapshot.generatedAt) > 8 * 3600_000 ? (app.language === 'hu' ? 'Régi adat' : 'Older data') : t(app.language, 'synced')}</span>
              <SettingsDialog
                language={app.language}
                snapshot={app.snapshot}
                vault={app.vault}
                demo={app.demo}
                refreshing={app.isRefreshing}
                offlineData={app.offlineData}
                onLanguage={app.setLanguage}
                onVault={app.updateVault}
                onRefresh={() => void app.refresh()}
                onLock={app.lock}
                onReset={app.resetDevice}
                onBackup={app.backupVault}
                onRestore={app.restoreVault}
              />
            </div>
          </header>
          {updateAvailable && <aside className="update-banner"><span><RefreshCw />{t(app.language, 'updateAvailable')}</span><Button size="sm" onClick={updateNow}>{t(app.language, 'updateNow')}</Button></aside>}
          {app.demo && <aside className="demo-banner"><Sparkles />{t(app.language, 'demoBanner')}</aside>}
          {app.error && <aside className="quality-note" role="alert">{app.language === 'hu' ? 'Az adatbetöltés vagy mentés nem sikerült. A legutóbbi módosítás még nincs biztonságban: próbáld újra, vagy készíts titkosított mentést.' : 'Loading or saving failed. The latest changes may not be saved: retry or export an encrypted backup.'}</aside>}
          <TabsContent value="month" className="screen-content"><MonthScreen language={app.language} view={view} months={months} selectedMonth={activeMonth} onMonth={setSelectedMonth} rateLimits={app.snapshot.rateLimits} /></TabsContent>
          <TabsContent value="projects" className="screen-content"><ProjectsScreen language={app.language} view={view} months={months} selectedMonth={activeMonth} onMonth={setSelectedMonth} /></TabsContent>
          <TabsContent value="activity" className="screen-content"><ActivityScreen key={activeMonth} language={app.language} view={view} months={months} selectedMonth={activeMonth} onMonth={setSelectedMonth} vault={app.vault} onVault={app.updateVault} /></TabsContent>
          <TabsContent value="analysis" className="screen-content"><AnalysisScreen language={app.language} view={view} months={months} selectedMonth={activeMonth} onMonth={setSelectedMonth} /></TabsContent>
          <TabsContent value="report" className="screen-content"><ReportScreen language={app.language} view={view} vault={app.vault} onVault={app.updateVault} months={months} selectedMonth={activeMonth} onMonth={setSelectedMonth} /></TabsContent>
          <TabsList className="bottom-navigation" aria-label={app.language === 'hu' ? 'Fő navigáció' : 'Main navigation'}>
            {navigation.map((item) => <TabsTrigger value={item.value} key={item.value} className="nav-item"><item.icon /><span>{t(app.language, item.key)}</span></TabsTrigger>)}
          </TabsList>
        </div>
      </Tabs>
    </main>
  );
}
