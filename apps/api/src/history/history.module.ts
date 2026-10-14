import {
  ConnectionsCoreModule,
  HistoryModule as HistoryStoreModule,
  JobQueueModule,
} from '@ayd/core';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LimitsModule } from '../limits/limits.module';
import { HistoryController } from './history.controller';

@Module({
  imports: [
    AuthModule,
    ConnectionsCoreModule,
    HistoryStoreModule,
    JobQueueModule,
    LimitsModule,
  ],
  controllers: [HistoryController],
})
export class HistoryModule {}
