import type { AuditEntry } from '../audit/audit.repository';
import type { AuditWriter } from '../audit/audit.repository';
import { utcDay } from '../limits/daily-quota';
import type {
  DailyUsage,
  UsageCounters,
  UsageDelta,
} from '../limits/usage-counters.repository';

/** In-process stand-in for RateLimiter. Same sliding window, no Redis. */
export class MemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  async hit(
    scope: string,
    subject: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: true } | { allowed: false; retryAfterMs: number }> {
    const key = `${scope}:${subject}`;
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterMs: Math.max(1, recent[0] + windowMs - now) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true };
  }
}

/** In-process stand-in for DailyQuota, keyed by the UTC day as the real one is. */
export class MemoryDailyQuota {
  private readonly counts = new Map<string, number>();

  async take(scope: string, userId: string, limit: number): Promise<number | null> {
    const key = `${scope}:${userId}:${utcDay()}`;
    const used = this.counts.get(key) ?? 0;
    if (used >= limit) {
      return null;
    }
    this.counts.set(key, used + 1);
    return used + 1;
  }

  async giveBack(scope: string, userId: string): Promise<void> {
    const key = `${scope}:${userId}:${utcDay()}`;
    this.counts.set(key, Math.max(0, (this.counts.get(key) ?? 0) - 1));
  }

  async used(scope: string, userId: string): Promise<number> {
    return this.counts.get(`${scope}:${userId}:${utcDay()}`) ?? 0;
  }
}

export class MemoryUsageCounters implements UsageCounters {
  readonly days = new Map<string, UsageDelta>();

  async add(userId: string, day: string, delta: UsageDelta): Promise<void> {
    const current = await this.get(userId, day);
    this.days.set(`${userId}:${day}`, {
      questions: current.questions + delta.questions,
      rowsReturned: current.rowsReturned + delta.rowsReturned,
      inputTokens: current.inputTokens + delta.inputTokens,
      outputTokens: current.outputTokens + delta.outputTokens,
    });
  }

  async get(userId: string, day: string): Promise<DailyUsage> {
    const found = this.days.get(`${userId}:${day}`);
    return {
      day,
      questions: found?.questions ?? 0,
      rowsReturned: found?.rowsReturned ?? 0,
      inputTokens: found?.inputTokens ?? 0,
      outputTokens: found?.outputTokens ?? 0,
    };
  }
}

export class MemoryAuditWriter implements AuditWriter {
  readonly entries: AuditEntry[] = [];

  async write(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}
