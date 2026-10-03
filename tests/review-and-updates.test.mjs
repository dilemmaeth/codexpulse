import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const importTS = async path => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'))).toString('base64')}`);
const analytics = await importTS('../lib/codexpulse/analytics.ts');
const { DEMO_SNAPSHOT } = await importTS('../lib/codexpulse/demo.ts');
const { reportPeriod } = await importTS('../lib/codexpulse/report-period.ts');
const { closeMonthReview, canCloseMonth, EMPTY_REVIEW } = await importTS('../lib/codexpulse/month-review.ts');
const { validateVault } = await importTS('../lib/codexpulse/vault.ts');
const empty = () => ({ categoryOverrides: {}, outcomeOverrides: {}, projectRules: {}, reportIncludesProjects: false });

test('outcome cards include closures without a usage slice and use the index cutoff', () => {
  const snapshot = structuredClone(DEMO_SNAPSHOT), vault = empty();
  const task = snapshot.tasks.find(task => task.months['2026-09'] && task.outcome === 'success');
  delete task.months['2026-09'];
  let view = analytics.buildMonthView(snapshot, '2026-09', vault);
  assert.equal(view.outcomes.success, 5);
  assert.equal(view.resultPoints, view.outcomes.success + view.outcomes.partial * .5);
  task.completedAt = '2026-09-09';
  view = analytics.buildMonthView(snapshot, '2026-09', vault);
  assert.equal(view.outcomes.success, 4);
  assert.equal(view.resultPoints, 4.5);
  snapshot.generatedAt = '2026-09-09T18:15:00Z';
  view = analytics.buildMonthView(snapshot, '2026-09', vault);
  assert.equal(view.outcomes.success, 5);
  assert.equal(view.resultPoints, 5.5);
});

test('report wording includes partial cutoff and matching comparison in both languages', () => {
  const view = analytics.buildMonthView(DEMO_SNAPSHOT, '2026-09', empty());
  const hu = reportPeriod(view, 'hu'), en = reportPeriod(view, 'en');
  assert.match(hu.status, /Részleges.*2026-09-08/u);
  assert.match(hu.comparison, /első 8 napja.*becslést/u);
  assert.match(en.status, /Partial.*2026-09-08/u);
  assert.match(en.comparison, /first 8 days.*includes estimates/u);
  const july = reportPeriod(analytics.buildMonthView(DEMO_SNAPSHOT, '2026-07', empty()), 'en');
  assert.match(july.status, /Full monthly/u);
  assert.match(july.comparison, /Not enough/u);
});

test('monthly review freezes aggregate metrics, preserves notes in backup and rejects incomplete months', () => {
  const snapshot = structuredClone(DEMO_SNAPSHOT), vault = empty();
  const august = analytics.buildMonthView(snapshot, '2026-08', vault);
  const review = closeMonthReview({ ...EMPTY_REVIEW, achievements: 'Completed work', nextFocus: 'Next month' }, august, '2026-10-04T00:00:00Z');
  vault.monthReviews = { '2026-08': review };
  assert.equal(validateVault(vault).monthReviews['2026-08'].achievements, 'Completed work');
  snapshot.months.find(month => month.id === '2026-08').usage.totalTokens += 100;
  assert.notEqual(review.summary.totalTokens, analytics.buildMonthView(snapshot, '2026-08', vault).month.usage.totalTokens);
  assert.equal(canCloseMonth(analytics.buildMonthView(snapshot, '2026-09', vault), '2026-10-04T00:00:00Z'), false);
  assert.throws(() => closeMonthReview(review, august, '2026-10-04T00:00:00Z'));
  const corrupt = structuredClone(vault); corrupt.monthReviews['2026-08'].summary.totalTokens = 'not numeric';
  assert.throws(() => validateVault(corrupt));
  assert.equal(validateVault(empty()).monthReviews, undefined);
});

test('service worker keeps the installed HTML offline and cannot consume another app cache', async () => {
  const handlers = {}; let networkCalls = 0;
  const currentShell = { body: 'installed-html' };
  const context = vm.createContext({ URL,
    self: { location: { origin: 'https://example.test' }, registration: { scope: 'https://example.test/codexpulse/' }, addEventListener: (name, fn) => { handlers[name] = fn; } },
    fetch: async () => { networkCalls++; throw new Error('offline'); },
    caches: { open: async () => ({ match: async key => key === 'https://example.test/codexpulse/' ? currentShell : undefined }) },
  });
  vm.runInContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  let response;
  handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://example.test/codexpulse/' }, respondWith: value => { response = value; } });
  assert.equal(await response, currentShell);
  assert.equal(networkCalls, 0);
  response = null;
  handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://example.test/nextrep/' }, respondWith: value => { response = value; } });
  assert.equal(response, null);
});

test('worker detection never activates an update and failed saves block explicit activation', async () => {
  const raw = stripTypeScriptTypes(readFileSync(new URL('../hooks/use-codexpulse.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
  const source = raw.slice(raw.indexOf('function useServiceWorkerUpdate('));
  const states = [], refs = [], handlers = {}, workerHandlers = {}, messages = [];
  let stateIndex = 0, refIndex = 0, shouldFail = true, reloads = 0, prepared = 0;
  const registration = { waiting: { postMessage: value => messages.push(value.type) }, installing: { state: 'installed', addEventListener: (name, fn) => { workerHandlers[name] = fn; } }, addEventListener: (name, fn) => { handlers[name] = fn; } };
  const context = vm.createContext({ URL, document: { baseURI: 'https://example.test/codexpulse/' }, process: { env: { NODE_ENV: 'production' } },
    useState: value => { const i = stateIndex++; if (i >= states.length) states[i] = value; return [states[i], v => { states[i] = v; }]; },
    useRef: value => { const i = refIndex++; refs[i] ||= { current: value }; return refs[i]; }, useCallback: fn => fn,
    useEffect: fn => { if (!handlers.mounted) { fn(); handlers.mounted = true; } },
    prepare: async () => { prepared++; if (shouldFail) throw new Error('SAVE_FAILED'); },
    navigator: { serviceWorker: { controller: {}, register: async () => registration, addEventListener: (name, fn) => { handlers[name] = fn; }, removeEventListener: () => {} } },
    window: { location: { reload: () => { reloads++; } } },
  });
  vm.runInContext(source, context);
  const render = () => { stateIndex = 0; refIndex = 0; return vm.runInContext('useServiceWorkerUpdate(prepare)', context); };
  render(); await new Promise(resolve => setImmediate(resolve));
  handlers.updatefound(); workerHandlers.statechange();
  assert.deepEqual(messages, []);
  handlers.controllerchange(); assert.equal(reloads, 0);
  await render().updateNow(); assert.deepEqual(messages, []); assert.equal(render().updateError, true);
  shouldFail = false;
  await render().updateNow(); assert.deepEqual(messages, ['SKIP_WAITING']); assert.equal(prepared, 2);
  handlers.controllerchange(); assert.equal(reloads, 1);
});
