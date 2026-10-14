import { Injectable } from '@nestjs/common';
import { ConnectionService } from '../connections/connection.service';
import { AppException } from '../errors/app.exception';
import {
  NO_JOB_CONTEXT,
  type AskJobData,
  type AskResult,
  type JobContext,
  type JobError,
  type JobOutcome,
} from '../jobs/job.types';
import { fromException } from '../jobs/query-job.runner';
import { LlmClient } from '../llm/llm-client';
import { LlmError, type LlmAttempt } from '../llm/llm.types';
import { SchemaService } from '../schema/schema.service';
import { SqlGuardService } from '../sql-guard/sql-guard.service';
import { QueryExecutor } from '../user-database/query-executor';
import {
  buildPrompt,
  selectTables,
  SQL_SYSTEM_PROMPT,
  type ProposalFeedback,
} from './prompt';
import { SqlProposalSchema, type SqlProposal } from './sql-proposal';

/** Rewrites after the guard rejects a proposal (blueprint 9.5: at most 2). */
export const MAX_GUARD_RETRIES = 2;

/** Room for the SQL, the assumptions, and the model's brief thinking. */
const PROPOSAL_MAX_TOKENS = 4096;

/** Sent back to the model when PostgreSQL could not run its query. Fixed text: never the database's. */
const QUERY_INVALID_FEEDBACK =
  'PostgreSQL could not run this query as written. Check that each column belongs to the table it is read from, that types match in comparisons and joins, and that every selected column is grouped or aggregated.';

/**
 * Answers a question in English (blueprint section 9, steps 1 to 7): reads the allowlisted
 * schema, asks the model for one SELECT, checks it with the guard, and runs it read-only.
 *
 * Retries are bounded. A guard rejection goes back to the model with the guard's reason, up
 * to MAX_GUARD_RETRIES times. A query PostgreSQL rejects as invalid (a wrong column type, a
 * missing GROUP BY) gets one more attempt. Timeouts, permission errors, and connection
 * problems are not retried. An ambiguous or unanswerable question stops before anything
 * runs. The model only ever sees allowed tables and columns, and no rows in this step.
 */
@Injectable()
export class AskJobRunner {
  constructor(
    private readonly schemas: SchemaService,
    private readonly guard: SqlGuardService,
    private readonly connections: ConnectionService,
    private readonly executor: QueryExecutor,
    private readonly llm: LlmClient,
  ) {}

  async run(
    data: AskJobData,
    context: JobContext = NO_JOB_CONTEXT,
  ): Promise<JobOutcome<AskResult>> {
    const attempts: LlmAttempt[] = [];
    try {
      await context.report('loading_schema');
      const schema = await this.schemas.schema(data.userId, data.connectionId);
      if (schema.tables.length === 0) {
        return failed(
          'SCHEMA_NOT_READY',
          'No tables are allowed for this connection yet. Choose tables in the allowlist first.',
        );
      }
      const shown = selectTables(schema.tables, data.question);
      let feedback: ProposalFeedback | undefined;
      let guardRetries = 0;
      let queryRetried = false;

      for (;;) {
        await context.report('generating_sql');
        const proposal = await this.propose(
          data.question,
          shown,
          feedback,
          attempts,
          context,
        );
        const model = attempts.at(-1)?.model ?? '';
        if (proposal.status !== 'ok') {
          return {
            ok: true,
            result:
              proposal.status === 'ambiguous'
                ? {
                    status: 'ambiguous',
                    question: data.question,
                    clarifyingQuestion: proposal.clarifyingQuestion,
                    assumptions: proposal.assumptions,
                    explanation: proposal.explanation,
                    schemaVersion: schema.version,
                    model,
                    llmAttempts: attempts,
                  }
                : {
                    status: 'unanswerable',
                    question: data.question,
                    explanation: proposal.explanation,
                    schemaVersion: schema.version,
                    model,
                    llmAttempts: attempts,
                  },
          };
        }

        await context.report('checking_sql');
        const check = await this.guard.check(
          data.userId,
          data.connectionId,
          proposal.sql,
        );
        if (!check.allowed) {
          if (guardRetries < MAX_GUARD_RETRIES) {
            guardRetries += 1;
            feedback = { sql: proposal.sql, reason: check.reason };
            continue;
          }
          return failed(
            'SQL_REJECTED',
            'The assistant could not write a query that passes the safety checks. Try asking in a different way.',
            false,
            { guardCode: check.code },
          );
        }

        context.signal?.throwIfAborted();
        await context.report('connecting');
        const target = await this.connections.resolveTarget(
          data.userId,
          data.connectionId,
        );
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
          if (result.code === 'QUERY_INVALID' && !queryRetried) {
            queryRetried = true;
            feedback = { sql: proposal.sql, reason: QUERY_INVALID_FEEDBACK };
            continue;
          }
          return failed(result.code, result.message, result.retryable);
        }
        const { ok: _ok, ...rows } = result;
        return {
          ok: true,
          result: {
            status: 'answered',
            question: data.question,
            sql: check.sql,
            assumptions: proposal.assumptions,
            explanation: proposal.explanation,
            ...rows,
            schemaVersion: check.schemaVersion,
            model,
            llmAttempts: attempts,
          },
        };
      }
    } catch (error) {
      if (error instanceof AppException) {
        return { ok: false, error: fromException(error) };
      }
      if (error instanceof LlmError && error.kind !== 'cancelled') {
        return { ok: false, error: llmFailure(error) };
      }
      throw error;
    }
  }

  private async propose(
    question: string,
    shown: ReturnType<typeof selectTables>,
    feedback: ProposalFeedback | undefined,
    attempts: LlmAttempt[],
    context: JobContext,
  ): Promise<SqlProposal> {
    try {
      const result = await this.llm.generateObject(
        {
          purpose: 'sql_proposal',
          system: SQL_SYSTEM_PROMPT,
          prompt: buildPrompt({
            tables: shown.tables,
            question,
            feedback,
            partial: shown.partial,
          }),
          maxOutputTokens: PROPOSAL_MAX_TOKENS,
          signal: context.signal,
        },
        SqlProposalSchema,
      );
      attempts.push(...result.attempts);
      return result.value;
    } catch (error) {
      const failedAttempts = (error as { attempts?: LlmAttempt[] }).attempts;
      attempts.push(...(failedAttempts ?? []));
      if (error instanceof LlmError && error.kind === 'cancelled') {
        // The processor turns the aborted signal into a cancelled outcome.
        context.signal?.throwIfAborted();
      }
      throw error;
    }
  }
}

function failed(
  code: JobError['code'],
  message: string,
  retryable = false,
  detail?: Record<string, string>,
): { ok: false; error: JobError } {
  return {
    ok: false,
    error: { code, message, retryable, ...(detail ? { detail } : {}) },
  };
}

/** A model failure as the owner sees it. The provider's own text is never included. */
export function llmFailure(error: LlmError): JobError {
  if (error.kind === 'misconfigured') {
    return {
      code: 'LLM_NOT_CONFIGURED',
      message:
        'The assistant is not set up on this server yet. An administrator needs to add a model API key.',
      retryable: false,
    };
  }
  return {
    code: 'LLM_UNAVAILABLE',
    message:
      error.kind === 'rate_limited'
        ? 'The assistant is busy right now. Try again in a minute.'
        : 'The assistant could not answer right now. Try again shortly.',
    retryable: true,
  };
}
