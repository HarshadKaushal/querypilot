import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';

export interface IssuedRefresh {
  id: string;
  familyId: string;
  raw: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface OAuthSeal {
  state: string;
  verifier: string;
}

@Injectable()
export class TokenService {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  async signAccess(userId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64Url(
      JSON.stringify({
        sub: userId,
        token_use: 'access',
        iat: now,
        exp: now + this.env.AUTH_ACCESS_TTL_SECONDS,
      }),
    );
    const signature = sign(`${header}.${payload}`, this.env.AUTH_JWT_SECRET);
    return `${header}.${payload}.${signature}`;
  }

  /** Returns the user id from a valid access token, or throws. */
  async verifyAccess(token: string): Promise<string> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('invalid access token');
    }
    // The signature is always recomputed with HS256 and our secret, whatever the token's
    // header claims, so a token cannot choose a weaker algorithm. The comparison takes
    // the same time for every byte, so timing cannot reveal how much of a forgery matched.
    const expected = Buffer.from(
      sign(`${parts[0]}.${parts[1]}`, this.env.AUTH_JWT_SECRET),
      'base64url',
    );
    const actual = Buffer.from(parts[2], 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error('invalid access token');
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      sub?: unknown;
      token_use?: unknown;
      exp?: unknown;
    };
    const now = Math.floor(Date.now() / 1000);
    if (
      payload.token_use !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= now
    ) {
      throw new Error('invalid access token');
    }
    return payload.sub;
  }

  issueRefresh(familyId?: string, now = new Date()): IssuedRefresh {
    const resolvedFamily = familyId ?? randomUUID();
    const raw = randomBytes(32).toString('base64url');
    return {
      id: randomUUID(),
      familyId: resolvedFamily,
      raw,
      tokenHash: hashToken(raw),
      expiresAt: new Date(now.getTime() + this.env.AUTH_REFRESH_TTL_SECONDS * 1000),
    };
  }

  hash(raw: string): string {
    return hashToken(raw);
  }

  /**
   * Encrypts the OAuth state and PKCE verifier for the short-lived ayd_oauth cookie, so the
   * API keeps no session between the redirect to Google and the callback. AES-GCM, so a
   * tampered cookie fails to open.
   */
  seal(payload: OAuthSeal): string {
    const key = createHash('sha256').update(this.env.AUTH_JWT_SECRET).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }

  /** Returns the sealed payload, or null for anything forged, tampered with, or malformed. */
  open(sealed: string): OAuthSeal | null {
    try {
      const buffer = Buffer.from(sealed, 'base64url');
      if (buffer.length < 12 + 16 + 2) {
        return null;
      }
      const key = createHash('sha256').update(this.env.AUTH_JWT_SECRET).digest();
      const iv = buffer.subarray(0, 12);
      const tag = buffer.subarray(12, 28);
      const ciphertext = buffer.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const json = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
      const parsed = JSON.parse(json) as Partial<OAuthSeal>;
      if (typeof parsed.state !== 'string' || typeof parsed.verifier !== 'string') {
        return null;
      }
      return { state: parsed.state, verifier: parsed.verifier };
    } catch {
      return null;
    }
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
