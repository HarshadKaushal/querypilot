import { Injectable } from '@nestjs/common';
import type { PublicConnection } from '../connections/connection.repository';
import { ConnectionService } from '../connections/connection.service';
import { AppException } from '../errors/app.exception';
import { SchemaService, type RefreshSummary } from '../schema/schema.service';
import {
  NO_JOB_CONTEXT,
  type ConnectionCreateJobData,
  type ConnectionJobData,
  type ConnectionUpdateJobData,
  type JobContext,
  type JobOutcome,
} from './job.types';
import { fromException } from './job-errors';

/**
 * The jobs that open a user database to manage a connection: check and save a new or
 * changed one, test a saved one, and read its schema again.
 */
@Injectable()
export class ConnectionJobRunner {
  constructor(
    private readonly connections: ConnectionService,
    private readonly schemas: SchemaService,
  ) {}

  async create(
    data: ConnectionCreateJobData,
    context: JobContext = NO_JOB_CONTEXT,
  ): Promise<JobOutcome<PublicConnection>> {
    await context.report('checking_access');
    return outcomeOf(() =>
      this.connections.createChecked(data.userId, data.pending, data.ip, context.signal),
    );
  }

  async update(
    data: ConnectionUpdateJobData,
    context: JobContext = NO_JOB_CONTEXT,
  ): Promise<JobOutcome<PublicConnection>> {
    await context.report('checking_access');
    return outcomeOf(() =>
      this.connections.updateChecked(
        data.userId,
        data.connectionId,
        data.pending,
        data.ip,
        context.signal,
      ),
    );
  }

  async test(
    data: ConnectionJobData,
    context: JobContext = NO_JOB_CONTEXT,
  ): Promise<JobOutcome<PublicConnection>> {
    await context.report('checking_access');
    return outcomeOf(() =>
      this.connections.test(data.userId, data.connectionId, data.ip),
    );
  }

  async refresh(
    data: ConnectionJobData,
    context: JobContext = NO_JOB_CONTEXT,
  ): Promise<JobOutcome<RefreshSummary>> {
    await context.report('reading_schema');
    return outcomeOf(() => this.schemas.refresh(data.userId, data.connectionId, data.ip));
  }
}

/** Runs the work; an AppException becomes a failed outcome, anything else escapes. */
async function outcomeOf<Result>(
  work: () => Promise<Result>,
): Promise<JobOutcome<Result>> {
  try {
    return { ok: true, result: await work() };
  } catch (error) {
    if (error instanceof AppException) {
      return { ok: false, error: fromException(error) };
    }
    throw error;
  }
}
