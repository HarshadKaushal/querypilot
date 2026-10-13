import { APP_ENV, JobProcessor, safeErrorDetail } from '@ayd/core';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import type { WorkerEnv } from '../config/env';

/**
 * Takes jobs from the queue and hands each to the processor. Logs carry the job id, kind,
 * and outcome code, never the SQL or any result rows.
 */
@Injectable()
export class JobWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private connection?: Redis;
  private worker?: Worker;

  constructor(
    @Inject(APP_ENV) private readonly env: WorkerEnv,
    @Inject(JobProcessor) private readonly processor: JobProcessor,
    // PinoLogger takes (fields, message), so the text lands in message, not context.
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {}

  onApplicationBootstrap(): void {
    // A worker's blocking connection must retry forever (BullMQ requires this setting).
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      this.env.JOB_QUEUE_NAME,
      (job) => this.processor.process(job.name, job.data),
      { connection: this.connection, concurrency: this.env.WORKER_CONCURRENCY },
    );
    this.worker.on(
      'completed',
      (job, outcome: { ok: boolean; error?: { code: string } }) => {
        this.logger.info(
          {
            jobId: job.id,
            kind: job.name,
            ok: outcome.ok,
            code: outcome.error?.code,
            ms: (job.finishedOn ?? Date.now()) - (job.processedOn ?? job.timestamp),
          },
          'job finished',
        );
      },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        { jobId: job?.id, kind: job?.name, error: safeErrorDetail(error) },
        'job failed unexpectedly',
      );
    });
    this.worker.on('error', (error) => {
      this.logger.error({ error: safeErrorDetail(error) }, 'job worker error');
    });
  }

  /** Stops taking jobs and waits for the running ones to finish. */
  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }
}
