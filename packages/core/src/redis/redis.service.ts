import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_ENV, type CoreEnv } from '../config/env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private connecting?: Promise<void>;

  constructor(@Inject(APP_ENV) env: CoreEnv) {
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
  }

  async ping(): Promise<void> {
    await this.connected();
    const reply = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error('Redis ping failed');
    }
  }

  /** Runs a Lua script atomically on Redis. */
  async run(
    script: string,
    keys: string[],
    args: Array<string | number>,
  ): Promise<unknown> {
    await this.connected();
    return this.client.eval(script, keys.length, ...keys, ...args);
  }

  // The client connects on first use. Callers that arrive while it is still connecting wait
  // for the same attempt: with the offline queue off, a command sent before the connection
  // is ready fails.
  private async connected(): Promise<void> {
    if (this.client.status === 'ready') {
      return;
    }
    this.connecting ??= this.client.connect().catch((error: unknown) => {
      this.connecting = undefined;
      throw error;
    });
    await this.connecting;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') {
      await this.client.quit().catch(() => this.client.disconnect());
    }
  }
}
