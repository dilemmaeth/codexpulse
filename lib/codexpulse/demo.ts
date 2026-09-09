import type { CodexPulseSnapshot, TaskRecord, TokenUsage } from './types';

const emptyParts = (totalTokens: number, costUSD: number): TokenUsage => ({
  inputTokens: Math.round(totalTokens * 0.245),
  cacheReadTokens: Math.round(totalTokens * 0.69),
  cacheWriteTokens: Math.round(totalTokens * 0.025),
  outputTokens: Math.round(totalTokens * 0.04),
  reasoningTokens: Math.round(totalTokens * 0.025),
  totalTokens,
  costUSD,
});

const task = (
  id: string,
  title: string,
  projectId: string,
  projectName: string,
  category: TaskRecord['category'],
  outcome: TaskRecord['outcome'],
  month: string,
  tokens: number,
  turns: number,
  estimated = false,
): TaskRecord => ({
  id,
  title,
  projectId,
  projectName,
  category,
  outcome,
  createdAt: `${month}-03T08:30:00.000Z`,
  updatedAt: `${month}-08T18:10:00.000Z`,
  completedMonth: outcome === 'open' ? null : month,
  models: ['gpt-5.6-sol'],
  months: {
    [month]: { tokens, turns, activityMs: turns * 8 * 60_000, estimated },
  },
});

const septemberTasks: TaskRecord[] = [
  task('demo-1', 'CodexPulse mobil dashboard kialakítása', 'home', 'HOME', 'development', 'success', '2026-09', 82_000_000, 12),
  task('demo-2', 'Források és megoldások összehasonlítása', 'twitter', 'TWITTER PROFILE', 'research', 'success', '2026-09', 45_000_000, 8),
  task('demo-3', 'Biztonságos szinkron megtervezése', 'home', 'HOME', 'planning', 'success', '2026-09', 36_000_000, 6),
  task('demo-4', 'Telepítési folyamat ellenőrzése', 'avocomp', 'AVOCOMP', 'testing', 'partial', '2026-09', 23_000_000, 5),
  task('demo-5', 'Projektleírás frissítése', 'home', 'HOME', 'documentation', 'success', '2026-09', 14_000_000, 3),
  task('demo-6', 'Adatfeldolgozó javítása', 'crypto-bot', 'CRYPTO BOT', 'development', 'success', '2026-09', 52_000_000, 9),
  task('demo-7', 'Új funkció műszaki felmérése', 'uefn', 'UEFN', 'research', 'open', '2026-09', 34_400_000, 4),
];

const historicTasks: TaskRecord[] = [
  task('demo-jul-1', 'Korábbi fejlesztési feladatok', 'avocomp', 'AVOCOMP', 'development', 'success', '2026-07', 148_000_000, 18, true),
  task('demo-jul-2', 'Kutatási összegzés', 'twitter', 'TWITTER PROFILE', 'research', 'success', '2026-07', 71_000_000, 9, true),
  task('demo-aug-1', 'Alkalmazásfejlesztési hónap', 'apps', 'APPOK', 'development', 'success', '2026-08', 241_000_000, 27, true),
  task('demo-aug-2', 'Tesztelés és hibakeresés', 'crypto-bot', 'CRYPTO BOT', 'testing', 'partial', '2026-08', 112_000_000, 13, true),
];

function days(month: string, totals: number[], estimated: boolean) {
  return totals.map((totalTokens, index) => ({
    ...emptyParts(totalTokens, totalTokens / 9_000_000),
    date: `${month}-${String(index + 1).padStart(2, '0')}`,
    models: ['gpt-5.6-sol', 'gpt-6-astra'],
    turns: Math.max(1, Math.round(totalTokens / 8_000_000)),
    activeTasks: Math.max(1, Math.round(totalTokens / 24_000_000)),
    estimated,
  }));
}

const julyDays = days('2026-07', [18, 27, 22, 41, 33, 29, 49].map((n) => n * 1_000_000), true);
const augustDays = days('2026-08', [31, 47, 38, 62, 51, 43, 39, 42].map((n) => n * 1_000_000), true);
const septemberDays = days('2026-09', [22, 31, 27, 43, 35, 51, 39, 38.4].map((n) => n * 1_000_000), false);

export const DEMO_SNAPSHOT: CodexPulseSnapshot = {
  schemaVersion: 1,
  generatedAt: '2026-09-08T18:15:00.000Z',
  source: 'codexpulse-local',
  exactFrom: '2026-09-01',
  months: [
    {
      id: '2026-07',
      usage: emptyParts(219_000_000, 24.3),
      days: julyDays,
      models: [{ model: 'gpt-5.6-sol', tokens: 219_000_000 }],
      estimated: true,
      estimateReasons: ['historic-allocation'],
    },
    {
      id: '2026-08',
      usage: emptyParts(353_000_000, 39.2),
      days: augustDays,
      models: [
        { model: 'gpt-5.6-sol', tokens: 242_000_000 },
        { model: 'gpt-5.5', tokens: 111_000_000 },
      ],
      estimated: true,
      estimateReasons: ['historic-allocation'],
    },
    {
      id: '2026-09',
      usage: emptyParts(286_400_000, 31.8),
      days: septemberDays,
      models: [
        { model: 'gpt-5.6-sol', tokens: 196_400_000 },
        { model: 'gpt-6-astra', tokens: 90_000_000 },
      ],
      estimated: false,
      estimateReasons: [],
    },
  ],
  tasks: [...historicTasks, ...septemberTasks],
  rateLimits: {
    capturedAt: '2026-09-08T18:15:00.000Z',
    planType: 'pro',
    windows: [
      { id: 'primary', usedPercent: 34, windowMinutes: 300, resetsAt: '2026-09-08T21:00:00.000Z' },
      { id: 'secondary', usedPercent: 61, windowMinutes: 10_080, resetsAt: '2026-09-12T08:00:00.000Z' },
    ],
    credits: null,
  },
  diagnostics: {
    rootTasks: 11,
    rolledUpSubagents: 4,
    sourceFiles: 15,
    skippedLargeFiles: 0,
  },
};
