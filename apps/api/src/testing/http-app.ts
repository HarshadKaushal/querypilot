import { DailyQuota, RateLimiter } from '@ayd/core';
import { MemoryDailyQuota, MemoryRateLimiter } from '@ayd/core/testing';
import type { INestApplication, Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PinoLogger, type Logger } from 'nestjs-pino';
import { AuthController } from '../auth/auth.controller';
import { AuthGuard } from '../auth/auth.guard';
import { AUTH_REPOSITORY } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { GOOGLE_CLIENT, type GoogleIdentityProvider } from '../auth/google.client';
import { MemoryAuthRepository } from './memory-auth.repository';
import { TokenService } from '../auth/token.service';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';
import { AuthRateLimitGuard } from '../limits/auth-rate-limit.guard';
import { SubmissionLimits } from '../limits/submission-limits';
import { testEnv } from './test-env';

/** A Google client for tests that never sign in with Google. */
const NO_GOOGLE: GoogleIdentityProvider = {
  authorizationUrl: () => '',
  exchangeCode: async () => {
    throw new Error('Google sign-in is not used in this test');
  },
};

/**
 * A Nest app for HTTP tests: the real auth stack (dev login, guard, tokens) backed by an
 * in-memory user store, the real limits over in-memory counters, the real error filter, and
 * a fixed request id. Pass the controllers and providers under test; a provider passed for
 * RateLimiter or DailyQuota replaces the default.
 */
export async function createHttpApp(options: {
  controllers?: Type<unknown>[];
  providers?: Provider[];
  env?: AppEnv;
  google?: GoogleIdentityProvider;
  requestId?: string;
}): Promise<INestApplication> {
  const env = options.env ?? testEnv({ DEV_LOGIN_ENABLED: 'true' });
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController, ...(options.controllers ?? [])],
    providers: [
      AuthService,
      TokenService,
      AuthGuard,
      { provide: APP_ENV, useValue: env },
      { provide: AUTH_REPOSITORY, useClass: MemoryAuthRepository },
      { provide: GOOGLE_CLIENT, useValue: options.google ?? NO_GOOGLE },
      { provide: RateLimiter, useValue: new MemoryRateLimiter() },
      { provide: DailyQuota, useValue: new MemoryDailyQuota() },
      AuthRateLimitGuard,
      { provide: PinoLogger, useValue: { warn: () => undefined } },
      SubmissionLimits,
      ...(options.providers ?? []),
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  const requestId = options.requestId ?? 'req-test-01';
  app.use((req: { id?: string }, _res: unknown, next: () => void) => {
    req.id = requestId;
    next();
  });
  app.useGlobalFilters(
    new AllExceptionsFilter({ error: () => undefined } as unknown as Logger),
  );
  await app.init();
  return app;
}
