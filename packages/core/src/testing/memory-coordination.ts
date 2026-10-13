import type { Coordination } from '../user-database/coordination';

/** In-process stand-in for unit tests. Same rules, no Redis. */
export class MemoryCoordination implements Coordination {
  private readonly slots = new Map<string, Map<string, number>>();
  private readonly failures = new Map<string, number>();
  private readonly paused = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async tryAcquire(key: string, limit: number, leaseMs: number, token: string) {
    const leases = this.slots.get(key) ?? new Map<string, number>();
    for (const [held, expires] of leases) {
      if (expires <= this.now()) {
        leases.delete(held);
      }
    }
    if (leases.size >= limit) {
      return false;
    }
    leases.set(token, this.now() + leaseMs);
    this.slots.set(key, leases);
    return true;
  }

  async release(key: string, token: string) {
    this.slots.get(key)?.delete(token);
  }

  async pausedFor(key: string) {
    return Math.max(0, (this.paused.get(key) ?? 0) - this.now());
  }

  async recordFailure(key: string, threshold: number, cooldownMs: number) {
    const count = (this.failures.get(key) ?? 0) + 1;
    if (count >= threshold) {
      this.failures.delete(key);
      this.paused.set(key, this.now() + cooldownMs);
      return true;
    }
    this.failures.set(key, count);
    return false;
  }

  async recordSuccess(key: string) {
    this.failures.delete(key);
  }

  /** Slots currently held, for tests. */
  held(key: string): number {
    return this.slots.get(key)?.size ?? 0;
  }
}
