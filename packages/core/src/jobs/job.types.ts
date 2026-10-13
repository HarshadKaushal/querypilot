import type { ErrorCode } from '@ayd/shared';
import type { ExecutionSuccess } from '../user-database/query-executor';

export interface QueryJobData {
  userId: string;
  connectionId: string;
  /** Checked by the SQL guard in the worker, against the latest snapshot and allowlist. */
  sql: string;
}

/** Payload per job kind. Every payload names its owner, which reads check. */
export interface JobDataByKind {
  'query.run': QueryJobData;
}

export type JobKind = keyof JobDataByKind;

export const JOB_KINDS: readonly JobKind[] = ['query.run'];

/** An expected failure: a stable code and a message written in this codebase. */
export interface JobError {
  code: ErrorCode;
  message: string;
  /** True when trying again, perhaps with corrected input, could succeed. */
  retryable: boolean;
  detail?: Record<string, string>;
}

/**
 * What a job's processing returns. Expected failures are outcomes, not thrown errors, so
 * BullMQ marks a job failed only when something unexpected broke.
 */
export type JobOutcome<Result> =
  { ok: true; result: Result } | { ok: false; error: JobError };

export interface QueryJobResult extends Omit<ExecutionSuccess, 'ok'> {
  /** The SQL that ran, as the guard rewrote it. */
  sql: string;
  schemaVersion: number;
}

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';

/** A job as its owner sees it. */
export interface JobView {
  id: string;
  kind: JobKind;
  state: JobState;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result?: unknown;
  error?: JobError;
}
