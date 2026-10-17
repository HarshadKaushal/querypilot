import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { safeErrorDetail } from '../logging/safe-error';
import { APP_ENV, type CoreEnv } from '../config/env';
import { classifyConnectError } from './connect-error';
import { ConnectionPools, type PoolClientLike } from './connection-pools';
import {
  breakerKey,
  COORDINATION,
  semaphoreKey,
  type Coordination,
} from './coordination';
import {
  classifyQueryError,
  countsAsConnectionFailure,
  failure,
  type ExecutionFailure,
} from './query-error';
import { SQLSTATE } from './sqlstate';
import type { ProbeRequest } from './user-database.probe';

export interface ExecutionRequest {
  connectionId: string;
  /** From ConnectionService.resolveTarget: pinned address, decrypted credentials. */
  target: ProbeRequest;
  /** SQL the guard accepted. The executor's own limits apply whatever it is. */
  sql: string;
  rowCap?: number;
  /**
   * Aborted when the job is cancelled. The executor stops before connecting, while it
   * waits for a slot, and between batches of rows, and then throws the abort reason. A
   * statement already running finishes or hits the statement timeout first.
   */
  signal?: AbortSignal;
}

export interface ExecutionSuccess {
  ok: true;
  columns: Array<{ name: string; dataTypeId: number }>;
  /** One array per row, in column order. */
  rows: unknown[][];
  rowCount: number;
  /** Why the result is incomplete: the row cap, the size cap, or not at all. */
  truncated: false | 'rows' | 'size';
  durationMs: number;
}

export type ExecutionResult = ExecutionSuccess | ExecutionFailure;

const FETCH_BATCH = 100;
const CURSOR = 'ayd_result';
// A slot's lease lasts this much longer than the statement timeout, so a query that runs
// right up to its timeout still holds its slot while it finishes.
const LEASE_MARGIN_MS = 10_000;
// Waiting for a slot: first retry after 25 ms, doubling up to 500 ms between tries.
const FIRST_RETRY_MS = 25;
const MAX_RETRY_MS = 500;

/**
 * The only code that runs SQL on a user database (blueprint rule 7). Each query runs in a
 * READ ONLY transaction with a statement timeout and an empty search_path, holds one of the
 * connection's global slots in Redis, and is read through a cursor up to the row and size
 * caps. A connection that keeps failing is paused (ADR 0010).
 */
@Injectable()
export class QueryExecutor {
  constructor(
    @Inject(APP_ENV) private readonly env: CoreEnv,
    private readonly pools: ConnectionPools,
    @Inject(COORDINATION) private readonly coordination: Coordination,
    private readonly logger: Logger,
  ) {}

  async run(request: ExecutionRequest): Promise<ExecutionResult> {
    const { connectionId } = request;
    request.signal?.throwIfAborted();
    const paused = await this.coordination.pausedFor(breakerKey(connectionId));
    if (paused > 0) {
      return failure(
        'CONNECTION_PAUSED',
        `This database failed ${this.env.EXECUTOR_BREAKER_FAILURES} times in a row, so it is paused. Try again in ${Math.ceil(paused / 1000)} seconds.`,
      );
    }
    const token = randomUUID();
    if (!(await this.acquire(connectionId, token, request.signal))) {
      return failure(
        'CONNECTION_BUSY',
        'This database is already running as many questions as allowed. Try again shortly.',
        true,
      );
    }
    try {
      const result = await this.execute(request);
      if (result.ok || !countsAsConnectionFailure(result.code)) {
        await this.coordination.recordSuccess(breakerKey(connectionId));
      } else {
        await this.coordination.recordFailure(
          breakerKey(connectionId),
          this.env.EXECUTOR_BREAKER_FAILURES,
          this.env.EXECUTOR_BREAKER_COOLDOWN_MS,
        );
      }
      return result;
    } finally {
      await this.coordination
        .release(semaphoreKey(connectionId), token)
        .catch((error: unknown) =>
          this.logger.warn(safeErrorDetail(error), 'releasing an executor slot failed'),
        );
    }
  }

  // Waits for a slot, backing off, until EXECUTOR_QUEUE_WAIT_MS. The lease outlives the
  // statement timeout, so a crashed holder frees its slot on its own.
  private async acquire(
    connectionId: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const leaseMs = this.env.EXECUTOR_STATEMENT_TIMEOUT_MS + LEASE_MARGIN_MS;
    const deadline = Date.now() + this.env.EXECUTOR_QUEUE_WAIT_MS;
    let delay = FIRST_RETRY_MS;
    for (;;) {
      signal?.throwIfAborted();
      const acquired = await this.coordination.tryAcquire(
        semaphoreKey(connectionId),
        this.env.EXECUTOR_MAX_CONCURRENT_QUERIES,
        leaseMs,
        token,
      );
      if (acquired) {
        return true;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remaining)));
      delay = Math.min(delay * 2, MAX_RETRY_MS);
    }
  }

  private async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const started = Date.now();
    const timeoutMs = this.env.EXECUTOR_STATEMENT_TIMEOUT_MS;
    const rowCap = request.rowCap ?? this.env.SQL_ROW_CAP;
    const pool = this.pools.get(request.connectionId, request.target);

    let client: PoolClientLike;
    try {
      client = await pool.connect();
    } catch (error) {
      this.logger.warn(safeErrorDetail(error), 'user database connection failed');
      const connect = classifyConnectError(error);
      return failure(
        connect.code === 'NOT_READ_ONLY' ? 'CONNECTION_FAILED' : connect.code,
        connect.message,
      );
    }

    let healthy = true;
    try {
      request.signal?.throwIfAborted();
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
      // Approved function, type, and operator names then resolve only in pg_catalog.
      await client.query("SET LOCAL search_path = ''");
      // The extended protocol accepts exactly one statement, so
      // "SELECT 1; COMMIT; DELETE ..." cannot escape the transaction even without the guard.
      await client.query({
        text: `DECLARE ${CURSOR} NO SCROLL CURSOR FOR ${request.sql}`,
        queryMode: 'extended',
      });

      const rows: unknown[][] = [];
      let columns: ExecutionSuccess['columns'] = [];
      let bytes = 0;
      let truncated: ExecutionSuccess['truncated'] = false;
      for (;;) {
        if (request.signal?.aborted) {
          // The cursor and transaction are left open, so the socket is discarded.
          healthy = false;
          request.signal.throwIfAborted();
        }
        // statement_timeout covers each FETCH on its own; this caps the whole read.
        if (Date.now() - started > timeoutMs) {
          healthy = false;
          return classifyQueryError({ code: SQLSTATE.QUERY_CANCELED }, timeoutMs);
        }
        // One row past the cap shows whether the result was cut.
        const want = Math.min(FETCH_BATCH, rowCap + 1 - rows.length);
        const batch = await client.query({
          text: `FETCH FORWARD ${want} FROM ${CURSOR}`,
          queryMode: 'extended',
          rowMode: 'array',
        });
        if (columns.length === 0 && batch.fields) {
          columns = batch.fields.map((field) => ({
            name: field.name,
            dataTypeId: field.dataTypeID,
          }));
        }
        for (const row of batch.rows as unknown[][]) {
          if (rows.length === rowCap) {
            truncated = 'rows';
            break;
          }
          bytes += Buffer.byteLength(JSON.stringify(row), 'utf8');
          if (bytes > this.env.EXECUTOR_MAX_RESULT_BYTES) {
            truncated = 'size';
            break;
          }
          rows.push(row);
        }
        if (truncated || batch.rows.length < want) {
          break;
        }
      }
      // Nothing is ever committed, even though nothing could have been written.
      await client.query('ROLLBACK');
      return {
        ok: true,
        columns,
        rows,
        rowCount: rows.length,
        truncated,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      healthy = false;
      if (request.signal?.aborted) {
        throw error;
      }
      this.logger.warn(safeErrorDetail(error), 'user database query failed');
      return classifyQueryError(error, timeoutMs);
    } finally {
      // A socket that failed mid-transaction is discarded rather than reused.
      client.release(!healthy);
    }
  }
}
