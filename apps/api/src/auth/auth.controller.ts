import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Redirect,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';
import { AuthRateLimitGuard } from '../limits/auth-rate-limit.guard';
import { AuthService } from './auth.service';
import {
  OAUTH_COOKIE,
  REFRESH_COOKIE,
  clearRefreshCookieOptions,
  oauthCookieOptions,
  readCookie,
  refreshCookieOptions,
  requestMeta,
} from './cookies';

interface DevLoginBody {
  email?: unknown;
  name?: unknown;
}

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  @Get('google/start')
  @Redirect()
  start(@Res({ passthrough: true }) response: Response): {
    url: string;
    statusCode: number;
  } {
    const begun = this.auth.beginGoogle();
    response.cookie(OAUTH_COOKIE, begun.sealed, oauthCookieOptions(this.env));
    return { url: begun.url, statusCode: 302 };
  }

  @Get('google/callback')
  @UseGuards(AuthRateLimitGuard)
  async callback(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    const session = await this.auth.completeGoogle({
      code,
      state,
      sealed: readCookie(request.header('cookie'), OAUTH_COOKIE),
      meta: requestMeta(request),
    });
    this.setRefreshCookie(response, session.refreshToken);
    response.clearCookie(OAUTH_COOKIE, oauthCookieOptions(this.env));
    return this.sessionBody(session);
  }

  @Post('dev/login')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(200)
  async devLogin(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: DevLoginBody,
  ) {
    const session = await this.auth.devLogin({
      email: typeof body?.email === 'string' ? body.email : undefined,
      name: typeof body?.name === 'string' ? body.name : undefined,
      meta: requestMeta(request),
    });
    this.setRefreshCookie(response, session.refreshToken);
    return this.sessionBody(session);
  }

  @Post('refresh')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(200)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.refresh(
      readCookie(request.header('cookie'), REFRESH_COOKIE),
      requestMeta(request),
    );
    this.setRefreshCookie(response, session.refreshToken);
    return this.sessionBody(session);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(
      readCookie(request.header('cookie'), REFRESH_COOKIE),
      requestMeta(request),
    );
    response.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions(this.env));
  }

  private setRefreshCookie(response: Response, refreshToken: string): void {
    response.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(this.env));
  }

  private sessionBody(session: {
    accessToken: string;
    expiresIn: number;
    user: {
      id: string;
      email: string;
      name: string;
      avatarUrl: string | null;
      planTier: string;
    };
  }) {
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user: session.user,
    };
  }
}
