import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/** The UTC day as YYYY-MM-DD. Quotas reset at midnight UTC. */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function quotaKey(scope: string, userId: string, day: string): string {
  return `ayd:quota:${scope}:${userId}:${day}`;
}

// Takes one unit if the count is under the limit. Returns the new count, or -1 when the
// limit was already reached. The key outlives the day by a day, then Redis removes it.
const TAKE = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used >= tonumber(ARGV[1]) then
  return -1
end
used = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 172800)
return used`;

const GIVE_BACK = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used > 0 then
  return redis.call('DECR', KEYS[1])
end
return 0`;

/**
 * A per-user daily allowance, counted in Redis at submission time so it holds across API
 * instances and two requests at once cannot both take the last unit.
 */
@Injectable()
export class DailyQuota {
  constructor(private readonly redis: RedisService) {}

  /** The count after taking one, or null when today's limit is already used. */
  async take(scope: string, userId: string, limit: number): Promise<number | null> {
    const used = Number(
      await this.redis.run(TAKE, [quotaKey(scope, userId, utcDay())], [limit]),
    );
    return used < 0 ? null : used;
  }

  /** Returns a unit taken for work that was never queued. */
  async giveBack(scope: string, userId: string): Promise<void> {
    await this.redis.run(GIVE_BACK, [quotaKey(scope, userId, utcDay())], []);
  }

  async used(scope: string, userId: string): Promise<number> {
    const value = await this.redis.run(
      `return redis.call('GET', KEYS[1]) or '0'`,
      [quotaKey(scope, userId, utcDay())],
      [],
    );
    return Number(value);
  }
}

/** Seconds until the next UTC midnight, for the Retry-After of a used-up daily quota. */
export function secondsUntilUtcMidnight(at: Date = new Date()): number {
  const next = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
  return Math.ceil((next - at.getTime()) / 1000);
}
