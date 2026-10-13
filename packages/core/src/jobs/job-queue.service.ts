import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import Redis from 'ioredis';
import { APP_ENV, type CoreEnv } from '../config/env';
import { INTERNAL_ERROR_MESSAGE, notFound } from '../errors/app.exception';
import {
  JOB_KINDS,
  type JobDataByKind,
  type JobKind,
  type JobOutcome,
  type JobView,
} from './job.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Adds jobs and reads them back for their owner. Finished jobs, results included, are kept
 * for JOB_RESULT_TTL_SECONDS and then removed by BullMQ.
 */
@Injectable()
export class JobQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(@Inject(APP_ENV) private readonly env: CoreEnv) {
    // Fail fast instead of queueing commands while Redis is down, so an HTTP request that
    // adds a job gets an error rather than hanging.
    this.connection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // One queue carries every kind of job; the job name is its kind.
    this.queue = new Queue(env.JOB_QUEUE_NAME, { connection: this.connection });
  }

  async add<Kind extends JobKind>(
    kind: Kind,
    data: JobDataByKind[Kind],
  ): Promise<JobView> {
    const age = this.env.JOB_RESULT_TTL_SECONDS;
    const job = await this.queue.add(kind, data, {
      jobId: randomUUID(),
      removeOnComplete: { age },
      removeOnFail: { age },
    });
    return jobView(job, 'waiting');
  }

  /** The job, if it exists and belongs to userId. Anything else is NOT_FOUND. */
  async get(jobId: string, userId: string): Promise<JobView> {
    if (!UUID.test(jobId)) {
      throw notFound();
    }
    const job = await this.queue.getJob(jobId);
    if (!job || (job.data as { userId?: unknown }).userId !== userId) {
      throw notFound();
    }
    return jobView(job, await job.getState());
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}

function iso(ms: number | undefined): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

/** Maps a BullMQ job and its state to what the owner sees. */
export function jobView(
  job: Pick<
    Job,
    'id' | 'name' | 'timestamp' | 'processedOn' | 'finishedOn' | 'returnvalue'
  >,
  state: string,
): JobView {
  if (!(JOB_KINDS as readonly string[]).includes(job.name) || state === 'unknown') {
    throw notFound();
  }
  const base = {
    id: job.id ?? '',
    kind: job.name as JobKind,
    createdAt: new Date(job.timestamp).toISOString(),
    startedAt: iso(job.processedOn),
    finishedAt: iso(job.finishedOn),
  };
  if (state === 'completed') {
    const outcome = job.returnvalue as JobOutcome<unknown>;
    return outcome.ok
      ? { ...base, state: 'succeeded', result: outcome.result }
      : { ...base, state: 'failed', error: outcome.error };
  }
  if (state === 'failed') {
    // Something unexpected broke. The worker logged it; the owner gets a fixed message.
    return {
      ...base,
      state: 'failed',
      error: { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE, retryable: true },
    };
  }
  if (state === 'active') {
    return { ...base, state: 'running' };
  }
  // waiting, delayed, prioritized, waiting-children
  return { ...base, state: 'queued' };
}
