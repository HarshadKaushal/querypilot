import type { ConnectionService } from '../connections/connection.service';
import { AppException } from '../errors/app.exception';
import type { JobContext } from '../jobs/job.types';
import { LlmClient } from '../llm/llm-client';
import { LlmError } from '../llm/llm.types';
import type { SchemaService, SchemaView } from '../schema/schema.service';
import type { SqlGuardService } from '../sql-guard/sql-guard.service';
import { FakeLlmProvider } from '../testing/fake-llm-provider';
import { MemoryProposalCache } from '../testing/memory-proposal-cache';
import type { QueryExecutor } from '../user-database/query-executor';
import { AskJobRunner } from './ask-job.runner';

const data = { userId: 'u1', connectionId: 'c1', question: 'How many orders are open?' };

const schemaView: SchemaView = {
  connectionId: 'c1',
  version: 3,
  createdAt: '2026-10-14T00:00:00.000Z',
  fingerprint: 'f',
  tables: [
    {
      schema: 'public',
      name: 'orders',
      kind: 'table',
      description: null,
      columns: [
        { name: 'id', type: 'integer', nullable: false, description: null },
        { name: 'status', type: 'text', nullable: false, description: null },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    },
  ],
};

function proposal(fields: Record<string, unknown>) {
  return {
    text: JSON.stringify({
      status: 'ok',
      sql: '',
      assumptions: [],
      clarifyingQuestion: '',
      explanation: 'Counts open orders.',
      ...fields,
    }),
  };
}

const ROWS = {
  ok: true,
  columns: [{ name: 'open_orders', dataTypeId: 20 }],
  rows: [['4']],
  rowCount: 1,
  truncated: false,
  durationMs: 7,
};

function setup(options: {
  model?: FakeLlmProvider;
  fallback?: FakeLlmProvider;
  check?: jest.Mock;
  run?: jest.Mock;
  schema?: jest.Mock;
  refresh?: jest.Mock;
  cache?: MemoryProposalCache;
}) {
  const cache = options.cache ?? new MemoryProposalCache();
  const model = options.model ?? new FakeLlmProvider('primary');
  const schemas = {
    schema: options.schema ?? jest.fn().mockResolvedValue(schemaView),
    refresh: options.refresh ?? jest.fn().mockResolvedValue({ version: 4 }),
  } as unknown as SchemaService;
  const guard = {
    check:
      options.check ??
      jest.fn(async (_u: string, _c: string, sql: string) => ({
        allowed: true,
        sql: `${sql} LIMIT 1001`,
        limitApplied: true,
        rowCap: 1000,
        schemaVersion: 3,
      })),
  } as unknown as SqlGuardService;
  const connections = {
    resolveTarget: jest
      .fn()
      .mockResolvedValue({ ok: true, request: { hostIp: '1.1.1.1' } }),
  } as unknown as ConnectionService;
  const executor = {
    run: options.run ?? jest.fn().mockResolvedValue(ROWS),
  } as unknown as QueryExecutor;
  const providers = options.fallback ? [model, options.fallback] : [model];
  const runner = new AskJobRunner(
    schemas,
    guard,
    connections,
    executor,
    new LlmClient(providers),
    cache,
  );
  const stages: string[] = [];
  const context: JobContext = { report: async (stage) => void stages.push(stage) };
  return { runner, model, guard, executor, stages, context, cache, schemas };
}

const OPEN_SQL =
  "SELECT count(*) AS open_orders FROM public.orders WHERE status = 'open'";

describe('AskJobRunner', () => {
  it('turns a question into checked SQL, runs it, and reports each stage', async () => {
    const model = new FakeLlmProvider('primary', [
      proposal({ sql: OPEN_SQL, assumptions: ['"Open" means status = open'] }),
    ]);
    const { runner, executor, stages, context } = setup({ model });
    const outcome = await runner.run(data, context);
    expect(outcome).toMatchObject({
      ok: true,
      result: {
        status: 'answered',
        question: data.question,
        sql: `${OPEN_SQL} LIMIT 1001`,
        assumptions: ['"Open" means status = open'],
        explanation: 'Counts open orders.',
        rows: [['4']],
        rowCount: 1,
        schemaVersion: 3,
        model: 'primary',
      },
    });
    expect(executor.run).toHaveBeenCalledWith(
      expect.objectContaining({ sql: `${OPEN_SQL} LIMIT 1001` }),
    );
    expect(stages).toEqual([
      'loading_schema',
      'generating_sql',
      'checking_sql',
      'connecting',
      'running_query',
    ]);
  });

  it('shows the model only the allowed schema and the question', async () => {
    const model = new FakeLlmProvider('primary', [proposal({ sql: OPEN_SQL })]);
    const { runner } = setup({ model });
    await runner.run(data);
    const sent = model.requests[0]!;
    expect(sent.purpose).toBe('sql_proposal');
    expect(sent.prompt).toContain('Table public.orders');
    expect(sent.prompt).toContain('<question>\nHow many orders are open?\n</question>');
    expect(sent.system).toContain('exactly one SELECT');
  });

  it('stops before running anything for an ambiguous question', async () => {
    const model = new FakeLlmProvider('primary', [
      proposal({
        status: 'ambiguous',
        clarifyingQuestion: 'Do you mean open this month or ever?',
        assumptions: [],
      }),
    ]);
    const { runner, executor, guard } = setup({ model });
    await expect(runner.run(data)).resolves.toMatchObject({
      ok: true,
      result: {
        status: 'ambiguous',
        clarifyingQuestion: 'Do you mean open this month or ever?',
      },
    });
    expect(guard.check).not.toHaveBeenCalled();
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('stops before running anything for an unanswerable question', async () => {
    const model = new FakeLlmProvider('primary', [
      proposal({
        status: 'unanswerable',
        explanation: 'There is no data about refunds.',
      }),
    ]);
    const { runner, executor } = setup({ model });
    await expect(runner.run(data)).resolves.toMatchObject({
      ok: true,
      result: { status: 'unanswerable', explanation: 'There is no data about refunds.' },
    });
    expect(executor.run).not.toHaveBeenCalled();
  });

  it("sends a guard rejection back to the model with the guard's reason, and runs the fix", async () => {
    const model = new FakeLlmProvider('primary', [
      proposal({ sql: 'SELECT secret FROM public.orders' }),
      proposal({ sql: OPEN_SQL }),
    ]);
    const check = jest
      .fn()
      .mockResolvedValueOnce({
        allowed: false,
        code: 'column_not_allowed',
        reason: 'The column public.orders.secret is not allowed.',
        schemaVersion: 3,
      })
      .mockResolvedValueOnce({
        allowed: true,
        sql: OPEN_SQL,
        limitApplied: false,
        rowCap: 1000,
        schemaVersion: 3,
      });
    const { runner } = setup({ model, check });
    await expect(runner.run(data)).resolves.toMatchObject({
      ok: true,
      result: { status: 'answered', sql: OPEN_SQL },
    });
    expect(model.requests[1]?.prompt).toContain('SELECT secret FROM public.orders');
    expect(model.requests[1]?.prompt).toContain(
      'Reason: The column public.orders.secret is not allowed.',
    );
  });

  it('gives up after two rewrites the guard still rejects, without running anything', async () => {
    const model = new FakeLlmProvider('primary', [
      proposal({ sql: 'DELETE FROM public.orders' }),
      proposal({ sql: 'DELETE FROM public.orders' }),
      proposal({ sql: 'DELETE FROM public.orders' }),
    ]);
    const check = jest.fn().mockResolvedValue({
      allowed: false,
      code: 'not_select',
      reason: 'Only SELECT is allowed.',
      schemaVersion: 3,
    });
    const { runner, executor } = setup({ model, check });
    await expect(runner.run(data)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'SQL_REJECTED',
        retryable: false,
        detail: { guardCode: 'not_select' },
      },
    });
    expect(model.requests).toHaveLength(3);
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('gives a query PostgreSQL rejects as invalid one more attempt, with fixed feedback', async () => {
    const model = new FakeLlmProvider('primary', [
      proposal({ sql: 'SELECT status, count(*) FROM public.orders' }),
      proposal({ sql: OPEN_SQL }),
    ]);
    const run = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        code: 'QUERY_INVALID',
        message: 'The database could not run this query as written.',
        retryable: true,
      })
      .mockResolvedValueOnce(ROWS);
    const { runner } = setup({ model, run });
    await expect(runner.run(data)).resolves.toMatchObject({
      ok: true,
      result: { status: 'answered' },
    });
    expect(model.requests[1]?.prompt).toContain('every selected column is grouped');
  });

  it('does not retry a second invalid query, a timeout, or a permission error', async () => {
    const invalid = {
      ok: false,
      code: 'QUERY_INVALID',
      message: 'The database could not run this query as written.',
      retryable: true,
    };
    const twice = setup({
      model: new FakeLlmProvider('primary', [
        proposal({ sql: OPEN_SQL }),
        proposal({ sql: OPEN_SQL }),
      ]),
      run: jest.fn().mockResolvedValue(invalid),
    });
    await expect(twice.runner.run(data)).resolves.toMatchObject({
      ok: false,
      error: { code: 'QUERY_INVALID' },
    });
    expect(twice.model.requests).toHaveLength(2);

    for (const code of ['QUERY_TIMEOUT', 'QUERY_NOT_PERMITTED', 'CONNECTION_FAILED']) {
      const once = setup({
        model: new FakeLlmProvider('primary', [proposal({ sql: OPEN_SQL })]),
        run: jest
          .fn()
          .mockResolvedValue({ ok: false, code, message: 'm', retryable: false }),
      });
      await expect(once.runner.run(data)).resolves.toMatchObject({
        ok: false,
        error: { code },
      });
      expect(once.model.requests).toHaveLength(1);
    }
  });

  it('answers LLM_NOT_CONFIGURED when there is no API key', async () => {
    const model = new FakeLlmProvider('primary', [
      { error: new LlmError('misconfigured', 'GEMINI_API_KEY is not set.', 'primary') },
    ]);
    const { runner } = setup({ model });
    await expect(runner.run(data)).resolves.toMatchObject({
      ok: false,
      error: { code: 'LLM_NOT_CONFIGURED', retryable: false },
    });
  });

  it('answers LLM_UNAVAILABLE when every model fails or answers malformed JSON', async () => {
    const model = new FakeLlmProvider('primary', [
      { error: new LlmError('rate_limited', 'x', 'primary') },
    ]);
    const fallback = new FakeLlmProvider('fallback', [{ text: '{"status":"ok"' }]);
    const { runner } = setup({ model, fallback });
    await expect(runner.run(data)).resolves.toMatchObject({
      ok: false,
      error: { code: 'LLM_UNAVAILABLE', retryable: true },
    });
  });

  it('uses the fallback model when the primary answers in the wrong shape', async () => {
    const model = new FakeLlmProvider('primary', [{ text: '{"sql": 42}' }]);
    const fallback = new FakeLlmProvider('fallback', [proposal({ sql: OPEN_SQL })]);
    const { runner } = setup({ model, fallback });
    const outcome = await runner.run(data);
    expect(outcome).toMatchObject({ ok: true, result: { model: 'fallback' } });
    if (outcome.ok) {
      expect(outcome.result.llmAttempts.map((a) => [a.model, a.outcome])).toEqual([
        ['primary', 'bad_output'],
        ['fallback', 'ok'],
      ]);
    }
  });

  it('passes schema problems through as outcomes', async () => {
    const notReady = new AppException(
      'SCHEMA_NOT_READY',
      'Refresh the schema first.',
      409,
    );
    const { runner } = setup({ schema: jest.fn().mockRejectedValue(notReady) });
    await expect(runner.run(data)).resolves.toMatchObject({
      ok: false,
      error: { code: 'SCHEMA_NOT_READY' },
    });

    const empty = setup({
      schema: jest.fn().mockResolvedValue({ ...schemaView, tables: [] }),
    });
    await expect(empty.runner.run(data)).resolves.toMatchObject({
      ok: false,
      error: { code: 'SCHEMA_NOT_READY', message: expect.stringContaining('allowlist') },
    });
    expect(empty.model.requests).toHaveLength(0);
  });

  it('lets a cancellation during the model call escape, so the processor marks it cancelled', async () => {
    const controller = new AbortController();
    const model = new FakeLlmProvider('primary', [
      () => {
        controller.abort('cancelled by its owner');
        return {
          error: new LlmError('cancelled', 'The model call was cancelled.', 'primary'),
        };
      },
    ]);
    const { runner } = setup({ model });
    await expect(
      runner.run(data, { report: async () => undefined, signal: controller.signal }),
    ).rejects.toBe('cancelled by its owner');
  });
});

describe('AskJobRunner proposal cache', () => {
  it('answers a repeated question from the cache, without the model, still through the guard', async () => {
    const cache = new MemoryProposalCache();
    const first = setup({
      model: new FakeLlmProvider('primary', [proposal({ sql: OPEN_SQL })]),
      cache,
    });
    await expect(first.runner.run(data)).resolves.toMatchObject({
      result: { cached: false },
    });
    expect(cache.entries.size).toBe(1);

    const again = setup({ model: new FakeLlmProvider('primary'), cache });
    const outcome = await again.runner.run({
      ...data,
      question: '  how many ORDERS are open  ',
    });
    expect(outcome).toMatchObject({
      ok: true,
      result: { status: 'answered', cached: true, model: 'primary', rows: [['4']] },
    });
    expect(again.model.requests).toHaveLength(0);
    expect(again.guard.check).toHaveBeenCalledWith('u1', 'c1', OPEN_SQL);
    expect(again.stages).not.toContain('generating_sql');
  });

  it('does not cache ambiguous answers or failures', async () => {
    const cache = new MemoryProposalCache();
    const ambiguous = setup({
      model: new FakeLlmProvider('primary', [
        proposal({ status: 'ambiguous', clarifyingQuestion: 'Which?' }),
      ]),
      cache,
    });
    await ambiguous.runner.run(data);
    const timeout = setup({
      model: new FakeLlmProvider('primary', [proposal({ sql: OPEN_SQL })]),
      run: jest.fn().mockResolvedValue({
        ok: false,
        code: 'QUERY_TIMEOUT',
        message: 'm',
        retryable: false,
      }),
      cache,
    });
    await timeout.runner.run(data);
    expect(cache.entries.size).toBe(0);
  });

  it('drops a cached proposal the guard now rejects, and asks the model instead', async () => {
    const cache = new MemoryProposalCache();
    await setup({
      model: new FakeLlmProvider('primary', [proposal({ sql: OPEN_SQL })]),
      cache,
    }).runner.run(data);
    const check = jest
      .fn()
      .mockResolvedValueOnce({
        allowed: false,
        code: 'column_not_allowed',
        reason: 'Hidden now.',
        schemaVersion: 3,
      })
      .mockResolvedValueOnce({
        allowed: true,
        sql: 'SELECT 1',
        limitApplied: false,
        rowCap: 1000,
        schemaVersion: 3,
      });
    const later = setup({
      model: new FakeLlmProvider('primary', [proposal({ sql: 'SELECT 1' })]),
      check,
      cache,
    });
    await expect(later.runner.run(data)).resolves.toMatchObject({
      result: { cached: false, sql: 'SELECT 1' },
    });
    expect(later.model.requests).toHaveLength(1);
    // The model's feedback is not about the cached SQL: it starts fresh.
    expect(later.model.requests[0]!.prompt).not.toContain('previous query');
  });

  it('drops a cached proposal PostgreSQL rejects as invalid, and asks the model instead', async () => {
    const cache = new MemoryProposalCache();
    await setup({
      model: new FakeLlmProvider('primary', [proposal({ sql: OPEN_SQL })]),
      cache,
    }).runner.run(data);
    const run = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        code: 'QUERY_INVALID',
        message: 'm',
        retryable: true,
      })
      .mockResolvedValueOnce(ROWS);
    const later = setup({
      model: new FakeLlmProvider('primary', [proposal({ sql: OPEN_SQL })]),
      run,
      cache,
    });
    await expect(later.runner.run(data)).resolves.toMatchObject({
      result: { cached: false },
    });
    expect(later.model.requests).toHaveLength(1);
  });
});

describe('AskJobRunner self-healing', () => {
  const changed = {
    ok: false,
    code: 'QUERY_SCHEMA_CHANGED',
    message: 'Refresh the schema and ask again.',
    retryable: false,
  };

  it('refreshes the schema once and answers again when the database has changed', async () => {
    const newer = { ...schemaView, version: 4, fingerprint: 'g' };
    const schema = jest
      .fn()
      .mockResolvedValueOnce(schemaView)
      .mockResolvedValueOnce(newer);
    const run = jest.fn().mockResolvedValueOnce(changed).mockResolvedValueOnce(ROWS);
    const healing = setup({
      model: new FakeLlmProvider('primary', [
        proposal({ sql: OPEN_SQL }),
        proposal({ sql: OPEN_SQL }),
      ]),
      schema,
      run,
    });
    const outcome = await healing.runner.run(data, healing.context);
    expect(outcome).toMatchObject({
      ok: true,
      result: { status: 'answered', schemaRefreshed: true },
    });
    expect(healing.schemas.refresh).toHaveBeenCalledWith('u1', 'c1', null);
    expect(healing.stages).toContain('reading_schema');
    expect(healing.model.requests).toHaveLength(2);
  });

  it('returns QUERY_SCHEMA_CHANGED when the database still disagrees after one refresh', async () => {
    const healing = setup({
      model: new FakeLlmProvider('primary', [
        proposal({ sql: OPEN_SQL }),
        proposal({ sql: OPEN_SQL }),
      ]),
      run: jest.fn().mockResolvedValue(changed),
    });
    await expect(healing.runner.run(data)).resolves.toMatchObject({
      ok: false,
      error: { code: 'QUERY_SCHEMA_CHANGED' },
    });
    expect(healing.schemas.refresh).toHaveBeenCalledTimes(1);
  });

  it('returns the refresh problem when the refresh itself fails', async () => {
    const healing = setup({
      model: new FakeLlmProvider('primary', [proposal({ sql: OPEN_SQL })]),
      run: jest.fn().mockResolvedValue(changed),
      refresh: jest
        .fn()
        .mockRejectedValue(
          new AppException('NOT_READ_ONLY', 'This role can change data.', 400),
        ),
    });
    await expect(healing.runner.run(data)).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_READ_ONLY' },
    });
  });
});
