import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import type { CoreEnv } from '../config/env';
import { CANCEL_CHANNEL } from './job-cancellation';
import type { JobProcessor } from './job-processor';
import { withoutCredentials, type JobOutcome } from './job.types';
import type { UserJobSlots } from './user-job-slots';

/** What the worker reports. The app turns these into log lines. */
export interface JobWorkerHooks {
  finished(job: Job, outcome: JobOutcome<unknown>): void;
  /** An unexpected error. givenUp is true when no attempt is left (the dead-letter set). */
  crashed(job: Job | undefined, error: Error, givenUp: boolean): void;
  /** A write that does not change the outcome failed (progress, payload cleanup). */
  sideError(jobId: string | undefined, error: unknown): void;
  error(error: Error): void;
}

export interface RunningJobWorker {
  worker: Worker;
  /** Stops taking jobs and waits for the running ones to finish. */
  close(): Promise<void>;
}

/**
 * Takes jobs from the queue and runs them through the processor.
 *
 * Cancellation: the worker subscribes to the cancel channel and aborts the signal of a job
 * it is running. Crashes: BullMQ retries a job that threw, up to its attempts, and a job
 * whose worker died is found stalled when its lock expires and is run again. A job with no
 * attempts left stays in the failed set for JOB_FAILED_RETENTION_SECONDS, its sealed
 * credentials removed.
 */
export async function startJobWorker(options: {
  env: Pick<CoreEnv, 'REDIS_URL' | 'JOB_QUEUE_NAME'>;
  processor: JobProcessor;
  /** Each job's user slot is released here when the job ends. */
  slots: UserJobSlots;
  hooks: JobWorkerHooks;
  concurrency: number;
  /** How long a job's lock lasts without renewal; a dead worker's job stalls after it. */
  lockDurationMs?: number;
  /** How often this worker looks for stalled jobs. */
  stalledIntervalMs?: number;
}): Promise<RunningJobWorker> {
  const { env, processor, slots, hooks } = options;
  const release = (job: Job): void => {
    const userId = (job.data as { userId?: unknown }).userId;
    if (typeof userId === 'string' && job.id) {
      slots
        .release(userId, job.id)
        .catch((error: unknown) => hooks.sideError(job.id, error));
    }
  };
  // Blocking commands must retry forever (BullMQ requires this on worker connections).
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const worker = new Worker(
    env.JOB_QUEUE_NAME,
    (job, _token, signal) =>
      processor.handle(job, {
        signal,
        onSideError: (error) => hooks.sideError(job.id, error),
      }),
    {
      connection,
      concurrency: options.concurrency,
      ...(options.lockDurationMs ? { lockDuration: options.lockDurationMs } : {}),
      ...(options.stalledIntervalMs
        ? { stalledInterval: options.stalledIntervalMs }
        : {}),
    },
  );
  worker.on('completed', (job, outcome) => {
    release(job);
    hooks.finished(job, outcome as JobOutcome<unknown>);
  });
  worker.on('failed', (job, error) => {
    const givenUp = !!job && job.attemptsMade >= (job.opts.attempts ?? 1);
    if (job && givenUp) {
      release(job);
      processor
        .recordGivenUp(job)
        .catch((record: unknown) => hooks.sideError(job.id, record));
      const kept = withoutCredentials(job.data);
      if (kept) {
        job
          .updateData(kept)
          .catch((cleanup: unknown) => hooks.sideError(job.id, cleanup));
      }
    }
    hooks.crashed(job, error, givenUp);
  });
  worker.on('error', (error) => hooks.error(error));

  subscriber.on('message', (_channel: string, jobId: string) => {
    // Only the worker running the job finds it; every other worker ignores the message.
    worker.cancelJob(jobId, 'cancelled by its owner');
  });
  await subscriber.subscribe(CANCEL_CHANNEL);

  return {
    worker,
    close: async () => {
      await subscriber.quit().catch(() => subscriber.disconnect());
      await worker.close();
      await connection.quit().catch(() => connection.disconnect());
    },
  };
}
