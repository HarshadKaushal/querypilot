import { randomUUID } from 'node:crypto';
import {
  type ConnectionJobRunner,
  JobCancellation,
  JobEvents,
  type JobEventType,
  type JobOutcome,
  JobProcessor,
  JobQueue,
  type JobView,
  type QueryJobRunner,
  RedisService,
  startJobWorker,
  type JobContext,
  type JobWorkerHooks,
  type RunningJobWorker,
} from '@ayd/core';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { loadEnv } from '../../src/config/env';

// Phase 6 step 4 acceptance against real Redis and BullMQ: progress events reach the API
// process, cancellation stops waiting and running jobs, a crash is retried, a job with no
// attempts left is kept with its credentials removed, and a job whose worker died is run
// again by another worker. The runners are stand-ins, so each case controls timing; the
// queue, events, cancellation, processor, and worker are the real ones.

type Behaviour = (
  data: { sql: string },
  context: JobContext,
) => Promise<JobOutcome<unknown>>;

const quiet: JobWorkerHooks = {
  finished: () => undefined,
  crashed: () => undefined,
  sideError: () => undefined,
  error: () => undefined,
};

describe('job lifecycle through BullMQ', () => {
  const userId = randomUUID();
  const cleanups: Array<() => Promise<unknown>> = [];

  /** A fresh queue, with its own API-side services and a processor running `behaviour`. */
  function setup(
    behaviour: Behaviour,
    create: () => Promise<JobOutcome<unknown>> = async () => ({
      ok: true,
      result: { id: 'c1' },
    }),
  ) {
    const env = loadEnv({
      ...process.env,
      JOB_QUEUE_NAME: `test-life-${randomUUID().slice(0, 8)}`,
      JOB_ATTEMPTS: '2',
    });
    const redis = new RedisService(env);
    const cancellation = new JobCancellation(redis);
    const queue = new JobQueue(env, cancellation);
    const events = new JobEvents(env);
    const queries = { run: behaviour } as unknown as QueryJobRunner;
    const connections = { create } as unknown as ConnectionJobRunner;
    const processor = new JobProcessor(queries, connections, cancellation);
    const workers: RunningJobWorker[] = [];
    cleanups.push(async () => {
      for (const running of workers) {
        await running.close();
      }
      await events.onModuleDestroy();
      await queue.onModuleDestroy();
      await redis.onModuleDestroy();
    });
    return {
      env,
      queue,
      events,
      cancellation,
      async worker(
        options: { lockDurationMs?: number; stalledIntervalMs?: number } = {},
      ) {
        const running = await startJobWorker({
          env,
          processor,
          hooks: quiet,
          concurrency: 1,
          ...options,
        });
        workers.push(running);
        return running;
      },
      submit(sql = 'SELECT 1') {
        return queue.add('query.run', { userId, connectionId: randomUUID(), sql });
      },
      async finished(job: JobView, timeoutMs = 15000): Promise<JobView> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const current = await queue.get(job.id, userId);
          if (['succeeded', 'failed', 'cancelled'].includes(current.state)) {
            return current;
          }
          if (Date.now() > deadline) {
            throw new Error(`job still ${current.state}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      },
    };
  }

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()!();
    }
  });

  it('delivers active, progress, and completed events to a subscriber in the API process', async () => {
    const life = setup(async (_data, context) => {
      await context.report('checking_sql');
      await context.report('running_query');
      return { ok: true, result: { rowCount: 1 } };
    });
    const job = await life.submit();
    const seen: JobEventType[] = [];
    const stages: Array<string | undefined> = [];
    const unsubscribe = await life.events.subscribe(job.id, (type) => {
      seen.push(type);
      if (type === 'progress') {
        void life.queue.get(job.id, userId).then((view) => stages.push(view.stage));
      }
    });
    await life.worker();
    const done = await life.finished(job);
    await new Promise((resolve) => setTimeout(resolve, 200));
    unsubscribe();
    expect(done.state).toBe('succeeded');
    expect(seen).toEqual(expect.arrayContaining(['active', 'progress', 'completed']));
    expect(seen.indexOf('active')).toBeLessThan(seen.indexOf('completed'));
    expect(stages.length).toBeGreaterThan(0);
  });

  it('cancels a job that is still waiting, without running it', async () => {
    const ran = jest.fn();
    const life = setup(async () => {
      ran();
      return { ok: true, result: 1 };
    });
    const job = await life.submit();
    await expect(life.queue.cancel(job.id, userId)).resolves.toMatchObject({
      state: 'queued',
      cancelRequested: true,
    });
    await life.worker();
    const done = await life.finished(job);
    expect(done).toMatchObject({ state: 'cancelled', error: { code: 'JOB_CANCELLED' } });
    expect(ran).not.toHaveBeenCalled();
  });

  it('cancels a running job through the abort signal', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const life = setup(async (_data, context) => {
      started();
      // Stands in for a long query: waits until the job is aborted.
      await new Promise((_resolve, reject) => {
        context.signal?.addEventListener('abort', () => reject(context.signal?.reason));
      });
      return { ok: true, result: 'never' };
    });
    await life.worker();
    const job = await life.submit();
    await running;
    await life.queue.cancel(job.id, userId);
    const done = await life.finished(job);
    expect(done).toMatchObject({ state: 'cancelled', error: { code: 'JOB_CANCELLED' } });
  });

  it('retries a job that crashed and reports the second run', async () => {
    let runs = 0;
    const life = setup(async () => {
      runs += 1;
      if (runs === 1) {
        throw new Error('the database connection dropped');
      }
      return { ok: true, result: { runs } };
    });
    await life.worker();
    const done = await life.finished(await life.submit());
    expect(done).toMatchObject({ state: 'succeeded', result: { runs: 2 } });
  });

  it('gives a job up after its last attempt, keeps it for inspection, and removes its credentials', async () => {
    // A create job carries sealed credentials; its runner crashes on every attempt.
    const life = setup(
      async () => ({ ok: true, result: 1 }),
      async () => {
        throw new Error('always broken');
      },
    );
    await life.worker();
    const job = await life.queue.add('connection.create', {
      userId,
      ip: null,
      pending: {
        id: randomUUID(),
        settings: {
          label: 'x',
          host: 'db.example',
          port: 5432,
          databaseName: 'x',
          sslMode: 'require',
          sendSampleRowsToLlm: false,
        },
        sealed: {
          usernameCiphertext: 'u',
          usernameIv: 'u',
          usernameTag: 'u',
          passwordCiphertext: 'p',
          passwordIv: 'p',
          passwordTag: 'p',
          encryptedDataKey: 'k',
          dataKeyIv: 'k',
          dataKeyTag: 'k',
          keyVersion: 1,
        },
      },
    });
    const done = await life.finished(job);
    expect(done).toMatchObject({
      state: 'failed',
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Try again.' },
    });

    const inspectConnection = new Redis(life.env.REDIS_URL);
    const inspect = new Queue(life.env.JOB_QUEUE_NAME, { connection: inspectConnection });
    try {
      const stored = await inspect.getJob(job.id);
      expect(await stored?.getState()).toBe('failed');
      expect(stored?.attemptsMade).toBe(2);
      // The cleanup runs as the failure is handled; give it a moment.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const kept = JSON.stringify((await inspect.getJob(job.id))?.data);
      expect(kept).not.toContain('passwordCiphertext');
      expect(kept).toContain('db.example');
    } finally {
      await inspect.close();
      await inspectConnection.quit();
    }
  });

  it("runs a job again on another worker when the first one's process dies mid-job", async () => {
    let runs = 0;
    const life = setup(async () => {
      runs += 1;
      if (runs === 1) {
        // The first worker never finishes: its process is about to "die".
        return new Promise<JobOutcome<unknown>>(() => undefined);
      }
      return { ok: true, result: { runs } };
    });
    const dying = await life.worker({ lockDurationMs: 1000, stalledIntervalMs: 500 });
    const job = await life.submit();
    while (runs === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // A hard stop: no lock renewal, no completion, as when a process is killed.
    await dying.worker.close(true);
    await life.worker({ lockDurationMs: 1000, stalledIntervalMs: 500 });
    const done = await life.finished(job, 20000);
    expect(done).toMatchObject({ state: 'succeeded', result: { runs: 2 } });
  }, 30000);
});
