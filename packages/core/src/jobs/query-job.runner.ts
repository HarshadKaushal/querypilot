import { Injectable } from '@nestjs/common';
import { ConnectionService } from '../connections/connection.service';
import { AppException } from '../errors/app.exception';
import { SqlGuardService } from '../sql-guard/sql-guard.service';
import { QueryExecutor } from '../user-database/query-executor';
import { executionFailure, fromException } from './job-errors';
import {
  NO_JOB_CONTEXT,
  type JobContext,
  type JobOutcome,
  type QueryJobData,
  type QueryJobResult,
} from './job.types';
import { runCheckedSql } from './run-checked-sql';

/**
 * Runs SQL for its owner: the guard checks it against the latest snapshot and allowlist,
 * then the executor runs the rewritten SQL. This is the "run your own SQL" path; a question
 * in English goes through AskJobRunner, which asks the model first.
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
      const run = await runCheckedSql(
        { connections: this.connections, executor: this.executor },
        { userId: data.userId, connectionId: data.connectionId, sql: check.sql },
        context,
      );
      if (!run.ran) {
        return { ok: false, error: run.error };
      }
      if (!run.result.ok) {
        return { ok: false, error: executionFailure(run.result) };
      }
      const { ok: _ok, ...rows } = run.result;
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
