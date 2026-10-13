import { randomUUID } from 'node:crypto';
import {
  ConnectionJobRunner,
  ConnectionService,
  JobProcessor,
  JobQueue,
  type JobView,
  PrismaConnectionRepository,
  PrismaSchemaRepository,
  PrismaService,
  type QueryJobRunner,
  SchemaService,
  UserDatabaseProbe,
} from '@ayd/core';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import type { Logger } from 'nestjs-pino';
import { loadEnv } from '../../src/config/env';
import {
  createScratchDatabase,
  plainClients,
  type ScratchDatabase,
} from '../helpers/scratch-database';

// Phase 6 step 3b acceptance: connection create, update, and test, and schema refresh, run
// as jobs through BullMQ against a real database. A new login is saved only after the
// worker's read-only check passes, and a finished job keeps no sealed credentials.

const logger = { warn: () => undefined } as unknown as Logger;

describe('connection and schema jobs through BullMQ', () => {
  const env = loadEnv({
    ...process.env,
    JOB_QUEUE_NAME: `test-jobs-${randomUUID().slice(0, 8)}`,
  });
  const prisma = new PrismaService(env);
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
  const processor = new JobProcessor(
    {} as QueryJobRunner,
    new ConnectionJobRunner(connections, schemas),
  );
  const queue = new JobQueue(env);
  const inspectConnection = new Redis(env.REDIS_URL);
  const inspect = new Queue(env.JOB_QUEUE_NAME, { connection: inspectConnection });
  const workerConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  let worker: Worker;
  const userId = randomUUID();
  let db: ScratchDatabase;
  let reader: { username: string; password: string };
  let writer: { username: string; password: string };

  function settings(login: { username: string; password: string }) {
    return {
      label: 'Scratch',
      host: 'scratch.example',
      port: db.port,
      databaseName: db.name,
      username: login.username,
      password: login.password,
      sslMode: 'require',
    };
  }

  async function finished(job: JobView): Promise<JobView> {
    const deadline = Date.now() + 15000;
    for (;;) {
      const current = await queue.get(job.id, userId);
      if (current.state === 'succeeded' || current.state === 'failed') {
        return current;
      }
      if (Date.now() > deadline) {
        throw new Error(`job ${job.id} still ${current.state}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function storedPayload(job: JobView): Promise<string> {
    return JSON.stringify((await inspect.getJob(job.id))?.data);
  }

  beforeAll(async () => {
    db = await createScratchDatabase();
    reader = await db.createLogin('jobs_reader');
    writer = await db.createLogin('jobs_writer');
    await db.admin.query(`
      CREATE TABLE public.items (id int PRIMARY KEY, name text);
      GRANT SELECT ON public.items TO ${reader.username};
      GRANT SELECT, INSERT ON public.items TO ${writer.username};
    `);
    await prisma.user.create({
      data: {
        id: userId,
        googleSubject: `test:${userId}`,
        email: `${userId}@example.test`,
        name: 'Connection job test',
        lastLoginAt: new Date(),
      },
    });
    worker = new Worker(
      env.JOB_QUEUE_NAME,
      (job) => processor.handle(job, () => undefined),
      {
        connection: workerConnection,
      },
    );
  });

  afterAll(async () => {
    await worker.close();
    await workerConnection.quit();
    await inspect.close();
    await inspectConnection.quit();
    await queue.onModuleDestroy();
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await db.drop();
  });

  it('never stores a login that can write, and says why', async () => {
    const job = await queue.add('connection.create', {
      userId,
      ip: null,
      pending: connections.prepareCreate(settings(writer)),
    });
    const done = await finished(job);
    expect(done).toMatchObject({ state: 'failed', error: { code: 'NOT_READ_ONLY' } });
    expect(await connections.list(userId)).toEqual([]);
  });

  it('saves a read-only login, then refreshes, tests, and updates it as jobs', async () => {
    const created = await finished(
      await queue.add('connection.create', {
        userId,
        ip: '203.0.113.7',
        pending: connections.prepareCreate(settings(reader)),
      }),
    );
    expect(created).toMatchObject({
      kind: 'connection.create',
      state: 'succeeded',
      result: { label: 'Scratch', status: 'active' },
    });
    const connectionId = (created.result as { id: string }).id;
    expect(await connections.list(userId)).toHaveLength(1);

    const refreshed = await finished(
      await queue.add('schema.refresh', { userId, connectionId, ip: null }),
    );
    expect(refreshed).toMatchObject({
      state: 'succeeded',
      result: { version: 1, tableCount: 1, defaultsApplied: true },
    });

    const tested = await finished(
      await queue.add('connection.test', { userId, connectionId, ip: null }),
    );
    expect(tested).toMatchObject({ state: 'succeeded', result: { status: 'active' } });

    // A wrong password fails the check and leaves the saved login as it was.
    const badPlan = await connections.prepareUpdate(
      userId,
      connectionId,
      { password: 'not-the-password' },
      null,
    );
    if (!badPlan.check) {
      throw new Error('a new password needs a check');
    }
    const rejected = await finished(
      await queue.add('connection.update', {
        userId,
        connectionId,
        ip: null,
        pending: badPlan.pending,
      }),
    );
    expect(rejected).toMatchObject({
      state: 'failed',
      error: { code: 'CONNECTION_FAILED' },
    });
    const stillWorks = await finished(
      await queue.add('connection.test', { userId, connectionId, ip: null }),
    );
    expect(stillWorks.state).toBe('succeeded');

    const renamePlan = await connections.prepareUpdate(
      userId,
      connectionId,
      { label: 'Renamed' },
      null,
    );
    expect(renamePlan).toMatchObject({ check: false, connection: { label: 'Renamed' } });
  });

  it('keeps no sealed credentials in a finished job, only the settings', async () => {
    const job = await queue.add('connection.create', {
      userId,
      ip: null,
      pending: connections.prepareCreate({ ...settings(reader), label: 'Second' }),
    });
    const queuedPayload = await storedPayload(job);
    expect(queuedPayload).toContain('passwordCiphertext');
    expect(queuedPayload).not.toContain(reader.password);

    await finished(job);
    const kept = await storedPayload(job);
    expect(kept).not.toContain('passwordCiphertext');
    expect(kept).not.toContain('encryptedDataKey');
    expect(kept).toContain('Second');
  });
});
