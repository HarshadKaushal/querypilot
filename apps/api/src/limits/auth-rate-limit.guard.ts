import { RateLimiter, safeErrorDetail, tooMany } from '@ayd/core';
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';

const ONE_MINUTE_MS = 60_000;

/**
 * Limits sign-in, refresh, and the Google callback to AUTH_REQUESTS_PER_MINUTE per IP
 * address, across every API instance, so one source cannot flood them: each call costs a
 * database lookup, a call to Google, or a new user. The app has no passwords (Google
 * checks them) and refresh tokens are 32 random bytes, so this is not what stops guessing.
 * Behind a proxy, request.ip is the proxy's until Express trusts it (Phase 12).
 *
 * Fails open: if Redis is down the request goes through and a warning is logged, so a
 * Redis outage does not also stop people signing in (the user's choice, ADR 0013).
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly rate: RateLimiter,
    @Inject(APP_ENV) private readonly env: AppEnv,
    // PinoLogger takes (fields, message), so the text lands in message, not context.
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    let hit: Awaited<ReturnType<RateLimiter['hit']>>;
    try {
      hit = await this.rate.hit(
        'auth',
        request.ip ?? 'unknown',
        this.env.AUTH_REQUESTS_PER_MINUTE,
        ONE_MINUTE_MS,
      );
    } catch (error) {
      this.logger.warn(
        safeErrorDetail(error),
        'sign-in rate limit skipped: Redis failed',
      );
      return true;
    }
    if (!hit.allowed) {
      throw tooMany(
        'RATE_LIMITED',
        'Too many sign-in attempts from this address. Try again in a minute.',
        hit.retryAfterMs / 1000,
      );
    }
    return true;
  }
}
