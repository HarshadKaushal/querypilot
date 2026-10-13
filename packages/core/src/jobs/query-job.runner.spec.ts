import type { ConnectionService } from '../connections/connection.service';
import { AppException, notFound } from '../errors/app.exception';
import type { SqlGuardService } from '../sql-guard/sql-guard.service';
import type { QueryExecutor } from '../user-database/query-executor';
import type { ConnectionJobRunner } from './connection-job.runner';
import type { JobCancellation } from './job-cancellation';
import { JobProcessor } from './job-processor';
import { QueryJobRunner } from './query-job.runner';

const data = { userId: 'u1', connectionId: 'c1', sql: 'SELECT id FROM orders' };
const request = { hostIp: '1.1.1.1' };

function runner(parts: {
  check?: jest.Mock;
  resolveTarget?: jest.Mock;
  run?: jest.Mock;
}) {
  const guard = {
    check:
      parts.check ??
      jest.fn().mockResolvedValue({
        allowed: true,
        sql: 'SELECT orders.id FROM public.orders LIMIT 1001',
        limitApplied: true,
        rowCap: 1000,
        schemaVersion: 4,
      }),
  } as unknown as SqlGuardService;
  const connections = {
    resolveTarget:
      parts.resolveTarget ?? jest.fn().mockResolvedValue({ ok: true, request }),
  } as unknown as ConnectionService;
  const executor = {
    run:
      parts.run ??
      jest.fn().mockResolvedValue({
        ok: true,
        columns: [{ name: 'id', dataTypeId: 23 }],
        rows: [[1], [2]],
        rowCount: 2,
        truncated: false,
        durationMs: 5,
      }),
  } as unknown as QueryExecutor;
  return { run: new QueryJobRunner(guard, connections, executor), guard, executor };
}

describe('QueryJobRunner', () => {
  it('runs the SQL the guard rewrote and returns rows with the schema version', async () => {
    const { run, executor } = runner({});
    await expect(run.run(data)).resolves.toEqual({
      ok: true,
      result: {
        columns: [{ name: 'id', dataTypeId: 23 }],
        rows: [[1], [2]],
        rowCount: 2,
        truncated: false,
        durationMs: 5,
        sql: 'SELECT orders.id FROM public.orders LIMIT 1001',
        schemaVersion: 4,
      },
    });
    expect(executor.run).toHaveBeenCalledWith({
      connectionId: 'c1',
      target: request,
      sql: 'SELECT orders.id FROM public.orders LIMIT 1001',
    });
  });

  it('stops at a guard rejection, with its reason, and never reaches the database', async () => {
    const check = jest.fn().mockResolvedValue({
      allowed: false,
      code: 'writes_data',
      reason: 'Only SELECT is allowed.',
      schemaVersion: 4,
    });
    const resolveTarget = jest.fn();
    const { run, executor } = runner({ check, resolveTarget });
    await expect(run.run(data)).resolves.toEqual({
      ok: false,
      error: {
        code: 'SQL_REJECTED',
        message: 'Only SELECT is allowed.',
        retryable: true,
        detail: { guardCode: 'writes_data' },
      },
    });
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('returns the code of a connection that cannot be reached', async () => {
    const blocked = new AppException('SSRF_BLOCKED', 'That address is not allowed.', 400);
    const { run } = runner({
      resolveTarget: jest.fn().mockResolvedValue({ ok: false, error: blocked }),
    });
    await expect(run.run(data)).resolves.toEqual({
      ok: false,
      error: {
        code: 'SSRF_BLOCKED',
        message: 'That address is not allowed.',
        retryable: false,
      },
    });
  });

  it('passes an execution failure through with its retry hint', async () => {
    const { run } = runner({
      run: jest.fn().mockResolvedValue({
        ok: false,
        code: 'QUERY_TIMEOUT',
        message: 'The query ran too long.',
        retryable: false,
      }),
    });
    await expect(run.run(data)).resolves.toMatchObject({
      ok: false,
      error: { code: 'QUERY_TIMEOUT', retryable: false },
    });
  });

  it('turns NOT_FOUND (not your connection) into an outcome, not a crash', async () => {
    const { run } = runner({ check: jest.fn().mockRejectedValue(notFound()) });
    await expect(run.run(data)).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('lets an unexpected error escape, so BullMQ marks the job failed', async () => {
    const { run } = runner({ check: jest.fn().mockRejectedValue(new Error('db down')) });
    await expect(run.run(data)).rejects.toThrow('db down');
  });
});

describe('JobProcessor', () => {
  it('sends query.run to the query runner and refuses unknown kinds', async () => {
    const { run } = runner({});
    const processor = new JobProcessor(
      run,
      {} as ConnectionJobRunner,
      {} as JobCancellation,
    );
    await expect(processor.process('query.run', data)).resolves.toMatchObject({
      ok: true,
    });
    await expect(processor.process('drop.everything', {})).rejects.toThrow(
      'Unknown job kind',
    );
  });
});
