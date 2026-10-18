import type {
  AskJobData,
  AskResult,
  JobOutcome,
  QueryJobData,
  QueryJobResult,
} from '../jobs/job.types';

// Query history (ADR 0013): one row in the `queries` table (model QueryRecord) per finished
// question or SQL job. It keeps what was asked, the SQL that ran, the outcome, and usage
// numbers, but never result rows, so history holds no customer data beyond the question.
// This file holds the interface, its token, and the pure helpers that build an entry and
// a page cursor. The Sequelize class is in sequelize-query-history.repository.ts.

/** One history entry as its owner sees it. Never result rows. */
export interface HistoryEntry {
  id: string;
  connectionId: string;
  kind: 'question' | 'sql';
  question: string | null;
  /** The SQL that ran, as the guard rewrote it. Null when nothing ran. */
  sql: string | null;
  status: 'answered' | 'ambiguous' | 'unanswerable' | 'failed' | 'cancelled';
  errorCode: string | null;
  rowCount: number | null;
  truncated: string | null;
  schemaVersion: number | null;
  cached: boolean;
  summary: string | null;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  llmMs: number;
  queryMs: number;
  totalMs: number;
  createdAt: string;
  finishedAt: string;
}

export type NewHistoryEntry = Omit<HistoryEntry, 'createdAt' | 'finishedAt'> & {
  userId: string;
  createdAt: Date;
};

export interface HistoryPage {
  entries: HistoryEntry[];
  /** Pass back as `cursor` for the next, older page. Null on the last page. */
  nextCursor: string | null;
}

/** Records finished question and SQL jobs, and serves them to their owner. */
export interface QueryHistory {
  record(entry: NewHistoryEntry): Promise<void>;
  list(userId: string, limit: number, cursor?: string): Promise<HistoryPage>;
  get(userId: string, id: string): Promise<HistoryEntry>;
  /** Deletes the entry and writes its `history.deleted` audit row in one transaction. */
  delete(userId: string, id: string, ip: string | null): Promise<boolean>;
  /** Deletes every entry and writes `history.cleared` in one transaction. */
  deleteAll(userId: string, ip: string | null): Promise<number>;
}

export const QUERY_HISTORY = Symbol('QUERY_HISTORY');

/**
 * The history entry for a finished job, or null for kinds history does not keep. Built
 * from the outcome the owner saw, so history and the job view agree.
 */
export function historyEntryFor(job: {
  id: string;
  kind: string;
  data: unknown;
  createdAt: Date;
  outcome: JobOutcome<unknown>;
}): NewHistoryEntry | null {
  if (job.kind !== 'question.ask' && job.kind !== 'query.run') {
    return null;
  }
  const data = job.data as Partial<AskJobData & QueryJobData>;
  const base = {
    id: job.id,
    userId: data.userId ?? '',
    connectionId: data.connectionId ?? '',
    kind: job.kind === 'question.ask' ? ('question' as const) : ('sql' as const),
    question: job.kind === 'question.ask' ? (data.question ?? null) : null,
    sql: job.kind === 'query.run' ? (data.sql ?? null) : null,
    errorCode: null,
    rowCount: null,
    truncated: null,
    schemaVersion: null,
    cached: false,
    summary: null,
    models: [] as string[],
    inputTokens: 0,
    outputTokens: 0,
    llmMs: 0,
    queryMs: 0,
    totalMs: 0,
    createdAt: job.createdAt,
  };
  if (!job.outcome.ok) {
    return {
      ...base,
      status: job.outcome.error.code === 'JOB_CANCELLED' ? 'cancelled' : 'failed',
      errorCode: job.outcome.error.code,
    };
  }
  if (job.kind === 'query.run') {
    const result = job.outcome.result as QueryJobResult;
    return {
      ...base,
      status: 'answered',
      sql: result.sql,
      rowCount: result.rowCount,
      truncated: result.truncated || null,
      schemaVersion: result.schemaVersion,
      queryMs: result.durationMs,
      totalMs: result.durationMs,
    };
  }
  const result = job.outcome.result as AskResult;
  const usage = result.usage;
  const shared = {
    ...base,
    status: result.status,
    schemaVersion: result.schemaVersion,
    cached: result.cached,
    models: usage?.models ?? [],
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    llmMs: usage?.llmMs ?? 0,
    totalMs: usage?.totalMs ?? 0,
  };
  if (result.status !== 'answered') {
    return { ...shared, summary: result.explanation };
  }
  return {
    ...shared,
    sql: result.sql,
    rowCount: result.rowCount,
    truncated: result.truncated || null,
    summary: result.summary.text,
    queryMs: result.durationMs,
  };
}

/** Keyset cursor: the last entry's creation time and id, so pages stay stable as rows arrive. */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [time, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(time ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    return null;
  }
  return { createdAt, id };
}
