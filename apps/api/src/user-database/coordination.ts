import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

// State shared by every API and worker process: how many queries are running against each
// user connection, and whether a connection is paused after repeated failures. Redis holds
// it, so the limits hold across processes (ADR 0010).

export interface Coordination {
  /** Takes one of `limit` slots for `leaseMs`. False when every slot is taken. */
  tryAcquire(
    key: string,
    limit: number,
    leaseMs: number,
    token: string,
  ): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
  /** Milliseconds the connection stays paused, or 0. */
  pausedFor(key: string): Promise<number>;
  /** Counts a failure. Pauses the connection for `cooldownMs` when it reaches `threshold`. */
  recordFailure(key: string, threshold: number, cooldownMs: number): Promise<boolean>;
  recordSuccess(key: string): Promise<void>;
}

export const COORDINATION = Symbol('COORDINATION');

export function semaphoreKey(connectionId: string): string {
  return `ayd:executor:slots:${connectionId}`;
}

export function breakerKey(connectionId: string): string {
  return `ayd:executor:breaker:${connectionId}`;
}

// Slots are a sorted set of lease tokens scored by expiry. Expired leases are dropped first,
// so a process that crashed while holding a slot loses it when the lease runs out. Time
// comes from Redis, so processes with different clocks agree.
const ACQUIRE = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[1]) then
  redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
  return 1
end
return 0`;

const RELEASE = `return redis.call('ZREM', KEYS[1], ARGV[1])`;

// KEYS[1] counts consecutive failures, KEYS[2] exists while the connection is paused.
const FAILURE = `
local n = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], 86400000)
if n >= tonumber(ARGV[1]) then
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], '1', 'PX', tonumber(ARGV[2]))
  return 1
end
return 0`;

const PAUSED_FOR = `
local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then return ttl end
return 0`;

const SUCCESS = `return redis.call('DEL', KEYS[1])`;

@Injectable()
export class RedisCoordination implements Coordination {
  constructor(private readonly redis: RedisService) {}

  async tryAcquire(key: string, limit: number, leaseMs: number, token: string) {
    return (await this.redis.run(ACQUIRE, [key], [limit, leaseMs, token])) === 1;
  }

  async release(key: string, token: string) {
    await this.redis.run(RELEASE, [key], [token]);
  }

  async pausedFor(key: string) {
    return Number(await this.redis.run(PAUSED_FOR, [`${key}:paused`], []));
  }

  async recordFailure(key: string, threshold: number, cooldownMs: number) {
    const opened = await this.redis.run(
      FAILURE,
      [`${key}:failures`, `${key}:paused`],
      [threshold, cooldownMs],
    );
    return opened === 1;
  }

  async recordSuccess(key: string) {
    await this.redis.run(SUCCESS, [`${key}:failures`], []);
  }
}
