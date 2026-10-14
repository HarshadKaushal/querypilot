import { DailyQuota, RateLimiter } from '@ayd/core';
import { Module } from '@nestjs/common';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { SubmissionLimits } from './submission-limits';

/** Redis-backed rate limits and daily quotas for the API's routes. */
@Module({
  providers: [RateLimiter, DailyQuota, SubmissionLimits, AuthRateLimitGuard],
  exports: [RateLimiter, DailyQuota, SubmissionLimits, AuthRateLimitGuard],
})
export class LimitsModule {}
