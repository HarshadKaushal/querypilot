import type { AskJobRunner } from '../ask/ask-job.runner';
import type { ConnectionJobRunner } from '../jobs/connection-job.runner';
import type { JobCancellation } from '../jobs/job-cancellation';
import { JobProcessor, type RunnableJob } from '../jobs/job-processor';
import type { QueryJobRunner } from '../jobs/query-job.runner';
import {
  decodeCursor,
  encodeCursor,
  historyEntryFor,
  type QueryHistory,
} from './query-history.repository';

const createdAt = new Date('2026-10-14T10:00:00.000Z');
const ask = { userId: 'u1', connectionId: 'c1', question: 'How many orders?' };

const answered = {
  status: 'answered',
  question: 'How many orders?',
  sql: 'SELECT count(*) FROM public.orders LIMIT 1001',
  assumptions: [],
  explanation: 'Counts orders.',
  columns: [{ name: 'count', dataTypeId: 20 }],
  rows: [['12']],
  rowCount: 1,
  truncated: false,
  durationMs: 9,
  schemaVersion: 2,
  model: 'gemini-3.8-flash',
  llmAttempts: [],
  cached: true,
  schemaRefreshed: false,
  chart: { type: 'stat' },
  facts: { rowCount: 1, truncated: false, columns: ['count'], numeric: [], top: [] },
  summary: { text: 'There are 12 orders.', source: 'model' },
  usage: {
    llmCalls: 2,
    inputTokens: 1200,
    outputTokens: 80,
    llmMs: 900,
    queryMs: 9,
    totalMs: 1100,
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    fallbackUsed: false,
  },
};

describe('historyEntryFor', () => {
  it('records an answered question with its SQL, cost, and summary, and no rows', () => {
    const entry = historyEntryFor({
      id: 'j1',
      kind: 'question.ask',
      data: ask,
      createdAt,
      outcome: { ok: true, result: answered },
    });
    expect(entry).toEqual({
      id: 'j1',
      userId: 'u1',
      connectionId: 'c1',
      kind: 'question',
      question: 'How many orders?',
      sql: 'SELECT count(*) FROM public.orders LIMIT 1001',
      status: 'answered',
      errorCode: null,
      rowCount: 1,
      truncated: null,
      schemaVersion: 2,
      cached: true,
      summary: 'There are 12 orders.',
      models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
      inputTokens: 1200,
      outputTokens: 80,
      llmMs: 900,
      queryMs: 9,
      totalMs: 1100,
      createdAt,
    });
    expect(JSON.stringify(entry)).not.toContain('"12"]');
  });

  it('records an ambiguous question with its explanation and no SQL', () => {
    const entry = historyEntryFor({
      id: 'j2',
      kind: 'question.ask',
      data: ask,
      createdAt,
      outcome: {
        ok: true,
        result: {
          status: 'ambiguous',
          question: 'q',
          clarifyingQuestion: 'Which year?',
          assumptions: [],
          explanation: 'It could mean any year.',
          schemaVersion: 2,
          model: 'm',
          llmAttempts: [],
          cached: false,
          schemaRefreshed: false,
        },
      },
    });
    expect(entry).toMatchObject({
      status: 'ambiguous',
      sql: null,
      summary: 'It could mean any year.',
    });
  });

  it('records failures and cancellations with their codes', () => {
    const failed = historyEntryFor({
      id: 'j3',
      kind: 'question.ask',
      data: ask,
      createdAt,
      outcome: {
        ok: false,
        error: { code: 'SQL_REJECTED', message: 'm', retryable: false },
      },
    });
    expect(failed).toMatchObject({
      status: 'failed',
      errorCode: 'SQL_REJECTED',
      sql: null,
    });
    const cancelled = historyEntryFor({
      id: 'j4',
      kind: 'question.ask',
      data: ask,
      createdAt,
      outcome: {
        ok: false,
        error: { code: 'JOB_CANCELLED', message: 'm', retryable: true },
      },
    });
    expect(cancelled).toMatchObject({ status: 'cancelled', errorCode: 'JOB_CANCELLED' });
  });

  it('records raw SQL jobs with the rewritten SQL that ran', () => {
    const entry = historyEntryFor({
      id: 'j5',
      kind: 'query.run',
      data: { userId: 'u1', connectionId: 'c1', sql: 'select 1' },
      createdAt,
      outcome: {
        ok: true,
        result: {
          columns: [],
          rows: [[1]],
          rowCount: 1,
          truncated: 'rows',
          durationMs: 4,
          sql: 'SELECT 1 LIMIT 1001',
          schemaVersion: 2,
        },
      },
    });
    expect(entry).toMatchObject({
      kind: 'sql',
      question: null,
      sql: 'SELECT 1 LIMIT 1001',
      truncated: 'rows',
      queryMs: 4,
    });
  });

  it('keeps no history for connection and schema jobs', () => {
    expect(
      historyEntryFor({
        id: 'j6',
        kind: 'connection.test',
        data: {},
        createdAt,
        outcome: { ok: true, result: {} },
      }),
    ).toBeNull();
  });
});

describe('history cursors', () => {
  it('round-trips the time and id, and rejects garbage', () => {
    const cursor = encodeCursor(createdAt, 'j1');
    expect(decodeCursor(cursor)).toEqual({ createdAt, id: 'j1' });
    expect(decodeCursor('not-a-cursor')).toBeNull();
  });
});

describe('JobProcessor history', () => {
  function processor(history: Partial<QueryHistory>, run: () => Promise<unknown>) {
    return new JobProcessor(
      {} as QueryJobRunner,
      {} as ConnectionJobRunner,
      { requested: async () => false } as unknown as JobCancellation,
      { run } as unknown as AskJobRunner,
      history as QueryHistory,
    );
  }
  function job(): RunnableJob {
    return {
      id: 'j1',
      name: 'question.ask',
      data: ask,
      timestamp: createdAt.getTime(),
      updateData: jest.fn(),
      updateProgress: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('records the finished job', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    await processor({ record }, async () => ({ ok: true, result: answered })).handle(
      job(),
      {
        onSideError: jest.fn(),
      },
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'j1', status: 'answered', createdAt }),
    );
  });

  it('reports a failed history write without failing the job', async () => {
    const onSideError = jest.fn();
    const outcome = await processor(
      { record: jest.fn().mockRejectedValue(new Error('db down')) },
      async () => ({ ok: true, result: answered }),
    ).handle(job(), { onSideError });
    expect(outcome).toMatchObject({ ok: true });
    expect(onSideError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('records a job given up after its last crash as failed', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    await processor({ record }, async () => ({})).recordGivenUp(job());
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorCode: 'INTERNAL_ERROR' }),
    );
  });
});
