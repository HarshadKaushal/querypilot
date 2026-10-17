import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV } from '../../config/app-config.module';
import type { AppEnv } from '../../config/env';

export interface GoogleProfile {
  subject: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

export interface GoogleIdentityProvider {
  authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleProfile>;
}

export const GOOGLE_CLIENT = Symbol('GOOGLE_CLIENT');

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
// Google signs ID tokens with either form of its issuer name.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Talks to Google for sign-in (OAuth 2.0 authorization code flow with PKCE): builds the URL
 * the browser is sent to, then swaps the returned code for an ID token and checks its
 * signature, issuer, and audience before trusting the profile in it. Tests swap this class
 * for a fake through the GOOGLE_CLIENT token, so no test calls Google.
 */
@Injectable()
export class GoogleOAuthClient implements GoogleIdentityProvider {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string {
    const url = new URL(GOOGLE_AUTH);
    url.searchParams.set('client_id', this.env.GOOGLE_CLIENT_ID);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleProfile> {
    const body = new URLSearchParams({
      code: input.code,
      client_id: this.env.GOOGLE_CLIENT_ID,
      client_secret: this.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: input.codeVerifier,
    });
    const tokenResponse = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tokenResponse.ok) {
      throw new Error('google token exchange failed');
    }
    const tokenJson = (await tokenResponse.json()) as { id_token?: string };
    if (!tokenJson.id_token) {
      throw new Error('google token exchange failed');
    }
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    const jwks = createRemoteJWKSet(new URL(GOOGLE_CERTS));
    const { payload } = await jwtVerify(tokenJson.id_token, jwks, {
      issuer: GOOGLE_ISSUERS,
      audience: this.env.GOOGLE_CLIENT_ID,
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      throw new Error('google identity is incomplete');
    }
    return {
      subject: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : payload.email,
      avatarUrl: typeof payload.picture === 'string' ? payload.picture : null,
      emailVerified: payload.email_verified === true,
    };
  }
}

export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
