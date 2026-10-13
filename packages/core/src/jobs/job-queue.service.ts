import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { APP_ENV, type CoreEnv } from '../config/env';
import { INTERNAL_ERROR_MESSAGE, notFound } from '../errors/app.exception';
import { JobCancellation } from './job-cancellation';
import {
  JOB_KINDS,
  type JobDataByKind,
  type JobKind,
  type JobOutcome,
  type JobStage,
  type JobView,
} from './job.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Adds jobs, reads them back for their owner, and takes cancellation requests. A finished
 * job, result included, is kept for JOB_RESULT_TTL_SECONDS. A job given up after
 * JOB_ATTEMPTS crashes is kept for JOB_FAILED_RETENTION_SECONDS, for inspection.
 */
@Injectable()
export class JobQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(
    @Inject(APP_ENV) private readonly env: CoreEnv,
    private readonly cancellation: JobCancellation,
  ) {
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
    const job = await this.queue.add(kind, data, {
      jobId: randomUUID(),
      // Only a crash is retried: an expected failure completes with an error outcome.
      attempts: this.env.JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: this.env.JOB_RESULT_TTL_SECONDS },
      removeOnFail: { age: this.env.JOB_FAILED_RETENTION_SECONDS },
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
    const view = jobView(job, await job.getState());
    if (view.state === 'queued' || view.state === 'running') {
      return (await this.cancellation.requested(jobId))
        ? { ...view, cancelRequested: true }
        : view;
    }
    return view;
  }

  /**
   * Asks the worker to stop the job. A waiting job is cancelled when a worker reaches it,
   * a running one at its next step. A finished job is returned unchanged.
   */
  async cancel(jobId: string, userId: string): Promise<JobView> {
    const view = await this.get(jobId, userId);
    if (view.state !== 'queued' && view.state !== 'running') {
      return view;
    }
    await this.cancellation.request(jobId);
    return { ...view, cancelRequested: true };
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}

function iso(ms: number | undefined): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

/** The parts of a BullMQ job that its view needs. */
export interface JobFields {
  id?: string;
  name: string;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  returnvalue?: unknown;
  progress?: unknown;
}

/** Maps a BullMQ job and its state to what the owner sees. */
export function jobView(job: JobFields, state: string): JobView {
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
    if (outcome.ok) {
      return { ...base, state: 'succeeded', result: outcome.result };
    }
    return {
      ...base,
      state: outcome.error.code === 'JOB_CANCELLED' ? 'cancelled' : 'failed',
      error: outcome.error,
    };
  }
  if (state === 'failed') {
    // Given up after JOB_ATTEMPTS crashes. The worker logged each one; the owner gets a
    // fixed message.
    return {
      ...base,
      state: 'failed',
      error: { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE, retryable: true },
    };
  }
  if (state === 'active') {
    const stage = (job.progress as { stage?: JobStage } | undefined)?.stage;
    return stage ? { ...base, state: 'running', stage } : { ...base, state: 'running' };
  }
  // waiting, delayed (a retry after a crash), prioritized, waiting-children
  return { ...base, state: 'queued' };
}
