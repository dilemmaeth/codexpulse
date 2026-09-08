import type { CategoryId, Language, OutcomeId } from './types';

const hu = {
  month: 'Hónap', projects: 'Projektek', activity: 'Aktivitás', analysis: 'Elemzés', report: 'Riport',
  settings: 'Beállítások', synced: 'Szinkronizálva', offline: 'Offline adat', updateAvailable: 'Új verzió érhető el', updateNow: 'Frissítés',
  monthlyOverview: 'Havi áttekintés', usageIndex: 'Személyes használati index', resultsIndex: 'Eredményindex',
  comparedBaseline: 'Az előző lezárt hónapok átlagához képest', comparedPrevious: 'az előző hónaphoz képest',
  totalTokens: 'Összes token', tasks: 'Feladat', activeDays: 'Aktív nap', turns: 'Forduló', projectsCount: 'projektben',
  withCache: 'cache-sel együtt', focus: 'Fókusz', focusQuestion: 'Mivel foglalkoztál?', byTasks: 'feladatok szerint', byTokens: 'tokenek szerint',
  activityRhythm: 'Aktivitási ritmus', dailyUsage: 'Napi használat', today: 'Ma', stable: 'stabil', estimated: 'Becsült', exact: 'Pontos',
  projectOverview: 'Projektáttekintés', projectShare: 'Tokenmegoszlás projektenként', hiddenProjects: 'Rejtett projektek nem látszanak.',
  taskActivity: 'Feladataktivitás', recentTasks: 'Legutóbbi feladatok', activityNotHours: 'Rögzített aktivitási időszak, nem ledolgozott munkaóra.',
  categoryBreakdown: 'Kategóriamegoszlás', outcomes: 'Eredmények', modelUsage: 'Modellek használata', completed: 'lezárt',
  shareableReport: 'Megosztható havi riport', privateDetailsExcluded: 'A nyers promptok, elérési utak és részletes naplók nem kerülnek bele.',
  includeProjects: 'Projektnevek megjelenítése', png: 'PNG készítése', pdf: 'PDF készítése', reportLanguage: 'Riport nyelve',
  language: 'Alkalmazás nyelve', hungarian: 'Magyar', english: 'English', security: 'Biztonság', lockNow: 'Zárolás most',
  dataAndSync: 'Adatok és szinkron', syncNow: 'Adatok frissítése', lastSync: 'Utolsó szinkron', dataQuality: 'Adatminőség',
  projectRules: 'Projektszabályok', rename: 'Átnevezés', hide: 'Elrejtés', merge: 'Összevonás', reset: 'Helyi beállítások törlése',
  close: 'Bezárás', save: 'Mentés', cancel: 'Mégse', category: 'Kategória', outcome: 'Eredmény',
  lockedTitle: 'A CodexPulse zárolva van', lockedBody: 'Add meg a 6 számjegyű PIN-kódot.', unlock: 'Feloldás', wrongPin: 'Hibás PIN-kód.',
  waitBeforeRetry: 'Túl sok próbálkozás. Próbáld újra később.', pairingTitle: 'Kapcsold össze az iPhone-t', pairingBody: 'Olvasd be a számítógépen megjelenő CodexPulse QR-kódot.',
  setupPin: 'PIN-kód beállítása', repeatPin: 'PIN-kód megismétlése', continue: 'Tovább', pinMismatch: 'A két PIN-kód nem egyezik.',
  recoveryTitle: 'Mentsd el a helyreállítási kódot', recoveryBody: 'Ezzel újra párosíthatod a telefont. Ne oszd meg senkivel.', copy: 'Másolás', copied: 'Másolva', finish: 'Kész',
  useRecovery: 'Helyreállítási kód használata', enterRecovery: 'Helyreállítási kód', restore: 'Párosítás visszaállítása', invalidRecovery: 'A helyreállítási kód hibás vagy hiányos.',
  demoMode: 'Demó megtekintése', demoBanner: 'Bemutató adatok', noData: 'Ehhez a hónaphoz még nincs adat.',
  loadFailed: 'Az adatok nem tölthetők be.', retry: 'Újrapróbálás', encrypted: 'Titkosított', automatic: 'Automatikus',
  apiCost: 'Becsült API-költség', apiCostNote: 'Nem ChatGPT-számla vagy kredit.', usageWindows: 'Aktuális használati ablakok', resets: 'Újraindul',
  fiveMinuteLock: '5 perc háttérben töltött idő után automatikusan zárol.', sourceFreshness: 'Adatfrissesség',
  reportReady: 'A riport elkészült.', shareFailed: 'A megosztás nem sikerült.', all: 'Mind',
};

const en: typeof hu = {
  month: 'Month', projects: 'Projects', activity: 'Activity', analysis: 'Analysis', report: 'Report',
  settings: 'Settings', synced: 'Synced', offline: 'Offline data', updateAvailable: 'A new version is available', updateNow: 'Update',
  monthlyOverview: 'Monthly overview', usageIndex: 'Personal usage index', resultsIndex: 'Results index',
  comparedBaseline: 'Compared with the average of previous closed months', comparedPrevious: 'compared with the previous month',
  totalTokens: 'Total tokens', tasks: 'Tasks', activeDays: 'Active days', turns: 'Turns', projectsCount: 'projects',
  withCache: 'including cache', focus: 'Focus', focusQuestion: 'What did you work on?', byTasks: 'by tasks', byTokens: 'by tokens',
  activityRhythm: 'Activity rhythm', dailyUsage: 'Daily usage', today: 'Today', stable: 'stable', estimated: 'Estimated', exact: 'Exact',
  projectOverview: 'Project overview', projectShare: 'Token share by project', hiddenProjects: 'Hidden projects are excluded.',
  taskActivity: 'Task activity', recentTasks: 'Recent tasks', activityNotHours: 'Recorded activity period, not human work hours.',
  categoryBreakdown: 'Category breakdown', outcomes: 'Results', modelUsage: 'Model usage', completed: 'closed',
  shareableReport: 'Shareable monthly report', privateDetailsExcluded: 'Raw prompts, paths and detailed logs are never included.',
  includeProjects: 'Show project names', png: 'Create PNG', pdf: 'Create PDF', reportLanguage: 'Report language',
  language: 'App language', hungarian: 'Magyar', english: 'English', security: 'Security', lockNow: 'Lock now',
  dataAndSync: 'Data and sync', syncNow: 'Refresh data', lastSync: 'Last sync', dataQuality: 'Data quality',
  projectRules: 'Project rules', rename: 'Rename', hide: 'Hide', merge: 'Merge', reset: 'Delete local settings',
  close: 'Close', save: 'Save', cancel: 'Cancel', category: 'Category', outcome: 'Result',
  lockedTitle: 'CodexPulse is locked', lockedBody: 'Enter your 6-digit PIN.', unlock: 'Unlock', wrongPin: 'Incorrect PIN.',
  waitBeforeRetry: 'Too many attempts. Try again later.', pairingTitle: 'Connect your iPhone', pairingBody: 'Scan the CodexPulse QR code shown on your computer.',
  setupPin: 'Set a PIN', repeatPin: 'Repeat the PIN', continue: 'Continue', pinMismatch: 'The PIN codes do not match.',
  recoveryTitle: 'Save your recovery code', recoveryBody: 'Use it to pair your phone again. Never share it.', copy: 'Copy', copied: 'Copied', finish: 'Done',
  useRecovery: 'Use a recovery code', enterRecovery: 'Recovery code', restore: 'Restore pairing', invalidRecovery: 'The recovery code is invalid or incomplete.',
  demoMode: 'View demo', demoBanner: 'Demo data', noData: 'There is no data for this month yet.',
  loadFailed: 'The data could not be loaded.', retry: 'Retry', encrypted: 'Encrypted', automatic: 'Automatic',
  apiCost: 'Estimated API cost', apiCostNote: 'Not a ChatGPT bill or credit balance.', usageWindows: 'Current usage windows', resets: 'Resets',
  fiveMinuteLock: 'Locks automatically after 5 minutes in the background.', sourceFreshness: 'Data freshness',
  reportReady: 'Your report is ready.', shareFailed: 'Sharing failed.', all: 'All',
};

export type MessageKey = keyof typeof hu;
const messages = { hu, en };

export function t(language: Language, key: MessageKey) {
  return messages[language][key];
}

export function categoryLabel(language: Language, category: CategoryId) {
  const values: Record<Language, Record<CategoryId, string>> = {
    hu: { development: 'Fejlesztés', research: 'Kutatás', planning: 'Tervezés', testing: 'Tesztelés', documentation: 'Dokumentáció', uncategorized: 'Besorolatlan' },
    en: { development: 'Development', research: 'Research', planning: 'Planning', testing: 'Testing', documentation: 'Documentation', uncategorized: 'Uncategorized' },
  };
  return values[language][category];
}

export function outcomeLabel(language: Language, outcome: OutcomeId) {
  const values: Record<Language, Record<OutcomeId, string>> = {
    hu: { success: 'Sikeres', partial: 'Részleges', failed: 'Sikertelen', open: 'Folyamatban' },
    en: { success: 'Successful', partial: 'Partial', failed: 'Failed', open: 'In progress' },
  };
  return values[language][outcome];
}
