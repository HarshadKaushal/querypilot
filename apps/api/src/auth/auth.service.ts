import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  AppException,
  invalidRequest,
  notFound,
  UNAUTHENTICATED_MESSAGE,
} from '../common/errors/app.exception';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';
import { AUTH_REPOSITORY, type AuthRepository, type PublicUser } from './auth.repository';
import {
  codeChallenge,
  GOOGLE_CLIENT,
  type GoogleIdentityProvider,
} from './google.client';
import { TokenService } from './token.service';

export interface SessionResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: PublicUser;
}

export interface RequestMeta {
  ip: string | null;
  deviceInfo: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repo: AuthRepository,
    @Inject(GOOGLE_CLIENT) private readonly google: GoogleIdentityProvider,
    private readonly tokens: TokenService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  beginGoogle(): { url: string; sealed: string } {
    if (!this.env.googleConfigured) {
      throw new AppException(
        'AUTH_NOT_CONFIGURED',
        'Google sign-in is not configured.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const state = randomBytes(16).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const url = this.google.authorizationUrl({
      state,
      codeChallenge: codeChallenge(verifier),
      redirectUri: this.env.GOOGLE_REDIRECT_URI,
    });
    return { url, sealed: this.tokens.seal({ state, verifier }) };
  }

  async completeGoogle(input: {
    code: string | undefined;
    state: string | undefined;
    sealed: string | undefined;
    meta: RequestMeta;
  }): Promise<SessionResult> {
    const opened = input.sealed ? this.tokens.open(input.sealed) : null;
    if (!input.code || !input.state || !opened || opened.state !== input.state) {
      throw new AppException(
        'AUTH_FAILED',
        'Google sign-in did not complete.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    let profile;
    try {
      profile = await this.google.exchangeCode({
        code: input.code,
        codeVerifier: opened.verifier,
        redirectUri: this.env.GOOGLE_REDIRECT_URI,
      });
    } catch {
      throw new AppException(
        'AUTH_FAILED',
        'Google sign-in did not complete.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!profile.emailVerified) {
      throw new AppException(
        'AUTH_FAILED',
        'Google has not verified that email address.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const user = await this.repo.upsertGoogleUser({
      googleSubject: profile.subject,
      email: profile.email.trim().toLowerCase(),
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      lastLoginAt: new Date(),
    });
    return this.startSession(user, input.meta, 'google');
  }

  async devLogin(input: {
    email: string | undefined;
    name: string | undefined;
    meta: RequestMeta;
  }): Promise<SessionResult> {
    if (this.env.NODE_ENV === 'production' || !this.env.DEV_LOGIN_ENABLED) {
      throw notFound();
    }
    const email = (input.email?.trim().toLowerCase() || 'dev@localhost').slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
      throw invalidRequest();
    }
    const name = (input.name?.trim() || 'Local developer').slice(0, 80);
    const user = await this.repo.upsertGoogleUser({
      googleSubject: `dev:${email}`,
      email,
      name,
      avatarUrl: null,
      lastLoginAt: new Date(),
    });
    return this.startSession(user, input.meta, 'dev');
  }

  async refresh(raw: string | undefined, meta: RequestMeta): Promise<SessionResult> {
    if (!raw) {
      throw this.unauthenticated();
    }
    const row = await this.repo.findRefreshByHash(this.tokens.hash(raw));
    if (!row) {
      throw this.unauthenticated();
    }
    const now = new Date();
    // A refresh token works once. Seeing a used or revoked one again means it was copied,
    // so every token in its login family is revoked and the owner has to sign in again.
    if (row.revokedAt || row.replacedById) {
      await this.reuse(row.familyId, row.userId, meta.ip, now);
      throw this.unauthenticated();
    }
    if (row.expiresAt <= now) {
      throw this.unauthenticated();
    }
    const next = this.tokens.issueRefresh(row.familyId, now);
    // The rotation succeeds only while the row is still unused, so of two concurrent
    // refreshes with the same token, one wins and the other is treated as reuse. The new
    // token is stored in the same transaction, so a failure cannot leave the old token used
    // with no replacement.
    const rotated = await this.repo.rotateRefresh(
      row.id,
      {
        id: next.id,
        userId: row.userId,
        familyId: next.familyId,
        tokenHash: next.tokenHash,
        expiresAt: next.expiresAt,
        deviceInfo: meta.deviceInfo,
      },
      now,
    );
    if (!rotated) {
      await this.reuse(row.familyId, row.userId, meta.ip, now);
      throw this.unauthenticated();
    }
    const user = await this.repo.findUserById(row.userId);
    if (!user) {
      throw this.unauthenticated();
    }
    return {
      accessToken: await this.tokens.signAccess(user.id),
      expiresIn: this.env.AUTH_ACCESS_TTL_SECONDS,
      refreshToken: next.raw,
      user,
    };
  }

  async logout(raw: string | undefined, meta: RequestMeta): Promise<void> {
    if (!raw) {
      return;
    }
    const row = await this.repo.findRefreshByHash(this.tokens.hash(raw));
    if (!row || row.revokedAt) {
      return;
    }
    await this.repo.revokeToken(row.id, new Date());
    await this.repo.writeAudit({
      userId: row.userId,
      eventType: 'auth.logout',
      metadata: {},
      ip: meta.ip,
    });
  }

  async deleteAccount(userId: string, meta: RequestMeta): Promise<void> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw this.unauthenticated();
    }
    await this.repo.deleteUser(userId, {
      userId,
      eventType: 'account.deleted',
      metadata: { deletedUserId: userId },
      ip: meta.ip,
    });
  }

  async currentUser(userId: string): Promise<PublicUser> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw this.unauthenticated();
    }
    return user;
  }

  async userIdFromAccessToken(token: string): Promise<string> {
    try {
      return await this.tokens.verifyAccess(token);
    } catch {
      throw this.unauthenticated();
    }
  }

  private async startSession(
    user: PublicUser,
    meta: RequestMeta,
    provider: 'google' | 'dev',
  ): Promise<SessionResult> {
    const refresh = this.tokens.issueRefresh();
    await this.repo.insertRefresh({
      id: refresh.id,
      userId: user.id,
      familyId: refresh.familyId,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
      deviceInfo: meta.deviceInfo,
    });
    await this.repo.writeAudit({
      userId: user.id,
      eventType: 'auth.login',
      metadata: { provider },
      ip: meta.ip,
    });
    return {
      accessToken: await this.tokens.signAccess(user.id),
      expiresIn: this.env.AUTH_ACCESS_TTL_SECONDS,
      refreshToken: refresh.raw,
      user,
    };
  }

  private async reuse(
    familyId: string,
    userId: string,
    ip: string | null,
    now: Date,
  ): Promise<void> {
    await this.repo.revokeFamily(familyId, now);
    await this.repo.writeAudit({
      userId,
      eventType: 'auth.refresh_reuse',
      metadata: {},
      ip,
    });
  }

  private unauthenticated(): AppException {
    return new AppException(
      'UNAUTHENTICATED',
      UNAUTHENTICATED_MESSAGE,
      HttpStatus.UNAUTHORIZED,
    );
  }
}
