import { ConnectionsCoreModule, JobQueueModule } from '@ayd/core';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { ConnectionsController } from './connections.controller';

@Module({
  imports: [AuthModule, ConnectionsCoreModule, JobQueueModule],
  controllers: [ConnectionsController],
})
export class ConnectionsModule {}
