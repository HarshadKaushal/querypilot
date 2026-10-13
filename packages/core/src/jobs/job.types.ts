import type { ErrorCode } from '@ayd/shared';
import type { PendingConnection } from '../connections/connection.service';
import type { ExecutionSuccess } from '../user-database/query-executor';

export interface QueryJobData {
  userId: string;
  connectionId: string;
  /** Checked by the SQL guard in the worker, against the latest snapshot and allowlist. */
  sql: string;
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
  pending: PendingConnection;
}

/** A change of host, database, login, or SSL mode, saved only if the check passes. */
export interface ConnectionUpdateJobData extends ConnectionCreateJobData {
  connectionId: string;
}

/** Payload per job kind. Every payload names its owner, which reads check. */
export interface JobDataByKind {
  'query.run': QueryJobData;
  'connection.create': ConnectionCreateJobData;
  'connection.update': ConnectionUpdateJobData;
  'connection.test': ConnectionJobData;
  'schema.refresh': ConnectionJobData;
}

export type JobKind = keyof JobDataByKind;

export const JOB_KINDS: readonly JobKind[] = [
  'query.run',
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
