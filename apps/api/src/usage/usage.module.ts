import { SequelizeUsageCounters, USAGE_COUNTERS } from '@ayd/core';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { LimitsModule } from '../limits/limits.module';
import { UsageController } from './usage.controller';

@Module({
  imports: [AuthModule, LimitsModule],
  controllers: [UsageController],
  providers: [{ provide: USAGE_COUNTERS, useClass: SequelizeUsageCounters }],
})
export class UsageModule {}
