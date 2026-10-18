export interface UsageDelta {
  questions: number;
  rowsReturned: number;
  inputTokens: number;
  outputTokens: number;
}

export type DailyUsage = UsageDelta & { day: string };

/** Per-user daily usage, written by the worker as jobs finish and read by the API. */
export interface UsageCounters {
  add(userId: string, day: string, delta: UsageDelta): Promise<void>;
  get(userId: string, day: string): Promise<DailyUsage>;
}

export const USAGE_COUNTERS = Symbol('USAGE_COUNTERS');
