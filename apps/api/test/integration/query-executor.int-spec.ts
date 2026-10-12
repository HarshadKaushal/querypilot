import { randomUUID } from 'node:crypto';
import type { Logger } from 'nestjs-pino';
import { loadEnv } from '../../src/config/env';
import { ConnectionPools } from '../../src/user-database/connection-pools';
import { RedisCoordination, semaphoreKey } from '../../src/user-database/coordination';
import { QueryExecutor } from '../../src/user-database/query-executor';
import type { ProbeRequest } from '../../src/user-database/user-database.probe';
import { RedisService } from '../../src/redis/redis.service';
import {
  createScratchDatabase,
  plainPools,
  type ScratchDatabase,
} from '../helpers/scratch-database';

// Phase 5 acceptance against real PostgreSQL and Redis. The application Postgres has no
// TLS, so the pool factory turns SSL off. Each "process" below is its own executor with its
// own pools and Redis client, sharing only Redis, as separate workers would.

const logger = { warn: () => undefined } as unknown as Logger;

describe('query executor against PostgreSQL and Redis', () => {
  let db: ScratchDatabase;
  let writer: ProbeRequest;
  const redisClients: RedisService[] = [];
  const poolSets: ConnectionPools[] = [];

  function process(overrides: Record<string, string> = {}) {
    const env = loadEnv({ ...globalThis.process.env, ...overrides });
    const redis = new RedisService(env);
    const pools = new ConnectionPools(env, logger, plainPools);
    redisClients.push(redis);
    poolSets.push(pools);
    return new QueryExecutor(env, pools, new RedisCoordination(redis), logger);
  }

  beforeAll(async () => {
    db = await createScratchDatabase();
    // A login that CAN write, standing in for a guard bypass plus a role misconfiguration.
    const login = await db.createLogin('writer');
    await db.admin.query(`
      CREATE TABLE public.t (id int PRIMARY KEY, note text);
      INSERT INTO public.t SELECT g, 'row ' || g FROM generate_series(1, 50) AS g;
      CREATE SEQUENCE public.s;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.t TO ${login.username};
      GRANT USAGE, UPDATE ON SEQUENCE public.s TO ${login.username};
    `);
    writer = {
      hostIp: db.host,
      port: db.port,
      database: db.name,
      username: login.username,
      password: login.password,
      sslMode: 'require',
      servername: db.host,
    };
  });

  afterAll(async () => {
    await Promise.all(poolSets.map((pools) => pools.onModuleDestroy()));
    await Promise.all(redisClients.map((redis) => redis.onModuleDestroy()));
    await db.drop();
  });

  async function rowCount(): Promise<number> {
    const result = await db.admin.query('SELECT count(*)::int AS n FROM public.t');
    return result.rows[0].n as number;
  }

  it('runs a read inside a READ ONLY transaction with an empty search_path', async () => {
    const result = await process().run({
      connectionId: randomUUID(),
      target: writer,
      sql: "SELECT current_setting('transaction_read_only') AS ro, current_setting('search_path') AS path, count(*) AS n FROM public.t",
    });
    expect(result).toMatchObject({ ok: true, rows: [['on', '""', '50']] });
  });

  it('returns dates, timestamps, and numerics as PostgreSQL writes them', async () => {
    const result = await process().run({
      connectionId: randomUUID(),
      target: writer,
      sql: "SELECT DATE '2025-08-06' AS d, TIMESTAMP '2025-08-06 10:00' AS ts, 12.50::numeric AS amount",
    });
    expect(result).toMatchObject({
      ok: true,
      rows: [['2025-08-06', '2025-08-06 10:00:00', '12.50']],
    });
  });

  it.each([
    ['a sequence write', "SELECT nextval('public.s')", 'QUERY_WRITE_BLOCKED'],
    ['a row lock', 'SELECT id FROM public.t FOR UPDATE', 'QUERY_WRITE_BLOCKED'],
    [
      'a data-modifying WITH',
      'WITH d AS (DELETE FROM public.t RETURNING id) SELECT id FROM d',
      'QUERY_INVALID',
    ],
    [
      'a second statement that commits and deletes',
      'SELECT 1; COMMIT; DELETE FROM public.t',
      'QUERY_INVALID',
    ],
    ['an UPDATE', "UPDATE public.t SET note = 'x'", 'QUERY_INVALID'],
  ])('blocks %s even without the guard', async (_case, sql, code) => {
    const result = await process().run({
      connectionId: randomUUID(),
      target: writer,
      sql,
    });
    expect(result).toMatchObject({ ok: false, code });
    expect(JSON.stringify(result)).not.toMatch(/public\.t|nextval|syntax/);
    expect(await rowCount()).toBe(50);
  });

  it('reports a column the database no longer has as a schema change', async () => {
    const result = await process().run({
      connectionId: randomUUID(),
      target: writer,
      sql: 'SELECT t.dropped_column FROM public.t',
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'QUERY_SCHEMA_CHANGED',
      retryable: false,
    });
  });

  it('stops a query at the statement timeout', async () => {
    const started = Date.now();
    const result = await process({ EXECUTOR_STATEMENT_TIMEOUT_MS: '500' }).run({
      connectionId: randomUUID(),
      target: writer,
      sql: 'SELECT pg_sleep(3)',
    });
    expect(result).toMatchObject({ ok: false, code: 'QUERY_TIMEOUT', retryable: false });
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it('caps rows and result size', async () => {
    const run = process({ EXECUTOR_MAX_RESULT_BYTES: '2048' });
    expect(
      await run.run({
        connectionId: randomUUID(),
        target: writer,
        sql: 'SELECT id FROM public.t',
        rowCap: 10,
      }),
    ).toMatchObject({ ok: true, rowCount: 10, truncated: 'rows' });
    const sized = await run.run({
      connectionId: randomUUID(),
      target: writer,
      sql: "SELECT repeat('x', 500) FROM public.t",
    });
    expect(sized).toMatchObject({ ok: true, truncated: 'size' });
    expect(sized.ok && sized.rowCount).toBeLessThan(5);
  });

  it('holds the concurrency limit across two processes', async () => {
    const connectionId = randomUUID();
    const settings = {
      EXECUTOR_MAX_CONCURRENT_QUERIES: '2',
      EXECUTOR_QUEUE_WAIT_MS: '10000',
    };
    const [a, b] = [process(settings), process(settings)];
    const started = Date.now();
    // Four 0.6 s queries, two per process, with two slots in total: at least two rounds.
    const results = await Promise.all(
      [a, a, b, b].map((run) =>
        run.run({ connectionId, target: writer, sql: 'SELECT pg_sleep(0.6)' }),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1150);
  });

  it('answers busy when no slot frees up in time', async () => {
    const connectionId = randomUUID();
    const settings = {
      EXECUTOR_MAX_CONCURRENT_QUERIES: '1',
      EXECUTOR_QUEUE_WAIT_MS: '200',
    };
    const [a, b] = [process(settings), process(settings)];
    const long = a.run({ connectionId, target: writer, sql: 'SELECT pg_sleep(1)' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await b.run({ connectionId, target: writer, sql: 'SELECT 1' })).toMatchObject({
      ok: false,
      code: 'CONNECTION_BUSY',
    });
    expect(await long).toMatchObject({ ok: true });
  });

  it('frees a slot held by a crashed process when its lease runs out', async () => {
    const env = loadEnv(globalThis.process.env);
    const redis = new RedisService(env);
    redisClients.push(redis);
    const coordination = new RedisCoordination(redis);
    const key = semaphoreKey(randomUUID());
    expect(await coordination.tryAcquire(key, 1, 300, 'crashed')).toBe(true);
    expect(await coordination.tryAcquire(key, 1, 300, 'next')).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await coordination.tryAcquire(key, 1, 300, 'next')).toBe(true);
  });

  it('pauses a connection after repeated failures, shared through Redis', async () => {
    const connectionId = randomUUID();
    const settings = {
      EXECUTOR_BREAKER_FAILURES: '2',
      EXECUTOR_BREAKER_COOLDOWN_MS: '1500',
    };
    const broken = { ...writer, password: 'wrong-password' };
    const [a, b] = [process(settings), process(settings)];
    expect(await a.run({ connectionId, target: broken, sql: 'SELECT 1' })).toMatchObject({
      code: 'CONNECTION_FAILED',
    });
    expect(await b.run({ connectionId, target: broken, sql: 'SELECT 1' })).toMatchObject({
      code: 'CONNECTION_FAILED',
    });
    // The second failure came from the other process, and still paused it for both.
    expect(await a.run({ connectionId, target: writer, sql: 'SELECT 1' })).toMatchObject({
      code: 'CONNECTION_PAUSED',
    });
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(await a.run({ connectionId, target: writer, sql: 'SELECT 1' })).toMatchObject({
      ok: true,
    });
  });
});
