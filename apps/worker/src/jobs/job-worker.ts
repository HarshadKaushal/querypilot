import {
  APP_ENV,
  JobProcessor,
  safeErrorDetail,
  startJobWorker,
  type RunningJobWorker,
} from '@ayd/core';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { WorkerEnv } from '../config/env';

/**
 * Runs core's job worker in this process and logs what it reports. Logs carry the job id,
 * kind, and outcome code, never the SQL or any result rows.
 */
@Injectable()
export class JobWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private running?: RunningJobWorker;

  constructor(
    @Inject(APP_ENV) private readonly env: WorkerEnv,
    @Inject(JobProcessor) private readonly processor: JobProcessor,
    // PinoLogger takes (fields, message), so the text lands in message, not context.
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.running = await startJobWorker({
      env: this.env,
      processor: this.processor,
      concurrency: this.env.WORKER_CONCURRENCY,
      hooks: {
        finished: (job, outcome) =>
          this.logger.info(
            {
              jobId: job.id,
              kind: job.name,
              ok: outcome.ok,
              code: outcome.ok ? undefined : outcome.error.code,
              ms: (job.finishedOn ?? Date.now()) - (job.processedOn ?? job.timestamp),
            },
            'job finished',
          ),
        crashed: (job, error, givenUp) =>
          this.logger.error(
            {
              jobId: job?.id,
              kind: job?.name,
              attempt: job?.attemptsMade,
              givenUp,
              error: safeErrorDetail(error),
            },
            givenUp
              ? 'job given up after its last attempt'
              : 'job crashed; it will be retried',
          ),
        sideError: (jobId, error) =>
          this.logger.warn(
            { jobId, error: safeErrorDetail(error) },
            'could not save job progress or clean its payload',
          ),
        error: (error) =>
          this.logger.error({ error: safeErrorDetail(error) }, 'job worker error'),
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.running?.close();
  }
}
