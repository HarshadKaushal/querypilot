import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
// Through the package name, not relative paths: apps load this file from source but the
// rest of core from its build, and Nest must see the same JobProcessor class they provide.
import {
  JobProcessor,
  jobView,
  notFound,
  type JobDataByKind,
  type JobKind,
  type JobView,
} from '@ayd/core';

interface InlineJob {
  name: JobKind;
  userId: string;
  timestamp: number;
  state: 'completed' | 'failed';
  returnvalue: unknown;
}

/**
 * Stands in for JobQueue in HTTP tests: each job runs at once, in this process, through the
 * real JobProcessor, and its outcome is kept. add() still answers "queued", as the real
 * queue does, so tests read the outcome with GET /v1/jobs/:id.
 */
@Injectable()
export class InlineJobQueue {
  readonly jobs = new Map<string, InlineJob>();

  constructor(@Inject(JobProcessor) private readonly processor: JobProcessor) {}

  async add<Kind extends JobKind>(
    kind: Kind,
    data: JobDataByKind[Kind],
  ): Promise<JobView> {
    const id = randomUUID();
    const job: InlineJob = {
      name: kind,
      userId: data.userId,
      timestamp: Date.now(),
      state: 'completed',
      returnvalue: undefined,
    };
    try {
      job.returnvalue = await this.processor.process(kind, data);
    } catch {
      job.state = 'failed';
    }
    this.jobs.set(id, job);
    return jobView({ id, name: kind, timestamp: job.timestamp }, 'waiting');
  }

  async get(jobId: string, userId: string): Promise<JobView> {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      throw notFound();
    }
    return jobView(
      {
        id: jobId,
        name: job.name,
        timestamp: job.timestamp,
        processedOn: job.timestamp,
        finishedOn: job.timestamp,
        returnvalue: job.returnvalue,
      },
      job.state,
    );
  }
}
