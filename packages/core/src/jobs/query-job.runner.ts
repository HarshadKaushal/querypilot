import { Injectable } from '@nestjs/common';
import { ConnectionService } from '../connections/connection.service';
import { AppException } from '../errors/app.exception';
import { SqlGuardService } from '../sql-guard/sql-guard.service';
import { QueryExecutor } from '../user-database/query-executor';
import {
  NO_JOB_CONTEXT,
  type JobContext,
  type JobError,
  type JobOutcome,
  type QueryJobData,
  type QueryJobResult,
} from './job.types';

/**
 * Runs SQL for its owner: the guard checks it against the latest snapshot and allowlist,
 * then the executor runs the rewritten SQL. Phase 7 puts the model in front of the guard.
 */
@Injectable()
export class QueryJobRunner {
  constructor(
    private readonly guard: SqlGuardService,
    private readonly connections: ConnectionService,
    private readonly executor: QueryExecutor,
  ) {}

  async run(
    data: QueryJobData,
    context: JobContext = NO_JOB_CONTEXT,
  ): Promise<JobOutcome<QueryJobResult>> {
    try {
      await context.report('checking_sql');
      // Checks ownership, and that a snapshot exists, before the guard runs.
      const check = await this.guard.check(data.userId, data.connectionId, data.sql);
      if (!check.allowed) {
        return {
          ok: false,
          error: {
            code: 'SQL_REJECTED',
            message: check.reason,
            retryable: true,
            detail: { guardCode: check.code },
          },
        };
      }
      context.signal?.throwIfAborted();
      await context.report('connecting');
      const target = await this.connections.resolveTarget(data.userId, data.connectionId);
      if (!target.ok) {
        return { ok: false, error: fromException(target.error) };
      }
      context.signal?.throwIfAborted();
      await context.report('running_query');
      const result = await this.executor.run({
        connectionId: data.connectionId,
        target: target.request,
        sql: check.sql,
        signal: context.signal,
      });
      if (!result.ok) {
        return {
          ok: false,
          error: {
            code: result.code,
            message: result.message,
            retryable: result.retryable,
          },
        };
      }
      const { ok: _ok, ...rows } = result;
      return {
        ok: true,
        result: { ...rows, sql: check.sql, schemaVersion: check.schemaVersion },
      };
    } catch (error) {
      if (error instanceof AppException) {
        return { ok: false, error: fromException(error) };
      }
      throw error;
    }
  }
}

/** An AppException carries a stable code and a message written here, so both pass through. */
export function fromException(error: AppException): JobError {
  const body = error.getResponse() as { message: string };
  return { code: error.code, message: body.message, retryable: false };
}
