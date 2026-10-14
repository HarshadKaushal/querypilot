import { randomUUID } from 'node:crypto';
import {
  DailyQuota,
  PrismaAuditWriter,
  PrismaService,
  PrismaUsageCounters,
  RateLimiter,
  RedisService,
  quotaKey,
  rateKey,
  utcDay,
} from '@ayd/core';
import { loadEnv } from '../../src/config/env';

// Phase 8 acceptance for limits: the rate limit and the daily quota hold across API
// instances (two Redis clients stand in for two instances), many requests at once cannot
// pass the limit, and usage and audit rows land in PostgreSQL.

describe('limits in Redis and usage in PostgreSQL', () => {
  const env = loadEnv();
  const first = new RedisService(env);
  const second = new RedisService(env);
  const prisma = new PrismaService(env);
  const userId = randomUUID();

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        googleSubject: `test:${userId}`,
        email: `${userId}@example.test`,
        name: 'Limits test',
        lastLoginAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await first.run(
      `return redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])`,
      [
        rateKey('submit', userId),
        rateKey('submit-burst', userId),
        quotaKey('questions', userId, utcDay()),
      ],
      [],
    );
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await Promise.all([first.onModuleDestroy(), second.onModuleDestroy()]);
  });

  it('shares one sliding window between instances, and says how long to wait', async () => {
    const a = new RateLimiter(first);
    const b = new RateLimiter(second);
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await (i % 2 ? b : a).hit('submit', userId, 4, 60_000));
    }
    expect(results.slice(0, 4).every((r) => r.allowed)).toBe(true);
    const last = results[4];
    expect(last.allowed).toBe(false);
    if (!last.allowed) {
      expect(last.retryAfterMs).toBeGreaterThan(55_000);
      expect(last.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it('lets exactly the limit through when many requests arrive at once', async () => {
    const limiters = [new RateLimiter(first), new RateLimiter(second)];
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        limiters[i % 2].hit('submit-burst', userId, 10, 60_000),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it('takes the last question once, gives one back, and counts across instances', async () => {
    const a = new DailyQuota(first);
    const b = new DailyQuota(second);
    const taken = await Promise.all(
      Array.from({ length: 8 }, (_, i) => (i % 2 ? b : a).take('questions', userId, 5)),
    );
    expect(taken.filter((n) => n !== null).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(await b.used('questions', userId)).toBe(5);
    await a.giveBack('questions', userId);
    expect(await b.used('questions', userId)).toBe(4);
    expect(await b.take('questions', userId, 5)).toBe(5);
    expect(await a.take('questions', userId, 5)).toBeNull();
  });

  it('adds usage per user and UTC day, and audit rows without the SQL', async () => {
    const usage = new PrismaUsageCounters(prisma);
    await usage.add(userId, '2026-10-14', {
      questions: 1,
      rowsReturned: 12,
      inputTokens: 900,
      outputTokens: 60,
    });
    await usage.add(userId, '2026-10-14', {
      questions: 0,
      rowsReturned: 3,
      inputTokens: 0,
      outputTokens: 0,
    });
    await usage.add(userId, '2026-10-15', {
      questions: 1,
      rowsReturned: 1,
      inputTokens: 10,
      outputTokens: 1,
    });
    expect(await usage.get(userId, '2026-10-14')).toEqual({
      day: '2026-10-14',
      questions: 1,
      rowsReturned: 15,
      inputTokens: 900,
      outputTokens: 60,
    });
    expect((await usage.get(userId, '2026-10-13')).questions).toBe(0);

    await new PrismaAuditWriter(prisma).write({
      userId,
      eventType: 'query.rejected',
      metadata: { jobId: 'j1', connectionId: 'c1', kind: 'sql', guardCode: 'NOT_SELECT' },
      ip: null,
    });
    const rows = await prisma.auditLog.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('query.rejected');
  });

  it('removes usage rows with the account', async () => {
    const other = randomUUID();
    await prisma.user.create({
      data: {
        id: other,
        googleSubject: `test:${other}`,
        email: `${other}@example.test`,
        name: 'Limits test 2',
        lastLoginAt: new Date(),
      },
    });
    await new PrismaUsageCounters(prisma).add(other, '2026-10-14', {
      questions: 1,
      rowsReturned: 1,
      inputTokens: 1,
      outputTokens: 1,
    });
    await prisma.user.delete({ where: { id: other } });
    expect(await prisma.usageCounter.count({ where: { userId: other } })).toBe(0);
  });
});
