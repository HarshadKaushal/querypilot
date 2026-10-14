import { Injectable } from '@nestjs/common';
import { AskJobRunner } from '../ask/ask-job.runner';
import { ConnectionJobRunner } from './connection-job.runner';
import { JobCancellation } from './job-cancellation';
import {
  cancelledOutcome,
  NO_JOB_CONTEXT,
  withoutCredentials,
  type JobContext,
  type JobDataByKind,
  type JobKind,
  type JobOutcome,
  type JobStage,
} from './job.types';
import { QueryJobRunner } from './query-job.runner';

/** The parts of a BullMQ job the processor uses. */
export interface RunnableJob {
  id?: string;
  name: string;
  data: unknown;
  updateData(data: unknown): Promise<void>;
  updateProgress(progress: { stage: JobStage }): Promise<void>;
}

/** Thrown when a stage finds a cancellation request the abort signal missed. */
class CancelRequested extends Error {}

/** Sends a job to the runner for its kind. The worker calls this for every job it takes. */
@Injectable()
export class JobProcessor {
  constructor(
    private readonly queries: QueryJobRunner,
    private readonly connections: ConnectionJobRunner,
    private readonly cancellation: JobCancellation,
    private readonly asks: AskJobRunner,
  ) {}

  /**
   * Runs a BullMQ job. A job cancelled while it waited ends at once; one cancelled while it
   * runs ends at its next stage or row batch. Either way the outcome is JOB_CANCELLED,
   * which BullMQ does not retry. Afterwards any sealed credentials are dropped from the
   * stored payload. Failed writes of progress or of the payload are reported through
   * onSideError, never thrown, because they do not change the outcome.
   */
  async handle(
    job: RunnableJob,
    options: { signal?: AbortSignal; onSideError: (error: unknown) => void },
  ): Promise<JobOutcome<unknown>> {
    const jobId = job.id ?? '';
    if (jobId && (await this.cancellation.requested(jobId))) {
      return this.finish(job, cancelledOutcome(), options.onSideError);
    }
    const context: JobContext = {
      signal: options.signal,
      report: async (stage) => {
        await job.updateProgress({ stage }).catch(options.onSideError);
        // Covers a request that arrived before this worker registered the job, so its
        // message could not abort the signal.
        if (jobId && (await this.cancellation.requested(jobId))) {
          throw new CancelRequested();
        }
      },
    };
    let outcome: JobOutcome<unknown>;
    try {
      outcome = await this.process(job.name, job.data, context);
    } catch (error) {
      if (!options.signal?.aborted && !(error instanceof CancelRequested)) {
        throw error;
      }
      outcome = cancelledOutcome();
    }
    return this.finish(job, outcome, options.onSideError);
  }

  async process(
    kind: string,
    data: unknown,
    context: JobContext = NO_JOB_CONTEXT,
  ): Promise<JobOutcome<unknown>> {
    switch (kind as JobKind) {
      case 'query.run':
        return this.queries.run(data as JobDataByKind['query.run'], context);
      case 'question.ask':
        return this.asks.run(data as JobDataByKind['question.ask'], context);
      case 'connection.create':
        return this.connections.create(
          data as JobDataByKind['connection.create'],
          context,
        );
      case 'connection.update':
        return this.connections.update(
          data as JobDataByKind['connection.update'],
          context,
        );
      case 'connection.test':
        return this.connections.test(data as JobDataByKind['connection.test'], context);
      case 'schema.refresh':
        return this.connections.refresh(data as JobDataByKind['schema.refresh'], context);
      default:
        throw new Error(`Unknown job kind: ${kind.slice(0, 40)}`);
    }
  }

  private async finish(
    job: RunnableJob,
    outcome: JobOutcome<unknown>,
    onSideError: (error: unknown) => void,
  ): Promise<JobOutcome<unknown>> {
    const kept = withoutCredentials(job.data);
    if (kept) {
      await job.updateData(kept).catch(onSideError);
    }
    return outcome;
  }
}
