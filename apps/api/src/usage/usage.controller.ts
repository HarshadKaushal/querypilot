import { USAGE_COUNTERS, utcDay, type UsageCounters } from '@ayd/core';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AuthGuard, type PublicUser, CurrentUser } from '../auth';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';
import { SubmissionLimits } from '../limits/submission-limits';

/** Today's usage against the limits (blueprint 12, Usage). The day is UTC. */
@Controller('v1/usage')
@UseGuards(AuthGuard)
export class UsageController {
  constructor(
    @Inject(USAGE_COUNTERS) private readonly usage: UsageCounters,
    private readonly limits: SubmissionLimits,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  @Get()
  async today(@CurrentUser() user: PublicUser) {
    const day = utcDay();
    const [counted, asked] = await Promise.all([
      this.usage.get(user.id, day),
      this.limits.questionsUsedToday(user.id),
    ]);
    return {
      day,
      plan: user.planTier,
      // Counted when submitted, as the quota is; finished questions are counted below.
      questions: { used: asked, limit: this.env.QUESTIONS_PER_DAY },
      submissionsPerMinute: this.env.SUBMISSIONS_PER_MINUTE,
      finishedQuestions: counted.questions,
      rowsReturned: counted.rowsReturned,
      tokens: { input: counted.inputTokens, output: counted.outputTokens },
    };
  }
}
