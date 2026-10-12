import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { DependencyCheck, HealthReport } from '@ayd/shared';
import { safeErrorDetail } from '../common/logging/safe-error';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly logger: Logger,
  ) {}

  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<HealthReport> {
    const [appDatabase, redis] = await Promise.all([
      this.probe('appDatabase', () => this.prisma.ping()),
      this.probe('redis', () => this.redis.ping()),
    ]);
    const status =
      appDatabase.status === 'up' && redis.status === 'up' ? 'ok' : 'degraded';
    return { status, checks: { appDatabase, redis } };
  }

  private async probe(name: string, run: () => Promise<void>): Promise<DependencyCheck> {
    const started = Date.now();
    try {
      await run();
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      this.logger.warn(
        { ...safeErrorDetail(error), dependency: name },
        'dependency check failed',
      );
      return { status: 'down', latencyMs: Date.now() - started };
    }
  }
}
