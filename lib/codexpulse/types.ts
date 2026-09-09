export type Language = 'hu' | 'en';

export type CategoryId =
  | 'development'
  | 'research'
  | 'planning'
  | 'testing'
  | 'documentation'
  | 'uncategorized';

export type OutcomeId = 'success' | 'partial' | 'failed' | 'open';

export type TokenUsage = {
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number;
  costUSD: number | null;
};

export type DailyUsage = TokenUsage & {
  date: string;
  models?: string[];
  turns: number;
  activeTasks: number;
  estimated: boolean;
};

export type ModelUsage = {
  model: string;
  tokens: number;
};

export type MonthRecord = {
  id: string;
  usage: TokenUsage;
  days: DailyUsage[];
  models: ModelUsage[];
  estimated: boolean;
  estimateReasons: string[];
};

export type TaskMonthSlice = {
  tokens: number;
  turns: number;
  activityMs: number;
  estimated: boolean;
};

export type TaskRecord = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  category: CategoryId;
  outcome: OutcomeId;
  createdAt: string;
  updatedAt: string;
  completedMonth: string | null;
  models: string[];
  months: Record<string, TaskMonthSlice>;
};

export type RateLimitWindow = {
  id: string;
  usedPercent: number;
  windowMinutes: number;
  resetsAt: string;
};

export type RateLimitSnapshot = {
  capturedAt: string;
  planType: string | null;
  windows: RateLimitWindow[];
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null;
};

export type CodexPulseSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  source: 'codexpulse-local';
  exactFrom: string;
  months: MonthRecord[];
  tasks: TaskRecord[];
  rateLimits: RateLimitSnapshot | null;
  diagnostics: {
    rootTasks: number;
    rolledUpSubagents: number;
    sourceFiles: number;
    skippedLargeFiles: number;
  };
};

export type ProjectRule = {
  name?: string;
  hidden?: boolean;
  mergeInto?: string | null;
};

export type LocalVault = {
  categoryOverrides: Record<string, CategoryId>;
  outcomeOverrides: Record<string, OutcomeId>;
  projectRules: Record<string, ProjectRule>;
  reportIncludesProjects: boolean;
};

export type ProtectedKeyBundle = {
  version: 1;
  algorithm: 'PBKDF2-SHA256+A256GCM';
  iterations: number;
  salt: string;
  iv: string;
  wrappedKey: string;
  keyId: string;
  dataUrl: string;
};

export type EncryptedEnvelope = {
  version: 1;
  algorithm: 'A256GCM';
  keyId: string;
  generatedAt: string;
  iv: string;
  data: string;
};

export type PairingPayload = {
  version: 1;
  appUrl: string;
  dataUrl: string;
  key: string;
  keyId: string;
};

export const EMPTY_VAULT: LocalVault = {
  categoryOverrides: {},
  outcomeOverrides: {},
  projectRules: {},
  reportIncludesProjects: false,
};
