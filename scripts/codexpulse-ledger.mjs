import { openSync, closeSync, readSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BLOCK = 1024 * 1024;
export const usageDay = (timestamp) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
const zero = () => ({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 });

function parseLine(line) {
  if (!line.includes('"token_count"') && !line.includes('"turn_context"')) return null;
  try {
    const item = JSON.parse(line);
    if (!Number.isFinite(Date.parse(item.timestamp))) return null;
    if (item.type === 'turn_context') return { timestamp: item.timestamp, model: item.payload?.model };
    if (item.type === 'event_msg' && item.payload?.type === 'token_count' && item.payload.info?.total_token_usage) {
      return { timestamp: item.timestamp, total: item.payload.info.total_token_usage, last: item.payload.info.last_token_usage };
    }
  } catch { /* Incomplete/unrelated lines carry no usage. */ }
  return null;
}

// Initial migration reads backwards only as far as the frozen cache boundary.
// Subsequent runs read complete appended lines only. No prompt text is retained.
export function readUsageEvents(path, cursor, cutoff) {
  const size = statSync(path).size;
  if (cursor?.offset === size) return { events: [], offset: size };
  const handle = openSync(path, 'r');
  try {
    const events = [];
    if (cursor && size >= cursor.offset) {
      let carry = Buffer.alloc(0), position = cursor.offset, offset = cursor.offset;
      while (position < size) {
        const buffer = Buffer.alloc(Math.min(BLOCK, size - position));
        const length = readSync(handle, buffer, 0, buffer.length, position);
        if (!length) break;
        position += length;
        const combined = Buffer.concat([carry, buffer.subarray(0, length)]);
        const end = combined.lastIndexOf(10);
        if (end < 0) { carry = combined; continue; }
        for (const line of combined.subarray(0, end).toString('utf8').split('\n')) {
          const event = parseLine(line); if (event) events.push(event);
        }
        carry = combined.subarray(end + 1);
        offset = position - carry.length;
      }
      return { events, offset };
    }
    let position = size, suffix = Buffer.alloc(0), offset = size, first = true, found = false;
    while (position > 0 && !found) {
      const length = Math.min(BLOCK, position); position -= length;
      const buffer = Buffer.alloc(length); readSync(handle, buffer, 0, length, position);
      const combined = Buffer.concat([buffer, suffix]);
      const lines = combined.toString('utf8').split('\n');
      if (first) { const incomplete = lines.pop(); offset -= Buffer.byteLength(incomplete || ''); first = false; }
      suffix = position ? Buffer.from(lines.shift() || '') : Buffer.alloc(0);
      for (let i = lines.length - 1; i >= 0; i--) {
        const event = parseLine(lines[i]);
        if (!event) continue;
        events.push(event);
        if (event.total && Date.parse(event.timestamp) <= Date.parse(cutoff)) { found = true; break; }
      }
    }
    return { events: events.reverse(), offset };
  } finally { closeSync(handle); }
}

export function tokenDelta(previous, current, last) {
  // Repeated cumulative snapshots are not new usage. A reset starts a new segment.
  if (previous && Number(current.total_tokens) === Number(previous.total_tokens)) return zero();
  const reset = !previous || Number(current.total_tokens) < Number(previous.total_tokens);
  const segment = reset ? (last || current) : current;
  const delta = (key) => Math.max(0, Number(segment[key] || 0) - Number(reset ? 0 : previous?.[key] || 0));
  const cached = delta('cached_input_tokens');
  const input = delta('input_tokens');
  const output = delta('output_tokens');
  return { inputTokens: Math.max(0, input - cached), cacheReadTokens: cached, cacheWriteTokens: delta('cache_write_input_tokens'), outputTokens: output, reasoningTokens: delta('reasoning_output_tokens'), totalTokens: input + output };
}

export function applyEvents(ledger, file, events, taskId) {
  for (const event of events) {
    if (event.model) { file.model = event.model; continue; }
    if (!event.total) continue;
    if (Date.parse(event.timestamp) <= Date.parse(ledger.cutoff)) { file.total = event.total; file.timestamp = event.timestamp; continue; }
    // A truncated/replaced log can replay previously ingested records.
    if (file.timestamp && Date.parse(event.timestamp) < Date.parse(file.timestamp)) continue;
    const usage = tokenDelta(file.total, event.total, event.last);
    file.total = event.total;
    file.timestamp = event.timestamp;
    if (!usage.totalTokens) continue;
    const fingerprint = createHash('sha256').update(JSON.stringify([event.timestamp, event.total, event.last])).digest('hex');
    ledger.seen ||= {};
    if (ledger.seen[fingerprint]) continue;
    ledger.seen[fingerprint] = true;
    const date = usageDay(event.timestamp);
    const day = ledger.days[date] ||= { ...zero(), models: {} };
    for (const key of Object.keys(zero())) day[key] += usage[key];
    const model = file.model || 'unknown';
    day.models[model] = (day.models[model] || 0) + usage.totalTokens;
    const months = ledger.taskMonths[taskId] ||= {};
    months[date.slice(0, 7)] = (months[date.slice(0, 7)] || 0) + usage.totalTokens;
  }
}

export function updateEventLedger(config, tasks, cache) {
  if (!config.eventUsage && (!cache || !Number.isFinite(Date.parse(cache.generatedAt)))) throw new Error('A timestamped usage cache is required for ledger migration.');
  const ledger = config.eventUsage || { version: 2, cutoff: cache.generatedAt, baseCache: structuredClone(cache), files: {}, days: {}, taskMonths: {}, frozenTasks: {} };
  if (ledger.version !== 2) throw new Error('Unsupported event ledger version');
  let missingFiles = 0;
  for (const task of tasks) {
    for (const path of task._rolloutPaths) {
      const id = createHash('sha256').update(path).digest('hex');
      const previous = ledger.files[id];
      try {
        const result = readUsageEvents(path, previous, ledger.cutoff);
        const file = previous || {};
        applyEvents(ledger, file, result.events, task.id);
        file.offset = result.offset;
        ledger.files[id] = file;
      } catch (error) {
        if (error?.code === 'ENOENT') { missingFiles++; continue; }
        throw error;
      }
    }
    const observed = ledger.taskMonths[task.id] || {};
    const frozen = ledger.frozenTasks[task.id];
    if (!frozen) ledger.frozenTasks[task.id] = { months: structuredClone(task.months), observed: { ...observed } };
    else {
      for (const [month, tokens] of Object.entries(observed)) {
        const delta = Math.max(0, tokens - (frozen.observed[month] || 0));
        if (!delta) continue;
        frozen.months[month] ||= { tokens: 0, turns: 0, activityMs: 0, estimated: true };
        frozen.months[month].tokens += delta;
      }
      frozen.observed = { ...observed };
    }
    const fixed = ledger.frozenTasks[task.id].months;
    for (const month of new Set([...Object.keys(fixed), ...Object.keys(task.months)])) {
      task.months[month] = { tokens: fixed[month]?.tokens || 0, turns: task.months[month]?.turns || 0, activityMs: task.months[month]?.activityMs || 0, estimated: true };
    }
  }
  config.eventUsage = ledger;
  return { ledger, missingFiles };
}
