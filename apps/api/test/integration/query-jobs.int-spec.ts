import { randomUUID } from 'node:crypto';
import {
  type ConnectionJobRunner,
  ConnectionPools,
  ConnectionService,
  JobCancellation,
  JobProcessor,
  JobQueue,
  type JobView,
  PrismaConnectionRepository,
  PrismaSchemaRepository,
  PrismaService,
  QueryExecutor,
  QueryJobRunner,
  RedisCoordination,
  RedisService,
  SchemaService,
  SqlGuardService,
  UserDatabaseProbe,
} from '@ayd/core';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import type { Logger } from 'nestjs-pino';
import { loadEnv } from '../../src/config/env';
import {
  createScratchDatabase,
  plainClients,
  plainPools,
  type ScratchDatabase,
} from '../helpers/scratch-database';

// Phase 6 step 3 acceptance: the API side adds a job and returns at once, a BullMQ worker
// runs it through the guard and the executor against a real database, and the owner reads
// the outcome. The queue name is unique to this run, so no other worker takes these jobs.

const logger = { warn: () => undefined, error: () => undefined } as unknown as Logger;

describe('query jobs through BullMQ', () => {
  const env = loadEnv({
    ...process.env,
    JOB_QUEUE_NAME: `test-jobs-${randomUUID().slice(0, 8)}`,
  });
  const prisma = new PrismaService(env);
  const redis = new RedisService(env);
  const probe = new UserDatabaseProbe(logger, plainClients);
  const connections = new ConnectionService(
    new PrismaConnectionRepository(prisma),
    { lookup: async () => ['127.0.0.1'] },
    probe,
    env,
  );
  const schemas = new SchemaService(
    new PrismaSchemaRepository(prisma),
    connections,
    probe,
  );
  const pools = new ConnectionPools(env, logger, plainPools);
  const cancellation = new JobCancellation(redis);
  const processor = new JobProcessor(
    new QueryJobRunner(
      new SqlGuardService(schemas, env),
      connections,
      new QueryExecutor(env, pools, new RedisCoordination(redis), logger),
    ),
    {} as ConnectionJobRunner,
    cancellation,
  );
  const queue = new JobQueue(env, cancellation);
  const workerConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  let worker: Worker;
  const userId = randomUUID();
  const otherUserId = randomUUID();
  let db: ScratchDatabase;
  let connectionId: string;

  async function finished(job: JobView, owner = userId): Promise<JobView> {
    const deadline = Date.now() + 15000;
    for (;;) {
      const current = await queue.get(job.id, owner);
      if (current.state === 'succeeded' || current.state === 'failed') {
        return current;
      }
      if (Date.now() > deadline) {
        throw new Error(`job ${job.id} still ${current.state}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  function submit(sql: string) {
    return queue.add('query.run', { userId, connectionId, sql });
  }

  beforeAll(async () => {
    db = await createScratchDatabase();
    const login = await db.createLogin('job_reader');
    await db.admin.query(`
      CREATE TABLE public.customers (id int PRIMARY KEY, region text, email text);
      INSERT INTO public.customers VALUES (1, 'North', 'a@x'), (2, 'North', 'b@x'), (3, 'East', 'c@x');
      CREATE TABLE public.notes (id int);
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${login.username};
    `);
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          googleSubject: `test:${id}`,
          email: `${id}@example.test`,
          name: 'Query job test',
          lastLoginAt: new Date(),
        },
      });
    }
    const created = await connections.create(
      userId,
      {
        label: 'Scratch',
        host: 'scratch.example',
        port: db.port,
        databaseName: db.name,
        username: login.username,
        password: login.password,
        sslMode: 'require',
      },
      null,
    );
    connectionId = created.id;
    await schemas.refresh(userId, connectionId, null);
    worker = new Worker(
      env.JOB_QUEUE_NAME,
      (job) => processor.handle(job, { onSideError: () => undefined }),
      {
        connection: workerConnection,
      },
    );
  });

  afterAll(async () => {
    await worker.close();
    await workerConnection.quit();
    await queue.onModuleDestroy();
    await pools.onModuleDestroy();
    await redis.onModuleDestroy();
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
    await db.drop();
  });

  it('answers with a queued job at once, then runs it and returns the rows', async () => {
    const job = await submit(
      'SELECT region, count(*) AS n FROM customers GROUP BY region ORDER BY n DESC',
    );
    expect(job).toMatchObject({ kind: 'query.run', state: 'queued', startedAt: null });

    const done = await finished(job);
    expect(done).toMatchObject({
      state: 'succeeded',
      result: {
        columns: [
          { name: 'region', dataTypeId: 25 },
          { name: 'n', dataTypeId: 20 },
        ],
        rows: [
          ['North', '2'],
          ['East', '1'],
        ],
        rowCount: 2,
        truncated: false,
        schemaVersion: 1,
      },
    });
    expect((done.result as { sql: string }).sql).toContain('LIMIT 1001');
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
  });

  it('fails a query the guard rejects, with its reason, without touching the database', async () => {
    // email is hidden by the sensitive-column default.
    const done = await finished(await submit('SELECT email FROM customers'));
    expect(done).toMatchObject({
      state: 'failed',
      error: {
        code: 'SQL_REJECTED',
        retryable: true,
        detail: { guardCode: 'column_not_allowed' },
      },
    });
    expect(done.error?.message).toContain('email');
  });

  it('reports a table dropped since the snapshot as a schema change', async () => {
    await db.admin.query('DROP TABLE public.notes');
    const done = await finished(await submit('SELECT id FROM notes'));
    expect(done).toMatchObject({
      state: 'failed',
      error: { code: 'QUERY_SCHEMA_CHANGED', retryable: false },
    });
  });

  it('shows a job only to its owner, and treats a malformed id as not found', async () => {
    const job = await submit('SELECT id FROM customers');
    await expect(queue.get(job.id, otherUserId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(queue.get('not-a-job-id', userId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(queue.get(randomUUID(), userId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await finished(job);
  });

  it("fails a job for someone else's connection with NOT_FOUND", async () => {
    const job = await queue.add('query.run', {
      userId: otherUserId,
      connectionId,
      sql: 'SELECT id FROM customers',
    });
    const done = await finished(job, otherUserId);
    expect(done).toMatchObject({ state: 'failed', error: { code: 'NOT_FOUND' } });
  });
});
