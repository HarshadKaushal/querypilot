import { Injectable } from '@nestjs/common';
import { ConnectionJobRunner } from './connection-job.runner';
import {
  withoutCredentials,
  type JobDataByKind,
  type JobKind,
  type JobOutcome,
} from './job.types';
import { QueryJobRunner } from './query-job.runner';

/** Sends a job to the runner for its kind. The worker calls this for every job it takes. */
@Injectable()
export class JobProcessor {
  constructor(
    private readonly queries: QueryJobRunner,
    private readonly connections: ConnectionJobRunner,
  ) {}

  /**
   * Runs a BullMQ job, then drops any sealed credentials from its stored payload. A failed
   * cleanup is reported, not thrown, because the work itself is done.
   */
  async handle(
    job: { name: string; data: unknown; updateData(data: unknown): Promise<void> },
    onCleanupError: (error: unknown) => void,
  ): Promise<JobOutcome<unknown>> {
    const outcome = await this.process(job.name, job.data);
    const kept = withoutCredentials(job.data);
    if (kept) {
      await job.updateData(kept).catch(onCleanupError);
    }
    return outcome;
  }

  async process(kind: string, data: unknown): Promise<JobOutcome<unknown>> {
    switch (kind as JobKind) {
      case 'query.run':
        return this.queries.run(data as JobDataByKind['query.run']);
      case 'connection.create':
        return this.connections.create(data as JobDataByKind['connection.create']);
      case 'connection.update':
        return this.connections.update(data as JobDataByKind['connection.update']);
      case 'connection.test':
        return this.connections.test(data as JobDataByKind['connection.test']);
      case 'schema.refresh':
        return this.connections.refresh(data as JobDataByKind['schema.refresh']);
      default:
        throw new Error(`Unknown job kind: ${kind.slice(0, 40)}`);
    }
  }
}
