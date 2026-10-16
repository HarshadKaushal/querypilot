import type { CookieOptions } from 'express';
import type { AppEnv } from '../../config/env';

export const REFRESH_COOKIE = 'ayd_refresh';
export const OAUTH_COOKIE = 'ayd_oauth';

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        // Bad percent-encoding (a URIError) is treated as no cookie, so the caller answers
        // 401 like any other missing session, not 500.
        return undefined;
      }
    }
  }
  return undefined;
}

function baseCookie(env: AppEnv, path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path,
  };
}

export function refreshCookieOptions(env: AppEnv): CookieOptions {
  return { ...baseCookie(env, '/v1/auth'), maxAge: env.AUTH_REFRESH_TTL_SECONDS * 1000 };
}

export function clearRefreshCookieOptions(env: AppEnv): CookieOptions {
  return baseCookie(env, '/v1/auth');
}

export function oauthCookieOptions(env: AppEnv): CookieOptions {
  return { ...baseCookie(env, '/v1/auth/google'), maxAge: 10 * 60 * 1000 };
}
