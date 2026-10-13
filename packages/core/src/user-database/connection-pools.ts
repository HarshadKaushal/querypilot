import { createHash } from 'node:crypto';
import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { Pool, types, type PoolConfig } from 'pg';
import { safeErrorDetail } from '../logging/safe-error';
import { APP_ENV, type CoreEnv } from '../config/env';
import { userDatabaseConfig } from './connection-config';
import type { ProbeRequest } from './user-database.probe';

export interface PoolClientLike {
  query(
    config:
      | string
      | { text: string; values?: unknown[]; rowMode?: 'array'; queryMode?: 'extended' },
  ): Promise<{ rows: unknown[]; fields?: Array<{ name: string; dataTypeID: number }> }>;
  /** Pass true to destroy the socket instead of returning it to the pool. */
  release(destroy?: boolean): void;
}

export interface PoolLike {
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export type PoolFactory = (config: PoolConfig) => PoolLike;

export const PG_POOL_FACTORY = Symbol('PG_POOL_FACTORY');

/** Pools kept at once. The least recently used one is closed past this. */
export const MAX_POOLS = 200;

// Dates and times come back exactly as PostgreSQL writes them. pg would otherwise turn a
// date into a JavaScript Date at local midnight, which shows the previous day once
// serialized in UTC on any server east of Greenwich. date, time, timestamp, timestamptz,
// interval, timetz.
const TEXT_TYPES = new Set([1082, 1083, 1114, 1184, 1186, 1266]);

export const RESULT_TYPES = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    TEXT_TYPES.has(oid)
      ? (value: string) => value
      : types.getTypeParser(oid, format as 'text')) as typeof types.getTypeParser,
};

/** Idle sockets close after this, so idle processes do not hold user connections open. */
const IDLE_TIMEOUT_MS = 10000;

interface Entry {
  fingerprint: string;
  pool: PoolLike;
}

/**
 * One pool per user connection. A pool is keyed by everything that decides where and as
 * whom it connects, so a new password, host, or pinned address gets a new pool and the old
 * one is closed. Each pool holds at most EXECUTOR_MAX_CONCURRENT_QUERIES sockets.
 */
@Injectable()
export class ConnectionPools implements OnModuleDestroy {
  private readonly pools = new Map<string, Entry>();

  constructor(
    @Inject(APP_ENV) private readonly env: CoreEnv,
    private readonly logger: Logger,
    @Optional() @Inject(PG_POOL_FACTORY) private readonly factory?: PoolFactory,
  ) {}

  get(connectionId: string, target: ProbeRequest): PoolLike {
    const fingerprint = createHash('sha256').update(JSON.stringify(target)).digest('hex');
    const existing = this.pools.get(connectionId);
    if (existing && existing.fingerprint === fingerprint) {
      // Re-insert so Map order tracks recent use.
      this.pools.delete(connectionId);
      this.pools.set(connectionId, existing);
      return existing.pool;
    }
    if (existing) {
      this.close(connectionId, existing);
    }
    const pool = (this.factory ?? ((config: PoolConfig) => new Pool(config)))({
      ...userDatabaseConfig(target),
      max: this.env.EXECUTOR_MAX_CONCURRENT_QUERIES,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      allowExitOnIdle: true,
      types: RESULT_TYPES,
    });
    // An idle socket that errors must not crash the process.
    pool.on('error', (error: Error) => {
      this.logger.warn(safeErrorDetail(error), 'idle user database connection failed');
    });
    this.pools.set(connectionId, { fingerprint, pool });
    if (this.pools.size > MAX_POOLS) {
      const [oldestId, oldest] = this.pools.entries().next().value as [string, Entry];
      this.close(oldestId, oldest);
    }
    return pool;
  }

  /** Closes the connection's pool, for example after its credentials change or it is deleted. */
  evict(connectionId: string): void {
    const existing = this.pools.get(connectionId);
    if (existing) {
      this.close(connectionId, existing);
    }
  }

  size(): number {
    return this.pools.size;
  }

  async onModuleDestroy(): Promise<void> {
    const entries = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(entries.map((entry) => entry.pool.end().catch(() => undefined)));
  }

  private close(connectionId: string, entry: Entry): void {
    this.pools.delete(connectionId);
    entry.pool.end().catch((error: unknown) => {
      this.logger.warn(safeErrorDetail(error), 'closing a user database pool failed');
    });
  }
}
