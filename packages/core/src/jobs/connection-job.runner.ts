import { Injectable } from '@nestjs/common';
import type { PublicConnection } from '../connections/connection.repository';
import { ConnectionService } from '../connections/connection.service';
import { AppException } from '../errors/app.exception';
import { SchemaService, type RefreshSummary } from '../schema/schema.service';
import type {
  ConnectionCreateJobData,
  ConnectionJobData,
  ConnectionUpdateJobData,
  JobOutcome,
} from './job.types';
import { fromException } from './query-job.runner';

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

  create(data: ConnectionCreateJobData): Promise<JobOutcome<PublicConnection>> {
    return outcomeOf(() =>
      this.connections.createChecked(data.userId, data.pending, data.ip),
    );
  }

  update(data: ConnectionUpdateJobData): Promise<JobOutcome<PublicConnection>> {
    return outcomeOf(() =>
      this.connections.updateChecked(
        data.userId,
        data.connectionId,
        data.pending,
        data.ip,
      ),
    );
  }

  test(data: ConnectionJobData): Promise<JobOutcome<PublicConnection>> {
    return outcomeOf(() =>
      this.connections.test(data.userId, data.connectionId, data.ip),
    );
  }

  refresh(data: ConnectionJobData): Promise<JobOutcome<RefreshSummary>> {
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
