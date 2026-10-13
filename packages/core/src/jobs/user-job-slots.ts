import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export function userJobsKey(userId: string): string {
  return `ayd:jobs:user:${userId}`;
}

/**
 * A lease outlives any normal wait and run, so the slot of a job whose release was lost (a
 * worker died between finishing and releasing) frees itself.
 */
export const USER_JOB_LEASE_MS = 60 * 60 * 1000;

// A sorted set of the user's unfinished job ids, scored by lease expiry, read with Redis's
// clock. Returns the number of jobs the user has with this one (1 for the first), or 0 when
// the limit is reached. Claiming the same job twice is harmless.
const CLAIM = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZSCORE', KEYS[1], ARGV[3]) then
  return redis.call('ZCARD', KEYS[1])
end
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[1]) then
  return 0
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
return count + 1`;

const RELEASE = `return redis.call('ZREM', KEYS[1], ARGV[1])`;

/**
 * Each user's unfinished jobs, shared by every API and worker process. The API claims a
 * slot before queueing a job; the worker releases it when the job ends, however it ends.
 */
@Injectable()
export class UserJobSlots {
  constructor(private readonly redis: RedisService) {}

  /** The user's job count including this one, or 0 if they already have `limit`. */
  async claim(userId: string, jobId: string, limit: number): Promise<number> {
    return Number(
      await this.redis.run(
        CLAIM,
        [userJobsKey(userId)],
        [limit, USER_JOB_LEASE_MS, jobId],
      ),
    );
  }

  async release(userId: string, jobId: string): Promise<void> {
    await this.redis.run(RELEASE, [userJobsKey(userId)], [jobId]);
  }
}
