import { DailyQuota, RateLimiter, secondsUntilUtcMidnight, tooMany } from '@ayd/core';
import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';

const MINUTE = 60_000;

/**
 * The per-user limits on work that reaches the worker (ADR 0013). Checked after a request is
 * validated and its connection found, so a bad request or someone else's id never uses up
 * an allowance. Both limits live in Redis and hold across every API instance.
 */
@Injectable()
export class SubmissionLimits {
  constructor(
    private readonly rate: RateLimiter,
    private readonly quota: DailyQuota,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /** Questions, SQL, and re-runs together: SUBMISSIONS_PER_MINUTE per user. */
  async checkRate(userId: string): Promise<void> {
    const hit = await this.rate.hit(
      'submit',
      userId,
      this.env.SUBMISSIONS_PER_MINUTE,
      MINUTE,
    );
    if (!hit.allowed) {
      throw tooMany(
        'RATE_LIMITED',
        `You can send ${this.env.SUBMISSIONS_PER_MINUTE} questions or queries a minute. Try again in a moment.`,
        hit.retryAfterMs / 1000,
      );
    }
  }

  /** One of today's QUESTIONS_PER_DAY, taken before the question is queued. */
  async takeQuestion(userId: string): Promise<void> {
    if (
      (await this.quota.take('questions', userId, this.env.QUESTIONS_PER_DAY)) === null
    ) {
      throw tooMany(
        'QUOTA_EXCEEDED',
        `You have asked ${this.env.QUESTIONS_PER_DAY} questions today, the daily limit. It resets at midnight UTC.`,
        secondsUntilUtcMidnight(),
      );
    }
  }

  /** Returns today's question when it could not be queued. */
  async giveBackQuestion(userId: string): Promise<void> {
    await this.quota.giveBack('questions', userId);
  }

  async questionsUsedToday(userId: string): Promise<number> {
    return this.quota.used('questions', userId);
  }
}
