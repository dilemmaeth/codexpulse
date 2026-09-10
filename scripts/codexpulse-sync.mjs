import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { updateEventLedger, usageDay } from './codexpulse-ledger.mjs';
import { withLock } from './codexpulse-lock.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRIVATE_ROOT = join(PROJECT_ROOT, '.codexpulse', 'private');
const CONFIG_FILE = join(PRIVATE_ROOT, 'config.json');
const DEFAULT_OUTPUT = join(PRIVATE_ROOT, 'codexpulse-data.enc.json');
const USAGE_CACHE = join(PROJECT_ROOT, '.cache', 'usage-data.json');
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
const STATE_DATABASE = join(CODEX_HOME, 'state_5.sqlite');
const HISTORY_DATABASE = join(CODEX_HOME, 'thread_history_1.sqlite');
const EXACT_FROM = '2026-09-01';
const SNAPSHOT_AAD = Buffer.from('codexpulse:snapshot:v1');
const MAX_RATE_LIMIT_TAIL = 16 * 1024 * 1024;

const args = parseArgs(process.argv.slice(2));

function parseArgs(values) {
  const result = { force: false, initialize: false, resetLedger: false, summary: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--force') result.force = true;
    else if (value === '--initialize') result.initialize = true;
    else if (value === '--reset-ledger') result.resetLedger = true;
    else if (value === '--summary') result.summary = true;
    else if (value.startsWith('--')) result[value.slice(2).replaceAll('-', '_')] = values[++index];
  }
  return result;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function keyId(rawKey) {
  return createHash('sha256').update(rawKey).digest().subarray(0, 9).toString('base64url');
}

function toMilliseconds(value) {
  if (!value) return null;
  const number = Number(value);
  return number > 10_000_000_000 ? number : number * 1000;
}

function asIso(value, fallback = Date.now()) {
  return new Date(toMilliseconds(value) || fallback).toISOString();
}

function monthId(value) {
  return new Date(value).toISOString().slice(0, 7);
}

function dayId(value) {
  return usageDay(value);
}

function safeJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeWindowsPath(value) {
  if (!value) return '';
  return win32.normalize(String(value).replace(/^\\\\\?\\/u, '')).replace(/[\\/]+$/u, '').toLowerCase();
}

function pathContains(root, candidate) {
  if (!root || !candidate) return false;
  return candidate === root || candidate.startsWith(`${root}\\`);
}

function sanitizedTitle(value, fallback) {
  const withoutControls = Array.from(String(value || fallback || 'Codex task'), (character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127 ? ' ' : character;
  }).join('');
  const clean = withoutControls
    .replace(/(?:\\\\\?\\|[A-Za-z]:[\\/])[^\r\n"'<>|]*/gu, '[local file]')
    .replace(/\\\\[^\r\n"'<>|]*/gu, '[local file]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu, '[id]')
    .replace(/\s+/gu, ' ')
    .trim();
  return clean.slice(0, 120) || 'Codex task';
}

const CATEGORY_TERMS = {
  development: [
    'fejleszt', 'implement', 'build', 'create app', 'készíts', 'csinálj', 'kód', 'code', 'script',
    'javíts', 'fix', 'refactor', 'feature', 'funkció', 'weboldal', 'website', 'pwa', 'deploy', 'api',
  ],
  research: [
    'kutat', 'research', 'keress', 'search', 'nézz utána', 'look up', 'forrás', 'source', 'hasonlíts',
    'compare', 'elemezd', 'analyze', 'vizsgáld meg', 'investigate', 'latest', 'aktuális', 'bizonyíték',
  ],
  planning: [
    'tervez', 'plan', 'stratég', 'strategy', 'architekt', 'architecture', 'ötlet', 'idea', 'specifik',
    'roadmap', 'felépítés', 'design decision', 'követelmény', 'requirement',
  ],
  testing: [
    'teszt', 'test', 'ellenőriz', 'verify', 'validál', 'validate', 'diagnos', 'hibakeres', 'debug',
    'audit', 'preflight', 'qa', 'review', 'hiba', 'error',
  ],
  documentation: [
    'dokument', 'document', 'readme', 'leírás', 'útmutató', 'guide', 'összefoglal', 'summary',
    'riport', 'report', 'fordíts', 'translate', 'jegyzet', 'note',
  ],
};

function scoreTerms(text, terms, weight) {
  return terms.reduce((score, term) => score + (text.includes(term) ? weight : 0), 0);
}

function classifyCategory(title, firstMessage, finalMessage) {
  const titleText = String(title || '').toLocaleLowerCase('hu');
  const firstText = String(firstMessage || '').slice(0, 5000).toLocaleLowerCase('hu');
  const finalText = String(finalMessage || '').slice(-3500).toLocaleLowerCase('hu');
  const scores = Object.entries(CATEGORY_TERMS).map(([category, terms]) => ({
    category,
    score: scoreTerms(titleText, terms, 4) + scoreTerms(firstText, terms, 3) + scoreTerms(finalText, terms, 1),
  }));
  scores.sort((left, right) => right.score - left.score);
  return scores[0].score > 0 ? scores[0].category : 'uncategorized';
}

function classifyOutcome(statuses, finalMessage) {
  const text = String(finalMessage || '').slice(-5000).toLocaleLowerCase('hu');
  const latestStatus = statuses.at(-1);
  if (latestStatus === 'inProgress') return 'open';
  const failure = ['nem sikerült', 'sikertelen', 'failed', 'failure', 'cannot complete', 'nem tudtam', 'blokkolva', 'blocked'];
  const partial = ['részleges', 'partial', 'nem futott le', 'not run', 'hátralévő', 'remaining', 'korlátozás', 'limitation'];
  const success = ['elkészült', 'készen', 'sikeres', 'success', 'completed', 'implemented', 'megvalósít', 'ellenőrzés sikeres', 'verified', 'pass'];
  const hasFailure = failure.some((term) => text.includes(term));
  const hasPartial = partial.some((term) => text.includes(term));
  const hasSuccess = success.some((term) => text.includes(term));
  if (latestStatus === 'failed' || (hasFailure && !hasSuccess)) return 'failed';
  if (latestStatus === 'interrupted' || hasPartial || (hasFailure && hasSuccess)) return 'partial';
  if (hasSuccess || latestStatus === 'completed') return 'success';
  return 'open';
}

function zeroUsage() {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costUSD: 0,
  };
}

function addUsage(target, source) {
  target.inputTokens += Number(source.inputTokens ?? 0);
  target.cacheReadTokens += Number(source.cacheReadTokens ?? source.cachedInputTokens ?? 0);
  target.cacheWriteTokens += Number(source.cacheWriteTokens ?? source.cacheCreationTokens ?? 0);
  target.outputTokens += Number(source.outputTokens ?? 0);
  target.reasoningTokens += Number(source.reasoningTokens ?? source.reasoningOutputTokens ?? 0);
  target.totalTokens += Number(source.totalTokens ?? 0);
  target.costUSD += Number(source.costUSD ?? 0);
  return target;
}

function readUsageCache() {
  if (!existsSync(USAGE_CACHE)) return null;
  const parsed = safeJson(readFileSync(USAGE_CACHE, 'utf8'));
  if (!parsed || !Array.isArray(parsed.daily)) return null;
  return parsed;
}

function readDatabases() {
  if (!existsSync(STATE_DATABASE) || !existsSync(HISTORY_DATABASE)) {
    throw new Error('A Codex helyi indexadatbázisa nem található.');
  }
  const state = new DatabaseSync(STATE_DATABASE, { readOnly: true });
  const history = new DatabaseSync(HISTORY_DATABASE, { readOnly: true });
  try {
    const threads = state.prepare(`
      SELECT id, rollout_path, created_at, updated_at, created_at_ms, updated_at_ms,
             cwd, title, tokens_used, first_user_message, preview, model, project_id
      FROM threads
    `).all();
    const projects = state.prepare('SELECT id, name FROM projects').all();
    const roots = state.prepare('SELECT project_id, position, path FROM project_roots').all();
    const edges = state.prepare('SELECT parent_thread_id, child_thread_id FROM thread_spawn_edges').all();
    const turns = history.prepare(`
      SELECT thread_id, turn_id, status, started_at, completed_at, duration_ms, final_agent_item_id
      FROM thread_turns
      ORDER BY COALESCE(started_at, completed_at, 0)
    `).all();
    const finalItems = history.prepare(`
      SELECT tt.thread_id, tt.completed_at, tt.status, ti.item_json
      FROM thread_turns tt
      LEFT JOIN thread_items ti
        ON ti.thread_id = tt.thread_id AND ti.turn_id = tt.turn_id AND ti.item_id = tt.final_agent_item_id
      ORDER BY COALESCE(tt.completed_at, tt.started_at, 0)
    `).all();
    return { threads, projects, roots, edges, turns, finalItems };
  } finally {
    state.close();
    history.close();
  }
}

function buildProjectResolver(projects, roots) {
  const projectMap = new Map(projects.map((item) => [item.id, item.name]));
  const candidates = roots.map((item) => ({
    id: item.project_id,
    name: projectMap.get(item.project_id) || basename(item.path),
    path: normalizeWindowsPath(item.path),
  })).sort((left, right) => right.path.length - left.path.length);
  return (thread) => {
    const cwd = normalizeWindowsPath(thread.cwd);
    const matching = candidates.filter((item) => pathContains(item.path, cwd));
    const directName = projectMap.get(thread.project_id);
    let selected = thread.project_id ? { id: thread.project_id, name: directName || 'Codex' } : null;
    if (!selected || selected.name.toLocaleUpperCase('hu') === 'APPOK') {
      selected = matching.find((item) => item.name.toLocaleUpperCase('hu') !== 'APPOK') || selected || matching[0] || null;
    }
    if (!selected) {
      const fallback = win32.basename(String(thread.cwd || '').replace(/^\\\\\?\\/u, '')) || 'Egyéb';
      return { id: `folder:${createHash('sha256').update(cwd).digest('hex').slice(0, 12)}`, name: sanitizedTitle(fallback, 'Egyéb') };
    }
    return { id: selected.id, name: sanitizedTitle(selected.name, 'Codex') };
  };
}

function buildRootResolver(edges) {
  const parent = new Map(edges.map((edge) => [edge.child_thread_id, edge.parent_thread_id]));
  return (threadId) => {
    const visited = new Set();
    let current = threadId;
    while (parent.has(current) && !visited.has(current)) {
      visited.add(current);
      current = parent.get(current);
    }
    return current;
  };
}

function latestFinalMessages(finalItems) {
  const result = new Map();
  for (const item of finalItems) {
    const parsed = safeJson(item.item_json, {});
    const value = typeof parsed?.text === 'string' ? parsed.text : '';
    if (value) result.set(item.thread_id, { text: value, completedAt: item.completed_at, status: item.status });
  }
  return result;
}

function allocateTaskMonths(group, groupTurns, exactFromMonth) {
  const buckets = new Map();
  for (const turn of groupTurns) {
    const date = asIso(turn.started_at || turn.completed_at, group.updatedMs);
    const month = dayId(date).slice(0, 7);
    const bucket = buckets.get(month) || { turns: 0, activityMs: 0 };
    bucket.turns += 1;
    bucket.activityMs += Math.max(0, Math.min(Number(turn.duration_ms || 0), 6 * 60 * 60 * 1000));
    buckets.set(month, bucket);
  }
  if (!buckets.size) buckets.set(monthId(new Date(group.createdMs).toISOString()), { turns: 1, activityMs: 0 });
  const entries = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right));
  const totalWeight = entries.reduce((sum, [, bucket]) => sum + bucket.turns, 0);
  let allocated = 0;
  return Object.fromEntries(entries.map(([month, bucket], index) => {
    const tokens = index === entries.length - 1
      ? group.tokens - allocated
      : Math.round(group.tokens * bucket.turns / totalWeight);
    allocated += tokens;
    return [month, {
      tokens: Math.max(0, tokens),
      turns: bucket.turns,
      activityMs: bucket.activityMs,
      estimated: month < exactFromMonth || entries.length > 1,
    }];
  }));
}

function buildTasks(database) {
  const threadMap = new Map(database.threads.map((thread) => [thread.id, thread]));
  const rootFor = buildRootResolver(database.edges);
  const resolveProject = buildProjectResolver(database.projects, database.roots);
  const finals = latestFinalMessages(database.finalItems);
  const turnsByRoot = new Map();
  for (const turn of database.turns) {
    const root = rootFor(turn.thread_id);
    const list = turnsByRoot.get(root) || [];
    list.push(turn);
    turnsByRoot.set(root, list);
  }
  const groups = new Map();
  for (const thread of database.threads) {
    const rootId = rootFor(thread.id);
    const group = groups.get(rootId) || {
      id: rootId,
      root: threadMap.get(rootId) || thread,
      threads: [],
      tokens: 0,
      models: new Set(),
      createdMs: Number.MAX_SAFE_INTEGER,
      updatedMs: 0,
    };
    group.threads.push(thread);
    group.tokens += Math.max(0, Number(thread.tokens_used || 0));
    if (thread.model) group.models.add(thread.model);
    group.createdMs = Math.min(group.createdMs, toMilliseconds(thread.created_at_ms || thread.created_at) || Date.now());
    group.updatedMs = Math.max(group.updatedMs, toMilliseconds(thread.updated_at_ms || thread.updated_at) || 0);
    groups.set(rootId, group);
  }

  return [...groups.values()].map((group) => {
    const groupTurns = turnsByRoot.get(group.id) || [];
    const statuses = groupTurns.map((turn) => turn.status);
    const latestGroupThread = [...group.threads].sort((left, right) => Number(right.updated_at_ms || right.updated_at) - Number(left.updated_at_ms || left.updated_at))[0];
    const latestFinal = group.threads.map((thread) => finals.get(thread.id)).filter(Boolean)
      .sort((left, right) => Number(left.completedAt || 0) - Number(right.completedAt || 0)).at(-1);
    const project = resolveProject(group.root);
    const title = sanitizedTitle(group.root.title, group.root.first_user_message);
    const outcome = classifyOutcome(statuses, latestFinal?.text || '');
    const updatedAt = new Date(group.updatedMs || group.createdMs).toISOString();
    return {
      id: group.id,
      title,
      projectId: project.id,
      projectName: project.name,
      category: classifyCategory(title, group.root.first_user_message, latestFinal?.text || ''),
      outcome,
      createdAt: new Date(group.createdMs).toISOString(),
      updatedAt,
      completedMonth: outcome === 'open' ? null : dayId(asIso(latestFinal?.completedAt, group.updatedMs)).slice(0, 7),
      completedAt: outcome === 'open' ? null : dayId(asIso(latestFinal?.completedAt, group.updatedMs)),
      models: [...group.models].sort((left, right) => left.localeCompare(right)),
      months: allocateTaskMonths(group, groupTurns, EXACT_FROM.slice(0, 7)),
      _latestModel: latestGroupThread.model || 'unknown',
      _turns: groupTurns,
      _rolloutPaths: group.threads.map((thread) => thread.rollout_path).filter(Boolean),
    };
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function latestRateLimits(tasks) {
  const paths = [];
  for (const task of tasks) {
    for (const rolloutPath of task._rolloutPaths) {
      if (!paths.includes(rolloutPath) && existsSync(rolloutPath)) paths.push(rolloutPath);
      if (paths.length >= 8) break;
    }
    if (paths.length >= 8) break;
  }
  let latest = null;
  for (const rolloutPath of paths) {
    try {
      const file = statSync(rolloutPath);
      const size = Math.min(file.size, MAX_RATE_LIMIT_TAIL);
      const handle = openSync(rolloutPath, 'r');
      const buffer = Buffer.allocUnsafe(size);
      try {
        readSync(handle, buffer, 0, size, file.size - size);
      } finally {
        closeSync(handle);
      }
      const tail = buffer.toString('utf8');
      const lines = tail.split(/\r?\n/u);
      for (const line of lines) {
        if (!line.includes('"token_count"') || !line.includes('"rate_limits"')) continue;
        const parsed = safeJson(line);
        if (parsed?.type !== 'event_msg' || parsed?.payload?.type !== 'token_count' || !parsed.payload.rate_limits) continue;
        const timestamp = Date.parse(parsed.timestamp);
        if (!Number.isFinite(timestamp) || (latest && timestamp <= latest.timestamp)) continue;
        latest = { timestamp, value: parsed.payload.rate_limits };
      }
    } catch {
      // A currently written rollout can change while the tail is read; the next sync retries it.
    }
  }
  if (!latest) return null;
  const windows = [];
  for (const [id, value] of [['primary', latest.value.primary], ['secondary', latest.value.secondary], ['individual', latest.value.individual_limit]]) {
    if (!value || !Number.isFinite(Number(value.used_percent)) || !Number.isFinite(Number(value.window_minutes))) continue;
    windows.push({
      id,
      usedPercent: Number(value.used_percent),
      windowMinutes: Number(value.window_minutes),
      resetsAt: asIso(value.resets_at),
    });
  }
  return {
    capturedAt: new Date(latest.timestamp).toISOString(),
    planType: latest.value.plan_type || null,
    windows,
    credits: latest.value.credits ? {
      hasCredits: Boolean(latest.value.credits.has_credits),
      unlimited: Boolean(latest.value.credits.unlimited),
      balance: latest.value.credits.balance == null ? null : String(latest.value.credits.balance),
    } : null,
  };
}

function estimatedUsage(totalTokens, usageCache) {
  const totals = usageCache?.totals || {};
  const denominator = Number(totals.totalTokens || 0);
  const ratio = (value) => denominator > 0 ? Number(value || 0) / denominator : 0;
  return {
    inputTokens: Math.round(totalTokens * ratio(totals.inputTokens)),
    cacheReadTokens: Math.round(totalTokens * ratio(totals.cacheReadTokens)),
    cacheWriteTokens: Math.round(totalTokens * ratio(totals.cacheCreationTokens)),
    outputTokens: Math.round(totalTokens * ratio(totals.outputTokens)),
    reasoningTokens: Math.round(totalTokens * ratio(totals.reasoningOutputTokens)),
    totalTokens,
    costUSD: denominator > 0 ? totalTokens * Number(totals.costUSD || 0) / denominator : null,
  };
}


function buildMonths(tasks, usageCache, incrementalLedger) {
  const monthMap = new Map();
  const ensureMonth = (id) => {
    if (!monthMap.has(id)) monthMap.set(id, {
      id,
      usage: zeroUsage(),
      days: new Map(),
      models: new Map(),
      estimated: id < EXACT_FROM.slice(0, 7),
      estimateReasons: id < EXACT_FROM.slice(0, 7) ? ['historic-allocation'] : [],
    });
    return monthMap.get(id);
  };

  if (usageCache) {
    for (const day of usageCache.daily) {
      const month = ensureMonth(String(day.date).slice(0, 7));
      const daily = {
        date: day.date,
        models: Object.keys(day.models || {}).sort((a, b) => a.localeCompare(b)),
        inputTokens: Number(day.inputTokens || 0),
        cacheReadTokens: Number(day.cacheReadTokens || 0),
        cacheWriteTokens: Number(day.cacheCreationTokens || 0),
        outputTokens: Number(day.outputTokens || 0),
        reasoningTokens: Number(day.reasoningOutputTokens || 0),
        totalTokens: Number(day.totalTokens || 0),
        costUSD: Number(day.costUSD || 0),
        turns: 0,
        activeTasks: 0,
        estimated: String(day.date) < EXACT_FROM,
      };
      month.days.set(day.date, daily);
      addUsage(month.usage, daily);
      for (const [modelName, usage] of Object.entries(day.models || {})) {
        month.models.set(modelName, (month.models.get(modelName) || 0) + Number(usage.totalTokens || 0));
      }
    }
  }

  const dayTasks = new Map();
  for (const task of tasks) {
    for (const [id] of Object.entries(task.months)) ensureMonth(id);
    for (const turn of task._turns) {
      const date = dayId(asIso(turn.started_at || turn.completed_at, Date.parse(task.updatedAt)));
      const month = ensureMonth(date.slice(0, 7));
      if (!month.days.has(date)) month.days.set(date, { ...zeroUsage(), date, turns: 0, activeTasks: 0, estimated: true });
      month.days.get(date).turns += 1;
      const key = `${date}:${task.id}`;
      if (!dayTasks.has(key)) {
        dayTasks.set(key, true);
        month.days.get(date).activeTasks += 1;
      }
    }
  }

  if (!usageCache) {
    for (const task of tasks) {
      for (const [id, slice] of Object.entries(task.months)) {
        const month = ensureMonth(id);
        month.usage.totalTokens += slice.tokens;
        month.usage.inputTokens = null;
        month.usage.cacheReadTokens = null;
        month.usage.cacheWriteTokens = null;
        month.usage.outputTokens = null;
        month.usage.reasoningTokens = null;
        month.usage.costUSD = null;
        month.estimated = true;
        if (!month.estimateReasons.includes('missing-usage-cache')) month.estimateReasons.push('missing-usage-cache');
        const model = task.models[0] || 'unknown';
        month.models.set(model, (month.models.get(model) || 0) + slice.tokens);
      }
    }
  } else if (incrementalLedger) {
    for (const [date, entry] of Object.entries(incrementalLedger.days || {})) {
      const month = ensureMonth(date.slice(0, 7));
      if (!month.days.has(date)) month.days.set(date, { ...zeroUsage(), date, turns: 0, activeTasks: 0, estimated: true });
      const estimate = { ...estimatedUsage(Number(entry.totalTokens || 0), usageCache), ...entry };
      addUsage(month.days.get(date), estimate);
      addUsage(month.usage, estimate);
      month.days.get(date).estimated = true;
      month.days.get(date).models = [...new Set([
        ...(month.days.get(date).models || []),
        ...Object.keys(entry.models || {}),
      ])].sort((a, b) => a.localeCompare(b));
      month.estimated = true;
      month.estimateReasons.push('event-tokens-estimated-api-cost');
      for (const [model, tokens] of Object.entries(entry.models || {})) {
        month.models.set(model, (month.models.get(model) || 0) + Number(tokens));
      }
    }
  }

  return [...monthMap.values()].map((month) => ({
    id: month.id,
    usage: month.usage,
    days: [...month.days.values()].sort((left, right) => left.date.localeCompare(right.date)),
    models: [...month.models.entries()].map(([model, tokens]) => ({ model, tokens })).sort((left, right) => right.tokens - left.tokens),
    estimated: month.estimated,
    estimateReasons: [...new Set(month.estimateReasons)],
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function countLargeRollouts(tasks) {
  const paths = new Set(tasks.flatMap((task) => task._rolloutPaths));
  return { sourceFiles: paths.size, skippedLargeFiles: 0 };
}

function buildSnapshot(config) {
  const generatedAt = new Date().toISOString();
  const database = readDatabases();
  const internalTasks = buildTasks(database);
  const { ledger, missingFiles } = updateEventLedger(config, internalTasks, readUsageCache());
  const usageCache = ledger.baseCache;
  const incrementalLedger = ledger;
  const files = countLargeRollouts(internalTasks);
  const snapshot = {
    schemaVersion: 1,
    generatedAt,
    source: 'codexpulse-local',
    exactFrom: EXACT_FROM,
    months: buildMonths(internalTasks, usageCache, incrementalLedger),
    tasks: internalTasks.map(({ _latestModel, _turns, _rolloutPaths, ...task }) => task),
    rateLimits: latestRateLimits(internalTasks),
    diagnostics: {
      rootTasks: internalTasks.length,
      rolledUpSubagents: database.edges.length,
      sourceFiles: files.sourceFiles,
      skippedLargeFiles: files.skippedLargeFiles,
      missingUsageFiles: missingFiles,
      timeZone: 'Europe/Budapest',
      usageBaselineAt: ledger.cutoff,
    },
  };
  return snapshot;
}

function encryptSnapshot(snapshot, masterKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(SNAPSHOT_AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(snapshot), 'utf8'), cipher.final()]);
  const data = Buffer.concat([encrypted, cipher.getAuthTag()]);
  return {
    version: 1,
    algorithm: 'A256GCM',
    keyId: keyId(masterKey),
    generatedAt: snapshot.generatedAt,
    iv: base64url(iv),
    data: base64url(data),
  };
}

async function fileFingerprint(file) {
  try {
    const details = await stat(file);
    return `${relative(CODEX_HOME, file)}:${details.size}:${details.mtimeMs}`;
  } catch {
    return `${relative(CODEX_HOME, file)}:missing`;
  }
}

async function inputSignature() {
  const files = [
    STATE_DATABASE,
    `${STATE_DATABASE}-wal`,
    HISTORY_DATABASE,
    `${HISTORY_DATABASE}-wal`,
    USAGE_CACHE,
    fileURLToPath(import.meta.url),
    join(PROJECT_ROOT, 'scripts', 'codexpulse-ledger.mjs'),
  ];
  const details = await Promise.all(files.map(fileFingerprint));
  return createHash('sha256').update(details.join('|')).digest('hex');
}

async function atomicJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
}

async function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  return safeJson(await readFile(CONFIG_FILE, 'utf8'));
}

async function ensureConfig() {
  let config = await loadConfig();
  if (!config && !args.initialize) throw new Error('Futtasd először a --initialize módot.');
  if (!config) {
    config = {
      version: 1,
      appUrl: args.app_url || 'http://localhost:3000/',
      dataUrl: args.data_url || './codexpulse-data.enc.json',
      masterKey: randomBytes(32).toString('base64url'),
      lastSignature: null,
      lastGeneratedAt: null,
    };
  }
  if (args.app_url) config.appUrl = args.app_url;
  if (args.data_url) config.dataUrl = args.data_url;
  if (args.repository_url) config.repositoryUrl = args.repository_url;
  const masterKey = Buffer.from(config.masterKey, 'base64url');
  if (masterKey.length !== 32) throw new Error('A helyi titkosítási kulcs hibás.');
  return { config, masterKey };
}

async function main() {
  const { config, masterKey } = await ensureConfig();
  // Explicit repair only; normal sync never replaces the frozen baseline.
  if (args.resetLedger) { delete config.incrementalUsage; delete config.eventUsage; }
  const signature = await inputSignature();
  const output = resolve(args.output || DEFAULT_OUTPUT);
  if (!args.force && config.lastSignature === signature && existsSync(output)) {
    process.stdout.write(`${JSON.stringify({ status: 'unchanged', generatedAt: config.lastGeneratedAt })}\n`);
    return;
  }
  const snapshot = buildSnapshot(config);
  const envelope = encryptSnapshot(snapshot, masterKey);
  await atomicJson(output, envelope);
  config.lastSignature = signature;
  config.lastGeneratedAt = snapshot.generatedAt;
  config.lastOutput = output;
  await atomicJson(CONFIG_FILE, config);
  process.stdout.write(`${JSON.stringify({
    status: 'updated',
    generatedAt: snapshot.generatedAt,
    months: snapshot.months.length,
    rootTasks: snapshot.diagnostics.rootTasks,
    rolledUpSubagents: snapshot.diagnostics.rolledUpSubagents,
    encryptedBytes: statSync(output).size,
    dataQuality: snapshot.months.map((month) => ({ month: month.id, estimated: month.estimated })),
  })}\n`);
}

withLock(join(PRIVATE_ROOT, 'sync.lock'), main).catch((error) => {
  process.stderr.write(`CodexPulse sync failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
