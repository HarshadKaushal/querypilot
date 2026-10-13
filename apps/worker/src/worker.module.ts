import { APP_ENV, createLoggerModule, RedisModule } from '@ayd/core';
import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { WorkerEnv } from './config/env';

/** Provides the parsed environment to every module, as the API's AppConfigModule does. */
@Global()
@Module({})
class WorkerConfigModule {
  static register(env: WorkerEnv): DynamicModule {
    return {
      module: WorkerConfigModule,
      providers: [{ provide: APP_ENV, useValue: env }],
      exports: [APP_ENV],
    };
  }
}

@Module({})
export class WorkerModule {
  static register(env: WorkerEnv): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        WorkerConfigModule.register(env),
        createLoggerModule({ service: 'worker' }),
        RedisModule,
      ],
    };
  }
}
