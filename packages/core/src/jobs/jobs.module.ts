import { Module } from '@nestjs/common';
import { ConnectionsCoreModule } from '../connections/connections-core.module';
import { SchemaCoreModule } from '../schema/schema-core.module';
import { SqlGuardCoreModule } from '../sql-guard/sql-guard-core.module';
import { UserDatabaseModule } from '../user-database/user-database.module';
import { ConnectionJobRunner } from './connection-job.runner';
import { JobCancellation } from './job-cancellation';
import { JobEvents } from './job-events';
import { JobProcessor } from './job-processor';
import { JobQueue } from './job-queue.service';
import { QueryJobRunner } from './query-job.runner';

/** Adding, reading, cancelling, and following jobs. The API imports this. */
@Module({
  providers: [JobQueue, JobCancellation, JobEvents],
  exports: [JobQueue, JobEvents],
})
export class JobQueueModule {}

/** Running jobs. The worker imports this, and runs every job that reaches a user database. */
@Module({
  imports: [
    ConnectionsCoreModule,
    SchemaCoreModule,
    SqlGuardCoreModule,
    UserDatabaseModule,
  ],
  providers: [QueryJobRunner, ConnectionJobRunner, JobCancellation, JobProcessor],
  exports: [JobProcessor],
})
export class JobRunnersModule {}
