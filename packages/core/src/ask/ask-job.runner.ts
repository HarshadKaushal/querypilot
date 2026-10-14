import { Inject, Injectable } from '@nestjs/common';
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
import { SchemaService, type SchemaView } from '../schema/schema.service';
import { SqlGuardService } from '../sql-guard/sql-guard.service';
import { QueryExecutor } from '../user-database/query-executor';
import {
  buildPrompt,
  selectTables,
  SQL_SYSTEM_PROMPT,
  type ProposalFeedback,
} from './prompt';
import { selectChart } from './chart';
import { computeFacts, type ResultFacts } from './facts';
import { PROPOSAL_CACHE, questionKey, type ProposalCache } from './proposal-cache';
import {
  buildSummaryPrompt,
  SUMMARY_SAMPLE_ROWS,
  SUMMARY_SYSTEM_PROMPT,
  SummarySchema,
  summaryIsGrounded,
  templateSummary,
} from './summary';
import { SqlProposalSchema, type SqlProposal } from './sql-proposal';

/** Rewrites after the guard rejects a proposal (blueprint 9.5: at most 2). */
export const MAX_GUARD_RETRIES = 2;

/** Room for the SQL, the assumptions, and the model's brief thinking. */
const PROPOSAL_MAX_TOKENS = 4096;

/** A short summary needs far less room. */
const SUMMARY_MAX_TOKENS = 1024;

/** Sent back to the model when PostgreSQL could not run its query. Fixed text: never the database's. */
const QUERY_INVALID_FEEDBACK =
  'PostgreSQL could not run this query as written. Check that each column belongs to the table it is read from, that types match in comparisons and joins, and that every selected column is grouped or aggregated.';

/** What one pass over a schema produced: a final outcome, or "the schema changed". */
type Pass =
  | { kind: 'done'; outcome: JobOutcome<AskResult> }
  | { kind: 'schema_changed'; error: JobError };

/**
 * Answers a question in English (blueprint section 9, steps 1 to 7): reads the allowlisted
 * schema, finds a cached proposal or asks the model for one SELECT, checks it with the
 * guard, and runs it read-only.
 *
 * Retries are bounded. A guard rejection goes back to the model with the guard's reason, up
 * to MAX_GUARD_RETRIES times. A query PostgreSQL rejects as invalid gets one more attempt.
 * When the database no longer has a table or column the snapshot listed
 * (QUERY_SCHEMA_CHANGED), the schema is refreshed and the question answered again, once;
 * new objects stay hidden until allowed, so this never widens access. Timeouts, permission
 * errors, and connection problems are not retried. An ambiguous or unanswerable question
 * stops before anything runs. The model only ever sees allowed tables and columns, and no
 * rows in this step.
 */
@Injectable()
export class AskJobRunner {
  constructor(
    private readonly schemas: SchemaService,
    private readonly guard: SqlGuardService,
    private readonly connections: ConnectionService,
    private readonly executor: QueryExecutor,
    private readonly llm: LlmClient,
    @Inject(PROPOSAL_CACHE) private readonly cache: ProposalCache,
  ) {}

  async run(
    data: AskJobData,
    context: JobContext = NO_JOB_CONTEXT,
  ): Promise<JobOutcome<AskResult>> {
    const attempts: LlmAttempt[] = [];
    const started = Date.now();
    try {
      await context.report('loading_schema');
      let schema = await this.schemas.schema(data.userId, data.connectionId);
      let refreshed = false;
      for (;;) {
        if (schema.tables.length === 0) {
          return failed(
            'SCHEMA_NOT_READY',
            'No tables are allowed for this connection yet. Choose tables in the allowlist first.',
          );
        }
        const pass = await this.answer(data, schema, refreshed, attempts, context);
        if (pass.kind === 'done') {
          return withUsage(pass.outcome, attempts, started);
        }
        if (refreshed) {
          return { ok: false, error: pass.error };
        }
        // The database changed since the last refresh: read it again and retry once.
        refreshed = true;
        await context.report('reading_schema');
        await this.schemas.refresh(data.userId, data.connectionId, null);
        schema = await this.schemas.schema(data.userId, data.connectionId);
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

  /** One attempt to answer against this schema: cache first, then the model. */
  private async answer(
    data: AskJobData,
    schema: SchemaView,
    refreshed: boolean,
    attempts: LlmAttempt[],
    context: JobContext,
  ): Promise<Pass> {
    const key = questionKey(data.question);
    const shown = selectTables(schema.tables, data.question);
    let cached = await this.cache.find(data.connectionId, schema.fingerprint, key);
    let feedback: ProposalFeedback | undefined;
    let guardRetries = 0;
    let queryRetried = false;

    for (;;) {
      let proposal: SqlProposal;
      let model: string;
      const fromCache = cached !== null;
      if (cached) {
        proposal = {
          status: 'ok',
          sql: cached.sql,
          assumptions: cached.assumptions,
          clarifyingQuestion: '',
          explanation: cached.explanation,
        };
        model = cached.model;
        cached = null;
      } else {
        await context.report('generating_sql');
        proposal = await this.propose(data.question, shown, feedback, attempts, context);
        model = attempts.at(-1)?.model ?? '';
      }
      const common = {
        question: data.question,
        schemaVersion: schema.version,
        model,
        llmAttempts: attempts,
        cached: fromCache,
        schemaRefreshed: refreshed,
      };
      if (proposal.status !== 'ok') {
        return {
          kind: 'done',
          outcome: {
            ok: true,
            result:
              proposal.status === 'ambiguous'
                ? {
                    ...common,
                    status: 'ambiguous',
                    clarifyingQuestion: proposal.clarifyingQuestion,
                    assumptions: proposal.assumptions,
                    explanation: proposal.explanation,
                  }
                : {
                    ...common,
                    status: 'unanswerable',
                    explanation: proposal.explanation,
                  },
          },
        };
      }

      await context.report('checking_sql');
      const check = await this.guard.check(data.userId, data.connectionId, proposal.sql);
      if (!check.allowed) {
        if (fromCache) {
          // A cached proposal the guard no longer accepts: drop it and ask the model.
          await this.cache.forget(data.connectionId, schema.fingerprint, key);
          continue;
        }
        if (guardRetries < MAX_GUARD_RETRIES) {
          guardRetries += 1;
          feedback = { sql: proposal.sql, reason: check.reason };
          continue;
        }
        return done(
          failed(
            'SQL_REJECTED',
            'The assistant could not write a query that passes the safety checks. Try asking in a different way.',
            false,
            { guardCode: check.code },
          ),
        );
      }

      context.signal?.throwIfAborted();
      await context.report('connecting');
      const target = await this.connections.resolveTarget(data.userId, data.connectionId);
      if (!target.ok) {
        return done({ ok: false, error: fromException(target.error) });
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
        if (
          fromCache &&
          (result.code === 'QUERY_INVALID' || result.code === 'QUERY_SCHEMA_CHANGED')
        ) {
          await this.cache.forget(data.connectionId, schema.fingerprint, key);
        }
        if (result.code === 'QUERY_SCHEMA_CHANGED') {
          return {
            kind: 'schema_changed',
            error: {
              code: result.code,
              message: result.message,
              retryable: result.retryable,
            },
          };
        }
        if (result.code === 'QUERY_INVALID' && (fromCache || !queryRetried)) {
          if (!fromCache) {
            queryRetried = true;
            feedback = { sql: proposal.sql, reason: QUERY_INVALID_FEEDBACK };
          }
          continue;
        }
        return done(failed(result.code, result.message, result.retryable));
      }
      if (!fromCache) {
        // A failure to cache must not fail an answered question.
        await this.cache
          .save(data.connectionId, schema.fingerprint, key, {
            sql: proposal.sql,
            assumptions: proposal.assumptions,
            explanation: proposal.explanation,
            model,
          })
          .catch(() => undefined);
      }
      const { ok: _ok, ...rows } = result;
      // Labels (row values) appear in the facts, and so in the summary model's prompt, the
      // template, and history, only when the connection's owner allowed rows.
      const rowsAllowed = target.row.sendSampleRowsToLlm;
      const facts = computeFacts(rows, { labels: rowsAllowed });
      await context.report('summarizing');
      const summary = await this.summarize(
        data.question,
        facts,
        // Rows reach the model only when the connection's owner allowed it.
        rowsAllowed ? rows.rows.slice(0, SUMMARY_SAMPLE_ROWS) : null,
        attempts,
        context,
      );
      return done({
        ok: true,
        result: {
          ...common,
          status: 'answered',
          sql: check.sql,
          assumptions: proposal.assumptions,
          explanation: proposal.explanation,
          ...rows,
          schemaVersion: check.schemaVersion,
          chart: selectChart(rows),
          facts,
          summary,
        },
      });
    }
  }

  /**
   * The grounded summary (blueprint 9.9). The model sees the question, the server's facts,
   * and rows only when allowed. Its summary is kept only if every number in it appears in
   * what it was shown; otherwise, or when the model fails, a template built from the facts
   * is used. A summary never fails an answered question.
   */
  private async summarize(
    question: string,
    facts: ResultFacts,
    sample: unknown[][] | null,
    attempts: LlmAttempt[],
    context: JobContext,
  ): Promise<{ text: string; source: 'model' | 'template' }> {
    const template = { text: templateSummary(facts), source: 'template' as const };
    if (facts.rowCount === 0) {
      return template;
    }
    try {
      const result = await this.llm.generateObject(
        {
          purpose: 'summary',
          system: SUMMARY_SYSTEM_PROMPT,
          prompt: buildSummaryPrompt({ question, facts, sample }),
          maxOutputTokens: SUMMARY_MAX_TOKENS,
          signal: context.signal,
        },
        SummarySchema,
      );
      attempts.push(...result.attempts);
      const text = result.value.summary.trim();
      return text && summaryIsGrounded(text, facts, sample, question)
        ? { text, source: 'model' }
        : template;
    } catch (error) {
      attempts.push(...((error as { attempts?: LlmAttempt[] }).attempts ?? []));
      if (error instanceof LlmError && error.kind === 'cancelled') {
        context.signal?.throwIfAborted();
      }
      if (error instanceof LlmError) {
        return template;
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

/** Totals for the accounting step: model calls, tokens, and time. */
function withUsage(
  outcome: JobOutcome<AskResult>,
  attempts: LlmAttempt[],
  started: number,
): JobOutcome<AskResult> {
  if (!outcome.ok) {
    return outcome;
  }
  return {
    ok: true,
    result: {
      ...outcome.result,
      usage: {
        llmCalls: attempts.length,
        inputTokens: attempts.reduce((sum, a) => sum + a.inputTokens, 0),
        outputTokens: attempts.reduce((sum, a) => sum + a.outputTokens, 0),
        llmMs: attempts.reduce((sum, a) => sum + a.latencyMs, 0),
        queryMs: outcome.result.status === 'answered' ? outcome.result.durationMs : 0,
        totalMs: Date.now() - started,
        models: [
          ...new Set(attempts.filter((a) => a.outcome === 'ok').map((a) => a.model)),
        ],
        fallbackUsed: attempts.some((a) => a.outcome !== 'ok'),
      },
    },
  };
}

function done(outcome: JobOutcome<AskResult>): Pass {
  return { kind: 'done', outcome };
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
