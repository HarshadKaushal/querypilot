import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { ConnectionPools } from './connection-pools';
import { COORDINATION, RedisCoordination } from './coordination';
import { QueryExecutor } from './query-executor';
import { UserDatabaseProbe } from './user-database.probe';

// The blueprint's Executor module: the only code that connects to a user database, for the
// read-only probe, schema introspection, and running queries (blueprint rule 7).
@Module({
  imports: [RedisModule],
  providers: [
    UserDatabaseProbe,
    ConnectionPools,
    QueryExecutor,
    { provide: COORDINATION, useClass: RedisCoordination },
  ],
  exports: [UserDatabaseProbe, ConnectionPools, QueryExecutor],
})
export class UserDatabaseModule {}
