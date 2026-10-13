import { Logger } from 'nestjs-pino';
import { testEnv } from '../testing/test-env';
import {
  ConnectionPools,
  MAX_POOLS,
  type PoolClientLike,
  type PoolFactory,
  type PoolLike,
  RESULT_TYPES,
} from './connection-pools';
import { MemoryCoordination } from '../testing/memory-coordination';
import { breakerKey, semaphoreKey } from './coordination';
import { QueryExecutor } from './query-executor';
import type { ProbeRequest } from './user-database.probe';

const target: ProbeRequest = {
  hostIp: '203.0.113.7',
  port: 5432,
  database: 'sample',
  username: 'sample_ro',
  password: 'sample_ro_password',
  sslMode: 'require',
  servername: 'db.example',
};

function env(overrides: Record<string, string> = {}) {
  return testEnv({
    EXECUTOR_QUEUE_WAIT_MS: '0',
    ...overrides,
  });
}

const logger = { warn: jest.fn() } as unknown as Logger;

/** A fake database that serves `rows` through the cursor and records every statement. */
function fakeDatabase(
  options: { rows?: unknown[][]; failOn?: string; connectError?: Error } = {},
) {
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  const releases: Array<boolean | undefined> = [];
  const pools: PoolLike[] = [];
  let served = 0;
  const factory: PoolFactory = () => {
    const pool: PoolLike = {
      connect: async () => {
        if (options.connectError) {
          throw options.connectError;
        }
        const client: PoolClientLike = {
          query: async (config) => {
            const statement = typeof config === 'string' ? { text: config } : config;
            statements.push(statement);
            if (options.failOn && statement.text.startsWith(options.failOn)) {
              throw Object.assign(new Error('syntax error at or near "secret"'), {
                code: '42601',
              });
            }
            const fetch = /^FETCH FORWARD (\d+)/.exec(statement.text);
            if (fetch) {
              const all = options.rows ?? [];
              const batch = all.slice(served, served + Number(fetch[1]));
              served += batch.length;
              return { rows: batch, fields: [{ name: 'n', dataTypeID: 23 }] };
            }
            return { rows: [] };
          },
          release: (destroy) => releases.push(destroy),
        };
        return client;
      },
      end: jest.fn(async () => undefined),
      on: () => undefined,
    };
    pools.push(pool);
    return pool;
  };
  return { factory, statements, releases, pools };
}

function executor(
  database: ReturnType<typeof fakeDatabase>,
  overrides: Record<string, string> = {},
  coordination = new MemoryCoordination(),
) {
  const config = env(overrides);
  const pools = new ConnectionPools(config, logger, database.factory);
  return {
    executor: new QueryExecutor(config, pools, coordination, logger),
    coordination,
    pools,
  };
}

const rows = (count: number) => Array.from({ length: count }, (_, i) => [i + 1]);

describe('QueryExecutor', () => {
  it('runs the query read-only, with a timeout and an empty search_path, then rolls back', async () => {
    const database = fakeDatabase({ rows: rows(3) });
    const { executor: run } = executor(database);
    const result = await run.run({
      connectionId: 'c1',
      target,
      sql: 'SELECT n FROM public.t',
    });
    expect(result).toMatchObject({
      ok: true,
      rowCount: 3,
      truncated: false,
      rows: rows(3),
    });
    expect(result.ok && result.columns).toEqual([{ name: 'n', dataTypeId: 23 }]);
    const texts = database.statements.map((s) => s.text);
    expect(texts.slice(0, 4)).toEqual([
      'BEGIN READ ONLY',
      'SET LOCAL statement_timeout = 15000',
      "SET LOCAL search_path = ''",
      'DECLARE ayd_result NO SCROLL CURSOR FOR SELECT n FROM public.t',
    ]);
    expect(texts[texts.length - 1]).toBe('ROLLBACK');
    expect(texts).not.toContain('COMMIT');
    // The extended protocol accepts a single statement only. An empty values list is not
    // enough: pg then falls back to the simple protocol, which runs several.
    expect(database.statements[3]).toMatchObject({ queryMode: 'extended' });
    expect(database.releases).toEqual([false]);
  });

  it('stops at the row cap and marks the result cut', async () => {
    const database = fakeDatabase({ rows: rows(250) });
    const result = await executor(database).executor.run({
      connectionId: 'c1',
      target,
      sql: 'SELECT n FROM public.t',
      rowCap: 120,
    });
    expect(result).toMatchObject({ ok: true, rowCount: 120, truncated: 'rows' });
  });

  it('stops at the size cap and marks the result cut', async () => {
    const big = Array.from({ length: 10 }, () => ['x'.repeat(500)]);
    const result = await executor(fakeDatabase({ rows: big }), {
      EXECUTOR_MAX_RESULT_BYTES: '2048',
    }).executor.run({ connectionId: 'c1', target, sql: 'SELECT s FROM public.t' });
    expect(result).toMatchObject({ ok: true, truncated: 'size' });
    expect(result.ok && result.rowCount).toBeLessThan(10);
  });

  it('returns exactly the cap as complete when no extra row comes back', async () => {
    // The guard writes LIMIT rowCap + 1, so a table with exactly rowCap matches is not cut.
    const result = await executor(fakeDatabase({ rows: rows(5) })).executor.run({
      connectionId: 'c1',
      target,
      sql: 'SELECT n FROM public.t LIMIT 6',
      rowCap: 5,
    });
    expect(result).toMatchObject({ ok: true, rowCount: 5, truncated: false });
  });

  it('marks the result cut when the extra row comes back, and does not return it', async () => {
    const result = await executor(fakeDatabase({ rows: rows(6) })).executor.run({
      connectionId: 'c1',
      target,
      sql: 'SELECT n FROM public.t LIMIT 6',
      rowCap: 5,
    });
    expect(result).toMatchObject({ ok: true, rowCount: 5, truncated: 'rows' });
  });

  it('maps a query error, discards the socket, and frees the slot', async () => {
    const database = fakeDatabase({ failOn: 'DECLARE' });
    const { executor: run, coordination } = executor(database);
    const result = await run.run({
      connectionId: 'c1',
      target,
      sql: 'SELECT secret FROM public.t',
    });
    expect(result).toEqual({
      ok: false,
      code: 'QUERY_INVALID',
      message: 'The database could not run this query as written.',
      retryable: true,
    });
    expect(database.releases).toEqual([true]);
    expect(coordination.held(semaphoreKey('c1'))).toBe(0);
  });

  it('answers busy when every slot for the connection is taken', async () => {
    const coordination = new MemoryCoordination();
    await coordination.tryAcquire(semaphoreKey('c1'), 2, 60000, 'a');
    await coordination.tryAcquire(semaphoreKey('c1'), 2, 60000, 'b');
    const database = fakeDatabase({ rows: rows(1) });
    const result = await executor(database, {}, coordination).executor.run({
      connectionId: 'c1',
      target,
      sql: 'SELECT 1',
    });
    expect(result).toMatchObject({ ok: false, code: 'CONNECTION_BUSY', retryable: true });
    expect(database.statements).toHaveLength(0);
  });

  it('pauses a connection after repeated connection failures, without connecting', async () => {
    const database = fakeDatabase({
      connectError: Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    });
    const { executor: run } = executor(database, { EXECUTOR_BREAKER_FAILURES: '3' });
    for (let i = 0; i < 3; i++) {
      expect(
        await run.run({ connectionId: 'c1', target, sql: 'SELECT 1' }),
      ).toMatchObject({
        code: 'CONNECTION_FAILED',
      });
    }
    const paused = await run.run({ connectionId: 'c1', target, sql: 'SELECT 1' });
    expect(paused).toMatchObject({ ok: false, code: 'CONNECTION_PAUSED' });
    expect(paused.ok === false && paused.message).toContain('60 seconds');
  });

  it('resets the failure count after a success', async () => {
    const coordination = new MemoryCoordination();
    await coordination.recordFailure(breakerKey('c1'), 3, 60000);
    await coordination.recordFailure(breakerKey('c1'), 3, 60000);
    const ok = executor(fakeDatabase({ rows: rows(1) }), {}, coordination).executor;
    await ok.run({ connectionId: 'c1', target, sql: 'SELECT 1' });
    // Two more failures would have paused it without the reset.
    expect(await coordination.recordFailure(breakerKey('c1'), 3, 60000)).toBe(false);
    expect(await coordination.recordFailure(breakerKey('c1'), 3, 60000)).toBe(false);
  });

  it('does not count a mistake in the query toward pausing the connection', async () => {
    const coordination = new MemoryCoordination();
    const { executor: run } = executor(
      fakeDatabase({ failOn: 'DECLARE' }),
      { EXECUTOR_BREAKER_FAILURES: '2' },
      coordination,
    );
    for (let i = 0; i < 3; i++) {
      await run.run({ connectionId: 'c1', target, sql: 'SELECT secret FROM public.t' });
    }
    expect(await coordination.pausedFor(breakerKey('c1'))).toBe(0);
  });
});

describe('ConnectionPools', () => {
  it('reuses a pool, and replaces it when the target changes', async () => {
    const database = fakeDatabase();
    const pools = new ConnectionPools(env(), logger, database.factory);
    const first = pools.get('c1', target);
    expect(pools.get('c1', target)).toBe(first);
    const second = pools.get('c1', { ...target, password: 'rotated' });
    expect(second).not.toBe(first);
    expect(first.end).toHaveBeenCalled();
  });

  it('closes a pool on evict and the oldest past the limit', async () => {
    const database = fakeDatabase();
    const pools = new ConnectionPools(env(), logger, database.factory);
    const evicted = pools.get('c1', target);
    pools.evict('c1');
    expect(evicted.end).toHaveBeenCalled();
    for (let i = 0; i <= MAX_POOLS; i++) {
      pools.get(`conn-${i}`, target);
    }
    expect(pools.size()).toBe(MAX_POOLS);
    expect(database.pools[1]?.end).toHaveBeenCalled();
    await pools.onModuleDestroy();
    expect(pools.size()).toBe(0);
  });

  it('keeps dates and times as PostgreSQL writes them', () => {
    expect(RESULT_TYPES.getTypeParser(1082, 'text')('2025-08-06')).toBe('2025-08-06');
    expect(RESULT_TYPES.getTypeParser(1114, 'text')('2025-08-06 10:00:00')).toBe(
      '2025-08-06 10:00:00',
    );
    // Other types keep pg's parsers: int4 becomes a number.
    expect(RESULT_TYPES.getTypeParser(23, 'text')('42')).toBe(42);
  });
});
