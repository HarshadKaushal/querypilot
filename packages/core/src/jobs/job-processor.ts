import { Injectable } from '@nestjs/common';
import type { JobDataByKind, JobKind, JobOutcome } from './job.types';
import { QueryJobRunner } from './query-job.runner';

/** Sends a job to the runner for its kind. The worker calls this for every job it takes. */
@Injectable()
export class JobProcessor {
  constructor(private readonly queries: QueryJobRunner) {}

  async process(kind: string, data: unknown): Promise<JobOutcome<unknown>> {
    switch (kind as JobKind) {
      case 'query.run':
        return this.queries.run(data as JobDataByKind['query.run']);
      default:
        throw new Error(`Unknown job kind: ${kind.slice(0, 40)}`);
    }
  }
}
