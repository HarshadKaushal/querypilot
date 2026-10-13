import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { postgresAdapter, PrismaClient } from '@ayd/database';
import { APP_ENV, type CoreEnv } from '../config/env';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_ENV) env: CoreEnv) {
    super({ adapter: postgresAdapter(env.DATABASE_URL) });
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
