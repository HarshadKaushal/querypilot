import { Inject, Injectable, Optional } from '@nestjs/common';
import { AskJobRunner } from '../ask/ask-job.runner';
import { AUDIT_WRITER, type AuditWriter } from '../audit/audit.repository';
import { INTERNAL_ERROR_MESSAGE } from '../errors/app.exception';
import { utcDay } from '../limits/daily-quota';
import { USAGE_COUNTERS, type UsageCounters } from '../limits/usage-counters.repository';
import {
  historyEntryFor,
  QUERY_HISTORY,
  type QueryHistory,
} from '../history/query-history.repository';
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
  /** When the job was added, in milliseconds. */
  timestamp?: number;
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
    // Optional so tests of other behaviour can build the processor without storage.
    @Optional() @Inject(QUERY_HISTORY) private readonly history?: QueryHistory,
    @Optional() @Inject(USAGE_COUNTERS) private readonly usage?: UsageCounters,
    @Optional() @Inject(AUDIT_WRITER) private readonly audit?: AuditWriter,
  ) {}

  /** Records a job given up after its last crash, so history shows it failed. */
  async recordGivenUp(job: RunnableJob): Promise<void> {
    await this.record(job, {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE, retryable: true },
    });
  }

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
    await this.record(job, outcome).catch(onSideError);
    return outcome;
  }

  /** Writes the history entry for a finished question or SQL job; other kinds have none. */
  private async record(job: RunnableJob, outcome: JobOutcome<unknown>): Promise<void> {
    const entry = historyEntryFor({
      id: job.id ?? '',
      kind: job.name,
      data: job.data,
      createdAt: new Date(job.timestamp ?? Date.now()),
      outcome,
    });
    if (!entry || !entry.id) {
      return;
    }
    await this.history?.record(entry);
    // Daily usage, kept apart from history so deleting history does not erase it.
    await this.usage?.add(entry.userId, utcDay(entry.createdAt), {
      questions: entry.kind === 'question' ? 1 : 0,
      rowsReturned: entry.rowCount ?? 0,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
    });
    // SQL the guard refused for good: a spike can mean someone is probing the guard.
    if (entry.errorCode === 'SQL_REJECTED') {
      const guardCode = outcome.ok ? undefined : outcome.error.detail?.guardCode;
      await this.audit?.write({
        userId: entry.userId,
        eventType: 'query.rejected',
        metadata: {
          jobId: entry.id,
          connectionId: entry.connectionId,
          kind: entry.kind,
          ...(guardCode ? { guardCode } : {}),
        },
        ip: null,
      });
    }
  }
}
