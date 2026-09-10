import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { tokenDelta, applyEvents, usageDay, updateEventLedger, readUsageEvents } from '../scripts/codexpulse-ledger.mjs';

const importTS = async (name) => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(readFileSync(new URL(name, import.meta.url), 'utf8'))).toString('base64')}`);
const analytics = await importTS('../lib/codexpulse/analytics.ts');
const cryptoTools = await importTS('../lib/codexpulse/crypto.ts');
const { validateVault } = await importTS('../lib/codexpulse/vault.ts');
const { DEMO_SNAPSHOT } = await importTS('../lib/codexpulse/demo.ts');
const empty = () => ({ categoryOverrides: {}, outcomeOverrides: {}, projectRules: {}, reportIncludesProjects: false });

test('failed outcomes contribute zero; partial contributes half', () => {
  const snapshot = structuredClone(DEMO_SNAPSHOT);
  const vault = empty();
  for (const task of snapshot.tasks.filter(t => t.completedMonth === '2026-09')) vault.outcomeOverrides[task.id] = 'failed';
  assert.equal(analytics.buildMonthView(snapshot, '2026-09', vault).resultsIndex, 0);
  const task = snapshot.tasks.find(t => t.completedMonth === '2026-09');
  vault.outcomeOverrides[task.id] = 'success';
  const success = analytics.buildMonthView(snapshot, '2026-09', vault).resultsIndex;
  vault.outcomeOverrides[task.id] = 'partial';
  assert.equal(analytics.buildMonthView(snapshot, '2026-09', vault).resultsIndex, success / 2);
});

test('activity search combines accent-insensitive words, merged projects and corrected categories', () => {
  const vault = empty();
  const first = { ...DEMO_SNAPSHOT.tasks[0], id: 'a', title: 'Árvíztűrő tesztelés', projectId: 'old', projectName: 'Old', category: 'research' };
  const second = { ...first, id: 'b', title: 'Másik feladat', projectId: 'new', projectName: 'Új projekt' };
  vault.projectRules.old = { mergeInto: 'new' };
  vault.categoryOverrides.a = 'testing';
  const tasks = [first, second];
  const select = (query = '', project = '', category = '') => analytics.filterActivityTasks(tasks, vault, { query, project, category });
  assert.deepEqual(select('ARVIZTURO uj', 'new', 'testing').map(task => task.id), ['a']);
  assert.equal(select('', 'old').length, 0);
  assert.equal(select('', 'new').length, 2);
  assert.equal(select('nemletezo').length, 0);
  assert.equal(select('   ').length, 2);
  assert.equal(select('', '', 'research')[0].id, 'b');
});

test('monthly highlights keep ties, omit hidden projects and handle empty months', () => {
  const vault = empty();
  let view = analytics.buildMonthView(DEMO_SNAPSHOT, '2026-09', vault);
  const highlights = analytics.monthlyHighlights(view);
  const max = Math.max(...view.categories.map(category => category.tasks));
  assert.deepEqual(highlights.leadingCategories, view.categories.filter(category => category.tasks === max));
  assert.equal(highlights.activeDays, view.month.days.filter(day => day.totalTokens > 0).length);
  assert.equal(view.comparisonMonth, '2026-08');
  assert.equal(view.comparisonThroughDay, 8);
  assert.equal(view.comparisonEstimated, true);
  const hidden = view.projects[0].id;
  vault.projectRules[hidden] = { hidden: true };
  view = analytics.buildMonthView(DEMO_SNAPSHOT, '2026-09', vault);
  assert.notEqual(analytics.monthlyHighlights(view).leadingProject?.id, hidden);
  const emptyView = { ...view, tasks: [], categories: [], projects: [], month: { ...view.month, days: [] } };
  assert.deepEqual(analytics.monthlyHighlights(emptyView), { activeDays: 0, leadingCategories: [], leadingProject: null });
  const july = analytics.buildMonthView(DEMO_SNAPSHOT, '2026-07', vault);
  assert.equal(july.comparisonMonth, null);
  assert.equal(july.previousMonthChange, null);
  assert.equal(july.comparisonThroughDay, null);
});

test('closing an open task appears in selected month, including old vault migration', () => {
  const snapshot = structuredClone(DEMO_SNAPSHOT), vault = empty();
  const task = snapshot.tasks.find(t => t.outcome === 'open' && t.months['2026-09']);
  const before = analytics.buildMonthView(snapshot, '2026-09', vault);
  vault.outcomeOverrides[task.id] = 'success';
  vault.outcomeDates = { [task.id]: '2026-09-09' };
  const after = analytics.buildMonthView(snapshot, '2026-09', vault);
  assert.equal(after.outcomes.success, before.outcomes.success + 1);
  assert.equal(after.outcomes.open, before.outcomes.open - 1);
  delete vault.outcomeDates;
  assert.equal(analytics.outcomeDate(task, vault), task.updatedAt.slice(0, 10));
});

test('project chains resolve transitively and cycles are prevented or deterministic', () => {
  const vault = empty(); vault.projectRules = { a: { mergeInto: 'b' }, b: { mergeInto: 'c' } };
  assert.equal(analytics.projectTarget('a', vault), 'c');
  assert.equal(analytics.canMergeProject('c', 'a', vault), false);
  assert.equal(analytics.canMergeProject('a', 'c', vault), true);
  vault.projectRules.c = { mergeInto: 'a' };
  assert.equal(analytics.projectTarget('a', vault), analytics.projectTarget('c', vault));
});

test('task, project and category totals share the same unscaled measurement basis', () => {
  const view = analytics.buildMonthView(DEMO_SNAPSHOT, '2026-09', empty());
  const taskTotal = view.tasks.reduce((sum, task) => sum + task.months['2026-09'].tokens, 0);
  assert.equal(view.taskTokenTotal, taskTotal);
  assert.equal(view.categories.reduce((sum, category) => sum + category.tokens, 0), taskTotal);
  assert.equal(view.projects.reduce((sum, project) => sum + project.tokens, 0), taskTotal);
  assert.equal(view.generatedAt, DEMO_SNAPSHOT.generatedAt);
});

test('token deltas exclude cached input from input, and do not add reasoning twice', () => {
  const usage = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 10, total_tokens: 120 };
  const result = tokenDelta(null, usage);
  assert.equal(result.totalTokens, 120);
  assert.equal(result.inputTokens, 20);
  assert.equal(result.inputTokens + result.cacheReadTokens + result.outputTokens, result.totalTokens);
  assert.equal(tokenDelta(usage, usage).totalTokens, 0);
  assert.equal(tokenDelta(usage, { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, { input_tokens: 10, output_tokens: 5 }).totalTokens, 15);
  assert.equal(tokenDelta(null, usage, { input_tokens: 10, output_tokens: 5 }).totalTokens, 15, 'first inherited total is not all new usage');
});

test('event dates use Budapest including UTC day/month boundaries', () => {
  assert.equal(usageDay('2026-08-31T22:30:00Z'), '2026-09-01');
  assert.equal(usageDay('2026-12-31T23:30:00Z'), '2027-01-01');
});

test('frozen cache cannot count new cache increments twice', () => {
  const config = {};
  const cache = { generatedAt: '2026-09-01T00:00:00Z', totals: { totalTokens: 100 }, daily: [] };
  updateEventLedger(config, [], cache);
  const ledger = config.eventUsage;
  applyEvents(ledger, {}, [
    { timestamp: cache.generatedAt, total: { input_tokens: 100, total_tokens: 100 } },
    { timestamp: '2026-09-01T01:00:00Z', total: { input_tokens: 120, total_tokens: 120 } },
  ], 'task');
  updateEventLedger(config, [], { ...cache, totals: { totalTokens: 120 } });
  assert.equal(ledger.baseCache.totals.totalTokens + ledger.days['2026-09-01'].totalTokens, 120);
});

test('replayed events and inherited fork events are counted once', () => {
  const ledger = { cutoff: '2026-09-01T00:00:00Z', days: {}, taskMonths: {} };
  const events = [{ timestamp: '2026-09-02T00:00:00Z', total: { input_tokens: 100, total_tokens: 100 } }];
  const file = {};
  applyEvents(ledger, file, events, 'a');
  applyEvents(ledger, file, events, 'a');
  applyEvents(ledger, {}, events, 'fork');
  assert.equal(ledger.days['2026-09-02'].totalTokens, 100);
});

test('historical task allocation remains frozen when task estimates change', () => {
  const config = {};
  const cache = { generatedAt: '2026-09-01T00:00:00Z', daily: [], totals: {} };
  const task = { id: 'a', _rolloutPaths: [], months: { '2026-08': { tokens: 100, turns: 1, activityMs: 0, estimated: true } } };
  updateEventLedger(config, [task], cache);
  task.months['2026-08'].tokens = 900;
  config.eventUsage.taskMonths.a = { '2026-09': 20 };
  updateEventLedger(config, [task], cache);
  assert.equal(task.months['2026-08'].tokens, 100);
  assert.equal(task.months['2026-09'].tokens, 20);
  updateEventLedger(config, [task], cache);
  assert.equal(task.months['2026-09'].tokens, 20);
});

test('service worker removes only previous app caches and precaches compiled assets', async () => {
  const handlers = {}, deleted = []; let assets;
  const context = vm.createContext({ URL, fetch: async () => ({ ok: true, json: async () => ['assets/app.js', 'assets/app.css'] }),
    self: { registration: { scope: 'https://example.test/codexpulse/' }, clients: { claim: async () => {} }, addEventListener: (name, fn) => handlers[name] = fn },
    caches: { keys: async () => ['codexpulse-shell-v1.1', 'codexpulse-shell-v1.2', 'codexpulse-shell-v1.2.1', 'codexpulse-shell-v1.2.2', 'nextrep-offline'], delete: async key => deleted.push(key), open: async () => ({ addAll: async value => assets = value }) } });
  vm.runInContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  let pending;
  handlers.install({ waitUntil: p => pending = p }); await pending;
  assert.ok(assets.includes('https://example.test/codexpulse/assets/app.js'));
  handlers.activate({ waitUntil: p => pending = p }); await pending;
  assert.deepEqual(deleted, ['codexpulse-shell-v1.1', 'codexpulse-shell-v1.2', 'codexpulse-shell-v1.2.1']);
});

test('unchanged source still retries a previously failed publication', async () => {
  const source = readFileSync(new URL('../scripts/codexpulse-run.mjs', import.meta.url), 'utf8');
  const main = source.slice(source.indexOf('async function main()'), source.indexOf('main().catch'));
  let sync = 0, publish = 0;
  const context = vm.createContext({ process: {}, log: async () => {}, run: script => script.includes('sync') ? { status: 0, stdout: JSON.stringify({ status: sync++ ? 'unchanged' : 'updated' }) } : (++publish, { status: 1, stderr: 'offline' }) });
  vm.runInContext(main, context);
  await vm.runInContext('main()', context); await vm.runInContext('main()', context);
  assert.equal(publish, 2);
});

test('PIN, recovery and encrypted corrections round-trip; wrong key and tamper rejected', async () => {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const bundle = await cryptoTools.protectMasterKey('123456', raw, 'https://example.test/data');
  const unlocked = await cryptoTools.unlockMasterKey('123456', bundle);
  await assert.rejects(cryptoTools.unlockMasterKey('654321', bundle));
  const recovered = await cryptoTools.rawKeyFromRecoveryCode(await cryptoTools.recoveryCodeFor(raw));
  assert.deepEqual(recovered, raw);
  const vault = empty(); vault.outcomeOverrides.test = 'success';
  const encrypted = await cryptoTools.encryptLocalValue(vault, unlocked.key);
  assert.deepEqual(validateVault(await cryptoTools.decryptLocalValue(encrypted, unlocked.key)), { ...vault, outcomeDates: {} });
  const other = await cryptoTools.importMasterKey(crypto.getRandomValues(new Uint8Array(32)));
  await assert.rejects(cryptoTools.decryptLocalValue(encrypted, other));
  const altered = JSON.parse(encrypted); const bytes = cryptoTools.base64UrlToBytes(altered.data); bytes[0] ^= 1; altered.data = cryptoTools.bytesToBase64Url(bytes);
  await assert.rejects(cryptoTools.decryptLocalValue(JSON.stringify(altered), unlocked.key));
  raw.fill(0); recovered.fill(0); unlocked.raw.fill(0);
});

test('invalid imported vaults are rejected without coercing values', () => {
  assert.throws(() => validateVault({ ...empty(), outcomeOverrides: { a: 'bogus' } }));
  assert.throws(() => validateVault({ ...empty(), projectRules: { a: { hidden: 'false' } } }));
  assert.throws(() => validateVault(null));
});

test('reader ignores unrelated source lines and returns complete-line offset', () => {
  const path = new URL('../scripts/codexpulse-ledger.mjs', import.meta.url);
  const first = readUsageEvents(path, null, '2026-09-01T00:00:00Z');
  assert.equal(first.events.length, 0);
  assert.deepEqual(readUsageEvents(path, { offset: first.offset }, '2026-09-01T00:00:00Z').events, []);
});

test('initial reverse scan and subsequent append scan agree across month boundary', () => {
  const path = new URL('./fixtures/usage.jsonl', import.meta.url);
  const cutoff = '2026-08-31T22:00:00Z';
  const initial = readUsageEvents(path, null, cutoff);
  const ledger = { cutoff, days: {}, taskMonths: {} };
  applyEvents(ledger, {}, initial.events, 'a');
  assert.equal(ledger.days['2026-09-01'].totalTokens, 30);
  assert.equal(ledger.days['2026-09-01'].models['example-model-2'], 30);
  const fixture = readFileSync(path);
  const lines = fixture.toString().split('\n');
  const offset = Buffer.byteLength(lines.slice(0, 2).join('\n') + '\n');
  const appended = readUsageEvents(path, { offset }, cutoff);
  const fresh = { cutoff, days: {}, taskMonths: {} };
  applyEvents(fresh, { total: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, total_tokens: 120 } }, appended.events, 'a');
  assert.deepEqual(fresh.days, ledger.days);
  assert.equal(appended.offset, fixture.length);
});
