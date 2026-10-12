import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { ConnectionPools } from './connection-pools';
import { COORDINATION, RedisCoordination } from './coordination';
import { QueryExecutor } from './query-executor';
import { UserDatabaseProbe } from './user-database.probe';

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
export class ExecutorModule {}
