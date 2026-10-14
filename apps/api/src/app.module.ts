import { PrismaModule, RedisModule } from '@ayd/core';
import { Module } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfigModule } from './config/app-config.module';
import { AuthModule } from './auth/auth.module';
import { ConnectionsModule } from './connections/connections.module';
import { EgressModule } from './egress/egress.module';
import { HealthModule } from './health/health.module';
import { HistoryModule } from './history/history.module';
import { JobsModule } from './jobs/jobs.module';
import { AppLoggerModule } from './logger/logger.module';
import { SchemaModule } from './schema/schema.module';
import { SqlGuardModule } from './sql-guard/sql-guard.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ConnectionsModule,
    EgressModule,
    JobsModule,
    HistoryModule,
    SchemaModule,
    SqlGuardModule,
  ],
  providers: [AllExceptionsFilter],
})
export class AppModule {}
