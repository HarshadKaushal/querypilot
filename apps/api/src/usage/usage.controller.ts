import { USAGE_COUNTERS, utcDay, type UsageCounters } from '@ayd/core';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard, type PublicUser, CurrentUser } from '../auth';
import { ApiErrors } from '../common/openapi';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';
import { SubmissionLimits } from '../limits/submission-limits';
import { UsageTodayDto } from './usage.responses';

/** Today's usage against the limits (blueprint 12, Usage). The day is UTC. */
@ApiTags('usage')
@ApiBearerAuth()
@ApiErrors(401)
@Controller('v1/usage')
@UseGuards(AuthGuard)
export class UsageController {
  constructor(
    @Inject(USAGE_COUNTERS) private readonly usage: UsageCounters,
    private readonly limits: SubmissionLimits,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  @Get()
  @ApiOperation({ summary: "Today's usage against your limits (UTC day)" })
  @ApiResponse({ status: 200, description: "Today's usage.", type: UsageTodayDto })
  async today(@CurrentUser() user: PublicUser): Promise<UsageTodayDto> {
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
