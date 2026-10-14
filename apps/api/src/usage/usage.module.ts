import { PrismaUsageCounters, USAGE_COUNTERS } from '@ayd/core';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LimitsModule } from '../limits/limits.module';
import { UsageController } from './usage.controller';

@Module({
  imports: [AuthModule, LimitsModule],
  controllers: [UsageController],
  providers: [{ provide: USAGE_COUNTERS, useClass: PrismaUsageCounters }],
})
export class UsageModule {}
