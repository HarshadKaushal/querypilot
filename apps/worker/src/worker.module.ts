import {
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import Redis from 'ioredis';
import type { WorkerEnv } from './config/env';

export const WORKER_REDIS = 'WORKER_REDIS';

@Injectable()
export class WorkerRedis implements OnApplicationShutdown {
  constructor(private readonly client: Redis) {}

  async ping(): Promise<void> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
    const reply = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error('Redis ping failed');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.status !== 'end') {
      await this.client.quit().catch(() => this.client.disconnect());
    }
  }
}

@Module({})
export class WorkerModule {
  static register(env: WorkerEnv): DynamicModule {
    const client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    return {
      module: WorkerModule,
      providers: [
        { provide: Redis, useValue: client },
        {
          provide: WORKER_REDIS,
          useFactory: () => new WorkerRedis(client),
        },
      ],
      exports: [WORKER_REDIS],
    };
  }
}
