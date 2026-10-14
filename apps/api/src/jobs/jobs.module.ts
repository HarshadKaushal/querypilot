import { ConnectionsCoreModule, JobQueueModule } from '@ayd/core';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LimitsModule } from '../limits/limits.module';
import { JobsController } from './jobs.controller';

@Module({
  imports: [AuthModule, ConnectionsCoreModule, JobQueueModule, LimitsModule],
  controllers: [JobsController],
})
export class JobsModule {}
