import type { ErrorCode } from '@ayd/shared';
import type { PendingConnection, PendingCreate } from '../connections/connection.service';
import type { ChartSpec } from '../ask/chart';
import type { ResultFacts } from '../ask/facts';
import type { LlmAttempt } from '../llm/llm.types';
import type { ExecutionSuccess } from '../user-database/query-executor';

export interface QueryJobData {
  userId: string;
  connectionId: string;
  /** Checked by the SQL guard in the worker, against the latest snapshot and allowlist. */
  sql: string;
}

/** A question in English, answered by the model, the guard, and the executor. */
export interface AskJobData {
  userId: string;
  connectionId: string;
  question: string;
}

/** Test a saved connection, or read its schema again. ip is the requester's, for audit rows. */
export interface ConnectionJobData {
  userId: string;
  connectionId: string;
  ip: string | null;
}

/** A new connection, stored by the worker only if its read-only check passes. */
export interface ConnectionCreateJobData {
  userId: string;
  ip: string | null;
  /** Credentials stay sealed in the payload; the worker opens them in memory. */
  pending: PendingCreate;
}

/** A change of host, database, login, or SSL mode, saved only if the check passes. */
export interface ConnectionUpdateJobData {
  userId: string;
  connectionId: string;
  ip: string | null;
  pending: PendingConnection;
}

/** Payload per job kind. Every payload names its owner, which reads check. */
export interface JobDataByKind {
  'query.run': QueryJobData;
  'question.ask': AskJobData;
  'connection.create': ConnectionCreateJobData;
  'connection.update': ConnectionUpdateJobData;
  'connection.test': ConnectionJobData;
  'schema.refresh': ConnectionJobData;
}

export type JobKind = keyof JobDataByKind;

export const JOB_KINDS: readonly JobKind[] = [
  'query.run',
  'question.ask',
  'connection.create',
  'connection.update',
  'connection.test',
  'schema.refresh',
];

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

/** Model calls, tokens, and time for one question, for accounting (blueprint 9.10). */
export interface AskUsage {
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  llmMs: number;
  queryMs: number;
  totalMs: number;
  /** Models that produced an accepted answer. */
  models: string[];
  /** True when some call failed and another model or attempt was needed. */
  fallbackUsed: boolean;
}

/** What answering a question produced. Nothing runs unless the status is answered. */
export type AskResult =
  | ({
      status: 'answered';
      question: string;
      /** The SQL that ran, as the guard rewrote it. */
      sql: string;
      assumptions: string[];
      explanation: string;
      schemaVersion: number;
      model: string;
      llmAttempts: LlmAttempt[];
      /** True when the SQL came from the proposal cache, not the model. */
      cached: boolean;
      /** True when the schema was refreshed to answer (the database had changed). */
      schemaRefreshed: boolean;
      /** Added once the job finishes. */
      usage?: AskUsage;
      chart: ChartSpec;
      facts: ResultFacts;
      summary: { text: string; source: 'model' | 'template' };
    } & Omit<ExecutionSuccess, 'ok'>)
  | {
      status: 'ambiguous';
      question: string;
      clarifyingQuestion: string;
      assumptions: string[];
      explanation: string;
      schemaVersion: number;
      model: string;
      llmAttempts: LlmAttempt[];
      /** True when the SQL came from the proposal cache, not the model. */
      cached: boolean;
      /** True when the schema was refreshed to answer (the database had changed). */
      schemaRefreshed: boolean;
      /** Added once the job finishes. */
      usage?: AskUsage;
    }
  | {
      status: 'unanswerable';
      question: string;
      explanation: string;
      schemaVersion: number;
      model: string;
      llmAttempts: LlmAttempt[];
      /** True when the SQL came from the proposal cache, not the model. */
      cached: boolean;
      /** True when the schema was refreshed to answer (the database had changed). */
      schemaRefreshed: boolean;
      /** Added once the job finishes. */
      usage?: AskUsage;
    };

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** Where a running job is, for a progress display. */
export type JobStage =
  | 'loading_schema'
  | 'generating_sql'
  | 'summarizing'
  | 'checking_sql'
  | 'connecting'
  | 'running_query'
  | 'checking_access'
  | 'reading_schema';

/** What a runner gets besides its payload. */
export interface JobContext {
  /** Records the stage; a failure to record it never fails the job. */
  report(stage: JobStage): Promise<void>;
  /** Aborted when the owner cancels the job. */
  signal?: AbortSignal;
}

/** A context that reports nowhere and is never cancelled, for scripts and tests. */
export const NO_JOB_CONTEXT: JobContext = { report: async () => undefined };

export const CANCELLED_MESSAGE = 'The job was cancelled.';

/**
 * The outcome of a job its owner cancelled. The queue never runs it again, but `retryable`
 * is true because `retryable` tells the client whether the owner may submit it again.
 */
export function cancelledOutcome(): { ok: false; error: JobError } {
  return {
    ok: false,
    error: { code: 'JOB_CANCELLED', message: CANCELLED_MESSAGE, retryable: true },
  };
}

/** A job as its owner sees it. */
export interface JobView {
  id: string;
  kind: JobKind;
  state: JobState;
  /** While running: the current stage, once the runner has reported one. */
  stage?: JobStage;
  /** True once the owner asked to cancel a job that has not finished. */
  cancelRequested?: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result?: unknown;
  error?: JobError;
}

/**
 * The payload to keep once a job has run: a pending connection's sealed credentials are
 * dropped, so a finished job held for the result TTL carries no ciphertext. Returns null
 * when nothing needs removing.
 */
export function withoutCredentials(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'object' || data === null || !('pending' in data)) {
    return null;
  }
  const pending = (data as { pending?: unknown }).pending;
  if (typeof pending !== 'object' || pending === null || !('sealed' in pending)) {
    return null;
  }
  const { sealed: _sealed, ...settings } = pending as Record<string, unknown>;
  return { ...(data as Record<string, unknown>), pending: settings };
}
