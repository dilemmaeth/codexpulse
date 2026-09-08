import type {
  CategoryId,
  CodexPulseSnapshot,
  LocalVault,
  MonthRecord,
  OutcomeId,
  TaskRecord,
} from './types';

export const CATEGORY_ORDER: CategoryId[] = [
  'development',
  'research',
  'planning',
  'testing',
  'documentation',
  'uncategorized',
];

export const OUTCOME_ORDER: OutcomeId[] = ['success', 'partial', 'failed', 'open'];

export type CategoryStat = { id: CategoryId; tasks: number; tokens: number; taskShare: number; tokenShare: number };
export type ProjectStat = { id: string; name: string; tasks: number; tokens: number; share: number };

export type MonthView = {
  month: MonthRecord;
  tasks: TaskRecord[];
  categories: CategoryStat[];
  projects: ProjectStat[];
  outcomes: Record<OutcomeId, number>;
  usageIndex: number | null;
  resultsIndex: number | null;
  previousMonthChange: number | null;
  totalTurns: number;
  activityMs: number;
};

function resolvedProject(task: TaskRecord, vault: LocalVault, allTasks: TaskRecord[] = [task]) {
  const ownRule = vault.projectRules[task.projectId];
  const targetId = ownRule?.mergeInto || task.projectId;
  const targetRule = vault.projectRules[targetId];
  const targetName = allTasks.find((item) => item.projectId === targetId)?.projectName;
  return {
    id: targetId,
    name: targetRule?.name || (targetId === task.projectId ? ownRule?.name : targetName) || task.projectName,
    hidden: Boolean(ownRule?.hidden || targetRule?.hidden),
  };
}

function taskCategory(task: TaskRecord, vault: LocalVault) {
  return vault.categoryOverrides[task.id] || task.category;
}

function taskOutcome(task: TaskRecord, vault: LocalVault) {
  return vault.outcomeOverrides[task.id] || task.outcome;
}

function sumThroughDay(month: MonthRecord, day: number) {
  return month.days.reduce((total, item) => {
    const itemDay = Number(item.date.slice(8, 10));
    return total + (itemDay <= day ? item.totalTokens : 0);
  }, 0);
}

function resultCount(tasks: TaskRecord[], monthId: string, vault: LocalVault, throughDay?: number) {
  return tasks.filter((task) => {
    if (task.completedMonth !== monthId || taskOutcome(task, vault) === 'open') return false;
    if (!throughDay) return true;
    return Number(task.updatedAt.slice(8, 10)) <= throughDay;
  }).length;
}

export function buildMonthView(
  snapshot: CodexPulseSnapshot,
  monthId: string,
  vault: LocalVault,
): MonthView | null {
  const month = snapshot.months.find((item) => item.id === monthId);
  if (!month) return null;
  const tasks = snapshot.tasks.filter((item) => item.months[monthId]);
  const totalTaskTokens = tasks.reduce((sum, item) => sum + item.months[monthId].tokens, 0);
  const scale = totalTaskTokens > 0 ? month.usage.totalTokens / totalTaskTokens : 1;

  const categories = CATEGORY_ORDER.map((id) => {
    const matching = tasks.filter((item) => taskCategory(item, vault) === id);
    const tokens = matching.reduce((sum, item) => sum + item.months[monthId].tokens * scale, 0);
    return { id, tasks: matching.length, tokens, taskShare: 0, tokenShare: 0 };
  }).filter((item) => item.tasks > 0 || item.tokens > 0);
  for (const item of categories) {
    item.taskShare = tasks.length ? (item.tasks / tasks.length) * 100 : 0;
    item.tokenShare = month.usage.totalTokens ? (item.tokens / month.usage.totalTokens) * 100 : 0;
  }

  const projectMap = new Map<string, ProjectStat>();
  for (const item of tasks) {
    const project = resolvedProject(item, vault, snapshot.tasks);
    if (project.hidden) continue;
    const previous = projectMap.get(project.id) || { id: project.id, name: project.name, tasks: 0, tokens: 0, share: 0 };
    previous.tasks += 1;
    previous.tokens += item.months[monthId].tokens * scale;
    projectMap.set(project.id, previous);
  }
  const projects = [...projectMap.values()].sort((a, b) => b.tokens - a.tokens);
  for (const item of projects) item.share = month.usage.totalTokens ? (item.tokens / month.usage.totalTokens) * 100 : 0;

  const outcomes = Object.fromEntries(OUTCOME_ORDER.map((id) => [id, 0])) as Record<OutcomeId, number>;
  for (const item of tasks) {
    if (item.completedMonth === monthId || taskOutcome(item, vault) === 'open') outcomes[taskOutcome(item, vault)] += 1;
  }

  const sortedMonths = [...snapshot.months].sort((a, b) => a.id.localeCompare(b.id));
  const monthIndex = sortedMonths.findIndex((item) => item.id === monthId);
  const generatedMonth = snapshot.generatedAt.slice(0, 7);
  const throughDay = monthId === generatedMonth ? Number(snapshot.generatedAt.slice(8, 10)) : undefined;
  const previous = sortedMonths.slice(Math.max(0, monthIndex - 3), monthIndex);
  const currentUsage = throughDay ? sumThroughDay(month, throughDay) : month.usage.totalTokens;
  const baselineUsage = previous.map((item) => throughDay ? sumThroughDay(item, throughDay) : item.usage.totalTokens).filter((n) => n > 0);
  const usageAverage = baselineUsage.length ? baselineUsage.reduce((a, b) => a + b, 0) / baselineUsage.length : 0;
  const currentResults = resultCount(snapshot.tasks, monthId, vault, throughDay);
  const resultBaseline = previous.map((item) => resultCount(snapshot.tasks, item.id, vault, throughDay));
  const resultAverage = resultBaseline.length ? resultBaseline.reduce((a, b) => a + b, 0) / resultBaseline.length : 0;
  const previousMonth = sortedMonths[monthIndex - 1];
  const previousUsage = previousMonth ? (throughDay ? sumThroughDay(previousMonth, throughDay) : previousMonth.usage.totalTokens) : 0;

  return {
    month,
    tasks: tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    categories,
    projects,
    outcomes,
    usageIndex: usageAverage ? (currentUsage / usageAverage) * 100 : null,
    resultsIndex: resultAverage ? (currentResults / resultAverage) * 100 : null,
    previousMonthChange: previousUsage ? ((currentUsage - previousUsage) / previousUsage) * 100 : null,
    totalTurns: tasks.reduce((sum, item) => sum + item.months[monthId].turns, 0),
    activityMs: tasks.reduce((sum, item) => sum + item.months[monthId].activityMs, 0),
  };
}

export function projectName(task: TaskRecord, vault: LocalVault, allTasks?: TaskRecord[]) {
  return resolvedProject(task, vault, allTasks).name;
}

export function effectiveCategory(task: TaskRecord, vault: LocalVault) {
  return taskCategory(task, vault);
}

export function effectiveOutcome(task: TaskRecord, vault: LocalVault) {
  return taskOutcome(task, vault);
}
