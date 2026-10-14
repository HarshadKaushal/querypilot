import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

// A sliding window: a sorted set of hit ids scored by time, read with Redis's clock so every
// API instance agrees. Hits older than the window are dropped first. Returns 0 when the hit
// is allowed, or the milliseconds until the oldest hit leaves the window.
const HIT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return math.max(1, tonumber(oldest[2]) + window - now)
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window)
return 0`;

export function rateKey(scope: string, subject: string): string {
  return `ayd:rate:${scope}:${subject}`;
}

/**
 * At most `limit` hits per `windowMs` for one subject (a user, an IP address), counted in
 * Redis so the limit holds across every API instance. A sliding window has no edge where
 * twice the limit could pass, as a per-minute counter does.
 */
@Injectable()
export class RateLimiter {
  constructor(private readonly redis: RedisService) {}

  async hit(
    scope: string,
    subject: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: true } | { allowed: false; retryAfterMs: number }> {
    const wait = Number(
      await this.redis.run(
        HIT,
        [rateKey(scope, subject)],
        [limit, windowMs, randomUUID()],
      ),
    );
    return wait === 0 ? { allowed: true } : { allowed: false, retryAfterMs: wait };
  }
}
