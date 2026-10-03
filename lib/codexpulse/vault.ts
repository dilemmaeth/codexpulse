import type { LocalVault } from './types';

export function validateVault(value: unknown): LocalVault {
  if (!value || typeof value !== 'object') throw new Error('VAULT_SCHEMA');
  const source = value as LocalVault;
  const record = (item: unknown) => Boolean(item && typeof item === 'object' && !Array.isArray(item));
  if (!record(source.categoryOverrides) || !record(source.outcomeOverrides) || !record(source.projectRules) || typeof source.reportIncludesProjects !== 'boolean') throw new Error('VAULT_SCHEMA');
  if (Object.values(source.categoryOverrides).some((v) => !['development', 'research', 'planning', 'testing', 'documentation', 'uncategorized'].includes(v))) throw new Error('VAULT_SCHEMA');
  if (Object.values(source.outcomeOverrides).some((v) => !['success', 'partial', 'failed', 'open'].includes(v))) throw new Error('VAULT_SCHEMA');
  for (const rule of Object.values(source.projectRules)) {
    if (!record(rule) || (rule.name !== undefined && typeof rule.name !== 'string') || (rule.hidden !== undefined && typeof rule.hidden !== 'boolean') || (rule.mergeInto != null && typeof rule.mergeInto !== 'string')) throw new Error('VAULT_SCHEMA');
  }
  if (source.outcomeDates !== undefined && (!record(source.outcomeDates) || Object.values(source.outcomeDates).some((date) => !/^\d{4}-\d{2}-\d{2}$/u.test(date)))) throw new Error('VAULT_SCHEMA');
  if (source.monthReviews !== undefined) {
    if (!record(source.monthReviews)) throw new Error('VAULT_SCHEMA');
    for (const [month, review] of Object.entries(source.monthReviews)) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month) || !record(review)) throw new Error('VAULT_SCHEMA');
      for (const field of ['achievements', 'unfinished', 'nextFocus'] as const) {
        if (typeof review[field] !== 'string' || review[field].length > 2000) throw new Error('VAULT_SCHEMA');
      }
      if (review.closedAt !== null && (typeof review.closedAt !== 'string' || !Number.isFinite(Date.parse(review.closedAt)))) throw new Error('VAULT_SCHEMA');
      if (review.closedAt !== null || review.summary !== undefined) {
        const summary = review.summary;
        if (!record(summary) || !summary || typeof summary.generatedAt !== 'string' || !Number.isFinite(Date.parse(summary.generatedAt))) throw new Error('VAULT_SCHEMA');
        for (const field of ['totalTokens', 'tasks', 'activeDays', 'success', 'partial', 'failed', 'open', 'resultPoints'] as const) {
          if (typeof summary[field] !== 'number' || !Number.isFinite(summary[field]) || summary[field] < 0) throw new Error('VAULT_SCHEMA');
        }
      }
    }
  }
  return { categoryOverrides: source.categoryOverrides, outcomeOverrides: source.outcomeOverrides, projectRules: source.projectRules, outcomeDates: source.outcomeDates || {}, reportIncludesProjects: source.reportIncludesProjects, ...(source.monthReviews ? { monthReviews: source.monthReviews } : {}) };
}

export async function saveBackupFile(text: string) {
  const file = new File([text], 'codexpulse-corrections.enc.json', { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'CodexPulse backup' });
    return;
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
