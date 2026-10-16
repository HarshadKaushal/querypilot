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
import { AppException } from '@ayd/core';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrors } from '../../common/openapi';
import { APP_ENV } from '../../config/app-config.module';
import type { AppEnv } from '../../config/env';
import { requestMeta } from '../../common/request-meta';
import { AuthRateLimitGuard } from '../../limits/auth-rate-limit.guard';
import { AuthService } from './auth.service';
import {
  OAUTH_COOKIE,
  REFRESH_COOKIE,
  clearRefreshCookieOptions,
  oauthCookieOptions,
  readCookie,
  refreshCookieOptions,
} from './cookies';

interface DevLoginBody {
  email?: unknown;
  name?: unknown;
}

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /** A browser link, so a failure goes to the web app's sign-in page, not a JSON page. */
  @Get('google/start')
  @ApiOperation({
    summary: 'Start Google sign-in',
    description:
      'Open this URL in the browser; "Try it out" cannot follow it. Redirects to Google, or to the web app sign-in page with `?error=<code>` when Google sign-in is not configured.',
  })
  @ApiResponse({ status: 302, description: 'Redirect to Google or to the sign-in page.' })
  @Redirect()
  start(@Res({ passthrough: true }) response: Response): {
    url: string;
    statusCode: number;
  } {
    try {
      const begun = this.auth.beginGoogle();
      response.cookie(OAUTH_COOKIE, begun.sealed, oauthCookieOptions(this.env));
      return { url: begun.url, statusCode: 302 };
    } catch (error) {
      if (!(error instanceof AppException)) {
        throw error;
      }
      return { url: this.signInUrl(error.code), statusCode: 302 };
    }
  }

  /**
   * The browser arrives here from Google, so it is sent on to the web app rather than shown
   * JSON. The app then gets its access token from /v1/auth/refresh, using the cookie set
   * here. A sign-in that fails for a known reason goes to the sign-in page with its code.
   */
  @Get('google/callback')
  @ApiOperation({
    summary: 'Google sign-in callback',
    description:
      'Google sends the browser here. Sets the refresh cookie and redirects to the web app, or to its sign-in page with `?error=<code>`. Not for calling by hand.',
  })
  @ApiQuery({ name: 'code', required: false, description: 'From Google.' })
  @ApiQuery({ name: 'state', required: false, description: 'From Google.' })
  @ApiResponse({ status: 302, description: 'Redirect to the web app.' })
  @ApiErrors(429)
  @UseGuards(AuthRateLimitGuard)
  async callback(
    @Req() request: Request,
    @Res() response: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<void> {
    response.clearCookie(OAUTH_COOKIE, oauthCookieOptions(this.env));
    try {
      const session = await this.auth.completeGoogle({
        code,
        state,
        sealed: readCookie(request.header('cookie'), OAUTH_COOKIE),
        meta: requestMeta(request),
      });
      this.setRefreshCookie(response, session.refreshToken);
      response.redirect(302, new URL('/', this.env.APP_WEB_ORIGIN).toString());
    } catch (error) {
      // Anything unexpected still reaches the error filter, which logs it.
      if (!(error instanceof AppException)) {
        throw error;
      }
      response.redirect(302, this.signInUrl(error.code));
    }
  }

  @Post('dev/login')
  @ApiOperation({
    summary: 'Sign in without Google (development only)',
    description:
      'Creates the user on first use, sets the refresh cookie, and returns `accessToken`. Paste that token into **Authorize** to try the other routes. Answers 404 when `DEV_LOGIN_ENABLED` is off.',
  })
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Default: dev@localhost' },
        name: { type: 'string', description: 'Default: Local developer' },
      },
      example: { email: 'swagger@localhost', name: 'Swagger tester' },
    },
  })
  @ApiResponse({ status: 200, description: 'Signed in: accessToken, expiresIn, user.' })
  @ApiErrors(400, 404, 429)
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
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Get a new access token',
    description:
      'Uses the refresh cookie once and sets a new one. Sending an already used cookie signs out every session from that sign-in.',
  })
  @ApiResponse({ status: 200, description: 'A new accessToken, expiresIn, and user.' })
  @ApiErrors(401, 429)
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
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Sign out: revoke the refresh cookie and clear it' })
  @ApiResponse({ status: 204, description: 'Signed out (also when already signed out).' })
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

  /** The web app's sign-in page, told why sign-in failed. */
  private signInUrl(code: string): string {
    const url = new URL('/sign-in', this.env.APP_WEB_ORIGIN);
    url.searchParams.set('error', code);
    return url.toString();
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
