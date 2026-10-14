import { Module } from '@nestjs/common';
import { AskJobRunner } from '../ask/ask-job.runner';
import { PrismaProposalCache, PROPOSAL_CACHE } from '../ask/proposal-cache';
import { AUDIT_WRITER, PrismaAuditWriter } from '../audit/audit-writer';
import { HistoryModule } from '../history/history.module';
import { PrismaUsageCounters, USAGE_COUNTERS } from '../limits/usage-counters';
import { LlmModule } from '../llm/llm.module';
import { ConnectionsCoreModule } from '../connections/connections-core.module';
import { SchemaCoreModule } from '../schema/schema-core.module';
import { SqlGuardCoreModule } from '../sql-guard/sql-guard-core.module';
import { UserDatabaseModule } from '../user-database/user-database.module';
import { ConnectionJobRunner } from './connection-job.runner';
import { JobCancellation } from './job-cancellation';
import { JobEvents } from './job-events';
import { UserJobSlots } from './user-job-slots';
import { JobProcessor } from './job-processor';
import { JobQueue } from './job-queue.service';
import { QueryJobRunner } from './query-job.runner';

/** Adding, reading, cancelling, and following jobs. The API imports this. */
@Module({
  providers: [JobQueue, JobCancellation, JobEvents, UserJobSlots],
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
    LlmModule,
    HistoryModule,
  ],
  providers: [
    QueryJobRunner,
    AskJobRunner,
    { provide: PROPOSAL_CACHE, useClass: PrismaProposalCache },
    { provide: USAGE_COUNTERS, useClass: PrismaUsageCounters },
    { provide: AUDIT_WRITER, useClass: PrismaAuditWriter },
    ConnectionJobRunner,
    JobCancellation,
    JobProcessor,
    UserJobSlots,
  ],
  exports: [JobProcessor, UserJobSlots],
})
export class JobRunnersModule {}
