import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * The one Redis connection a process shares. Global, so any module can inject RedisService
 * without importing this one. Redis holds the job queue, live job events, rate limits and
 * quotas, and the locks that keep work on one customer database in order.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
