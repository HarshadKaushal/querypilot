import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { safeErrorDetail } from '../common/logging/safe-error';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';
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
import type { ProbeRequest } from './user-database.probe';

export interface ExecutionRequest {
  connectionId: string;
  /** From ConnectionService.resolveTarget: pinned address, decrypted credentials. */
  target: ProbeRequest;
  /** SQL the guard accepted. The executor's own limits apply whatever it is. */
  sql: string;
  rowCap?: number;
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

/**
 * The only code that runs SQL on a user database (blueprint rule 7). Each query runs in a
 * READ ONLY transaction with a statement timeout and an empty search_path, holds one of the
 * connection's global slots in Redis, and is read through a cursor up to the row and size
 * caps. A connection that keeps failing is paused (ADR 0010).
 */
@Injectable()
export class QueryExecutor {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly pools: ConnectionPools,
    @Inject(COORDINATION) private readonly coordination: Coordination,
    private readonly logger: Logger,
  ) {}

  async run(request: ExecutionRequest): Promise<ExecutionResult> {
    const { connectionId } = request;
    const paused = await this.coordination.pausedFor(breakerKey(connectionId));
    if (paused > 0) {
      return failure(
        'CONNECTION_PAUSED',
        `This database failed ${this.env.EXECUTOR_BREAKER_FAILURES} times in a row, so it is paused. Try again in ${Math.ceil(paused / 1000)} seconds.`,
      );
    }
    const token = randomUUID();
    if (!(await this.acquire(connectionId, token))) {
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
  private async acquire(connectionId: string, token: string): Promise<boolean> {
    const leaseMs = this.env.EXECUTOR_STATEMENT_TIMEOUT_MS + 10000;
    const deadline = Date.now() + this.env.EXECUTOR_QUEUE_WAIT_MS;
    let delay = 25;
    for (;;) {
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
      delay = Math.min(delay * 2, 500);
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
        if (Date.now() - started > timeoutMs) {
          healthy = false;
          return classifyQueryError({ code: '57014' }, timeoutMs);
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
      this.logger.warn(safeErrorDetail(error), 'user database query failed');
      return classifyQueryError(error, timeoutMs);
    } finally {
      // A socket that failed mid-transaction is discarded rather than reused.
      client.release(!healthy);
    }
  }
}
