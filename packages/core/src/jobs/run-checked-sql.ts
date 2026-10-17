import type { StoredConnection } from '../connections/connection.repository';
import type { ConnectionService } from '../connections/connection.service';
import type { ExecutionResult, QueryExecutor } from '../user-database/query-executor';
import { fromException } from './job-errors';
import type { JobContext, JobError } from './job.types';

/**
 * What happened when SQL the guard accepted was sent to the customer's database:
 * - `ran: true`: the executor ran it, and `result` says whether the query succeeded;
 * - `ran: false`: the database could not be reached at all (its host no longer resolves,
 *   or now resolves somewhere blocked), so nothing ran.
 */
export type SqlRun =
  | { ran: true; connection: StoredConnection; result: ExecutionResult }
  | { ran: false; error: JobError };

/**
 * Opens the user's connection and runs SQL the guard already accepted. Shared by the
 * "run your own SQL" job and the question job, so both report the same stages and stop at
 * the same points when the owner cancels.
 */
export async function runCheckedSql(
  deps: { connections: ConnectionService; executor: QueryExecutor },
  query: { userId: string; connectionId: string; sql: string },
  context: JobContext,
): Promise<SqlRun> {
  context.signal?.throwIfAborted();
  await context.report('connecting');
  const target = await deps.connections.resolveTarget(query.userId, query.connectionId);
  if (!target.ok) {
    return { ran: false, error: fromException(target.error) };
  }
  context.signal?.throwIfAborted();
  await context.report('running_query');
  const result = await deps.executor.run({
    connectionId: query.connectionId,
    target: target.request,
    sql: query.sql,
    signal: context.signal,
  });
  return { ran: true, connection: target.row, result };
}
