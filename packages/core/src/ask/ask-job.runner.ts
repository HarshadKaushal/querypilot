import { Inject, Injectable } from '@nestjs/common';
import type { StoredConnection } from '../connections/connection.repository';
import { ConnectionService } from '../connections/connection.service';
import { AppException } from '../errors/app.exception';
import { executionFailure, fromException, llmFailure } from '../jobs/job-errors';
import {
  NO_JOB_CONTEXT,
  type AskCommon,
  type AskJobData,
  type AskResult,
  type JobContext,
  type JobError,
  type JobOutcome,
} from '../jobs/job.types';
import { runCheckedSql } from '../jobs/run-checked-sql';
import { attemptsOf, LlmClient } from '../llm/llm-client';
import { LlmError, type LlmAttempt } from '../llm/llm.types';
import { SchemaService, type SchemaView } from '../schema/schema.service';
import { SqlGuardService, type SqlCheckResult } from '../sql-guard/sql-guard.service';
import type { ExecutionFailure } from '../user-database/query-error';
import { QueryExecutor, type ExecutionSuccess } from '../user-database/query-executor';
import {
  buildPrompt,
  selectTables,
  SQL_SYSTEM_PROMPT,
  type ProposalFeedback,
} from './prompt';
import { selectChart } from './chart';
import { computeFacts, type ResultFacts } from './facts';
import {
  PROPOSAL_CACHE,
  questionKey,
  type CachedProposal,
  type ProposalCache,
} from './proposal-cache';
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

/** After a failed try: stop with this pass, or try again with a new proposal. */
type Next = Pass | 'retry';

/** Where this question's proposal is cached: the connection, schema, and question. */
interface CacheKey {
  connectionId: string;
  fingerprint: string;
  question: string;
}

/** What answer() remembers between tries at one question. The helpers update it. */
interface RetryState {
  /** A cached proposal not tried yet. It gets one try; after that the model is asked. */
  cached: CachedProposal | null;
  /** Why the last proposal failed, sent to the model with the next request. */
  feedback?: ProposalFeedback;
  /** Rewrites asked for after the guard rejected the model's SQL. */
  guardRetries: number;
  /** True once the one rewrite after PostgreSQL rejected the model's SQL is used. */
  queryRetried: boolean;
}

/** One proposal to try, and where it came from. */
interface Candidate {
  proposal: SqlProposal;
  model: string;
  fromCache: boolean;
}

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

  /**
   * One pass at the question against this schema. Each loop tries one proposal: get it
   * (cache, then model), check it with the guard, and run it. A failure either ends the
   * pass or, within the retry limits, loops with a new proposal.
   */
  private async answer(
    data: AskJobData,
    schema: SchemaView,
    refreshed: boolean,
    attempts: LlmAttempt[],
    context: JobContext,
  ): Promise<Pass> {
    const cacheKey: CacheKey = {
      connectionId: data.connectionId,
      fingerprint: schema.fingerprint,
      question: questionKey(data.question),
    };
    const shown = selectTables(schema.tables, data.question);
    const state: RetryState = {
      cached: await this.cache.find(
        cacheKey.connectionId,
        cacheKey.fingerprint,
        cacheKey.question,
      ),
      guardRetries: 0,
      queryRetried: false,
    };

    for (;;) {
      // 1. Get a proposal.
      const candidate = await this.nextProposal(
        data.question,
        shown,
        state,
        attempts,
        context,
      );
      const common: AskCommon = {
        question: data.question,
        schemaVersion: schema.version,
        model: candidate.model,
        llmAttempts: attempts,
        cached: candidate.fromCache,
        schemaRefreshed: refreshed,
      };
      if (candidate.proposal.status !== 'ok') {
        return done({ ok: true, result: notAnswerable(candidate.proposal, common) });
      }

      // 2. Check it with the guard.
      await context.report('checking_sql');
      const check = await this.guard.check(
        data.userId,
        data.connectionId,
        candidate.proposal.sql,
      );
      if (!check.allowed) {
        const next = await this.onGuardRejected(check, candidate, state, cacheKey);
        if (next === 'retry') {
          continue;
        }
        return next;
      }

      // 3. Run it.
      const run = await runCheckedSql(
        { connections: this.connections, executor: this.executor },
        { userId: data.userId, connectionId: data.connectionId, sql: check.sql },
        context,
      );
      if (!run.ran) {
        return done({ ok: false, error: run.error });
      }
      if (!run.result.ok) {
        const next = await this.onQueryFailed(run.result, candidate, state, cacheKey);
        if (next === 'retry') {
          continue;
        }
        return next;
      }

      // 4. Build the answer.
      return done(
        await this.buildAnswer(
          {
            question: data.question,
            candidate,
            common,
            check,
            result: run.result,
            connection: run.connection,
            cacheKey,
          },
          attempts,
          context,
        ),
      );
    }
  }

  /** The cached proposal, the first time round; after that, a new one from the model. */
  private async nextProposal(
    question: string,
    shown: ReturnType<typeof selectTables>,
    state: RetryState,
    attempts: LlmAttempt[],
    context: JobContext,
  ): Promise<Candidate> {
    const cached = state.cached;
    if (cached) {
      state.cached = null;
      return {
        proposal: {
          status: 'ok',
          sql: cached.sql,
          assumptions: cached.assumptions,
          clarifyingQuestion: '',
          explanation: cached.explanation,
        },
        model: cached.model,
        fromCache: true,
      };
    }
    await context.report('generating_sql');
    const proposal = await this.propose(
      question,
      shown,
      state.feedback,
      attempts,
      context,
    );
    return { proposal, model: attempts.at(-1)?.model ?? '', fromCache: false };
  }

  /**
   * The guard refused the SQL. A cached proposal is dropped and the model asked instead;
   * the model's own SQL is sent back with the guard's reason, up to MAX_GUARD_RETRIES times.
   */
  private async onGuardRejected(
    check: Extract<SqlCheckResult, { allowed: false }>,
    candidate: Candidate,
    state: RetryState,
    cacheKey: CacheKey,
  ): Promise<Next> {
    if (candidate.fromCache) {
      await this.forgetCached(cacheKey);
      return 'retry';
    }
    if (state.guardRetries < MAX_GUARD_RETRIES) {
      state.guardRetries += 1;
      state.feedback = { sql: candidate.proposal.sql, reason: check.reason };
      return 'retry';
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

  /**
   * PostgreSQL could not run the SQL. A cached proposal that no longer runs is dropped. A
   * changed schema ends the pass, so run() can refresh it. An invalid query gets one rewrite
   * from the model (a cached one goes straight to the model). Anything else is final.
   */
  private async onQueryFailed(
    failure: ExecutionFailure,
    candidate: Candidate,
    state: RetryState,
    cacheKey: CacheKey,
  ): Promise<Next> {
    const { code } = failure;
    if (
      candidate.fromCache &&
      (code === 'QUERY_INVALID' || code === 'QUERY_SCHEMA_CHANGED')
    ) {
      await this.forgetCached(cacheKey);
    }
    if (code === 'QUERY_SCHEMA_CHANGED') {
      return { kind: 'schema_changed', error: executionFailure(failure) };
    }
    if (code === 'QUERY_INVALID') {
      if (candidate.fromCache) {
        return 'retry';
      }
      if (!state.queryRetried) {
        state.queryRetried = true;
        state.feedback = { sql: candidate.proposal.sql, reason: QUERY_INVALID_FEEDBACK };
        return 'retry';
      }
    }
    return done({ ok: false, error: executionFailure(failure) });
  }

  /**
   * The answered result: caches a new proposal, computes the facts, adds the chart, and
   * writes the summary.
   */
  private async buildAnswer(
    answered: {
      question: string;
      candidate: Candidate;
      common: AskCommon;
      check: Extract<SqlCheckResult, { allowed: true }>;
      result: ExecutionSuccess;
      connection: StoredConnection;
      cacheKey: CacheKey;
    },
    attempts: LlmAttempt[],
    context: JobContext,
  ): Promise<JobOutcome<AskResult>> {
    const { question, candidate, common, check, connection, cacheKey } = answered;
    const { proposal } = candidate;
    if (!candidate.fromCache) {
      // A failure to cache must not fail an answered question.
      await this.cache
        .save(cacheKey.connectionId, cacheKey.fingerprint, cacheKey.question, {
          sql: proposal.sql,
          assumptions: proposal.assumptions,
          explanation: proposal.explanation,
          model: candidate.model,
        })
        .catch(() => undefined);
    }
    const { ok: _ok, ...rows } = answered.result;
    // Labels (row values) appear in the facts, and so in the summary model's prompt, the
    // template, and history, only when the connection's owner allowed rows.
    const rowsAllowed = connection.sendSampleRowsToLlm;
    const facts = computeFacts(rows, { labels: rowsAllowed });
    await context.report('summarizing');
    const summary = await this.summarize(
      question,
      facts,
      // Rows reach the model only when the connection's owner allowed it.
      rowsAllowed ? rows.rows.slice(0, SUMMARY_SAMPLE_ROWS) : null,
      attempts,
      context,
    );
    return {
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
    };
  }

  private async forgetCached(cacheKey: CacheKey): Promise<void> {
    await this.cache.forget(
      cacheKey.connectionId,
      cacheKey.fingerprint,
      cacheKey.question,
    );
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
      attempts.push(...attemptsOf(error));
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
      attempts.push(...attemptsOf(error));
      if (error instanceof LlmError && error.kind === 'cancelled') {
        // The processor turns the aborted signal into a cancelled outcome.
        context.signal?.throwIfAborted();
      }
      throw error;
    }
  }
}

/** The result for a question that stops before any SQL runs. */
function notAnswerable(proposal: SqlProposal, common: AskCommon): AskResult {
  return proposal.status === 'ambiguous'
    ? {
        ...common,
        status: 'ambiguous',
        clarifyingQuestion: proposal.clarifyingQuestion,
        assumptions: proposal.assumptions,
        explanation: proposal.explanation,
      }
    : { ...common, status: 'unanswerable', explanation: proposal.explanation };
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
