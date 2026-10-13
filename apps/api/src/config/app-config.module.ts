import { Global, Module } from '@nestjs/common';
import { APP_ENV } from '@ayd/core';
import { loadEnv, type AppEnv } from './env';

// The token lives in @ayd/core so its modules can read the same parsed environment.
export { APP_ENV };

@Global()
@Module({
  providers: [
    {
      provide: APP_ENV,
      useFactory: (): AppEnv => loadEnv(),
    },
  ],
  exports: [APP_ENV],
})
export class AppConfigModule {}
