import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from '../testing/http-app';
import { testEnv } from '../testing/test-env';
import { UsersController } from '../users/users.controller';
import type { GoogleIdentityProvider } from './google.client';

// Google sign-in configured, with a fake client below.
const GOOGLE_ENV = {
  DEV_LOGIN_ENABLED: 'true',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/v1/auth/google/callback',
};

const google: GoogleIdentityProvider = {
  authorizationUrl: ({ state }) =>
    `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
  exchangeCode: async () => ({
    subject: 'google-subject-1',
    email: 'a@example.com',
    name: 'A',
    avatarUrl: null,
    emailVerified: true,
  }),
};

function cookieHeader(value: string | string[] | undefined): string {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map((item) => item.split(';')[0]).join('; ');
}

describe('auth routes', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createHttpApp({
      controllers: [UsersController],
      env: testEnv(GOOGLE_ENV),
      google,
      requestId: 'req-auth-01',
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('redirects the browser to Google', async () => {
    const response = await request(app.getHttpServer()).get('/v1/auth/google/start');
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('https://accounts.google.com/');
    expect(cookieHeader(response.headers['set-cookie'])).toContain('ayd_oauth=');
  });

  it('rejects an unauthenticated profile request', async () => {
    const response = await request(app.getHttpServer()).get('/v1/users/me');
    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Sign in to continue.',
      requestId: 'req-auth-01',
    });
  });

  it('answers 401, not 500, for a refresh cookie with bad percent-encoding', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', 'ayd_refresh=%E0%A4%A');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('signs in with the dev login, refreshes, and logs out', async () => {
    const server = app.getHttpServer();
    const login = await request(server)
      .post('/v1/auth/dev/login')
      .send({ email: 'dev@localhost' });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('dev@localhost');
    expect(login.body.refreshToken).toBeUndefined();
    const refreshCookie = cookieHeader(login.headers['set-cookie']);
    expect(refreshCookie).toContain('ayd_refresh=');

    const me = await request(server)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(login.body.user.id);

    const refreshed = await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', refreshCookie);
    expect(refreshed.status).toBe(200);
    const rotatedCookie = cookieHeader(refreshed.headers['set-cookie']);

    const reuse = await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', refreshCookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('UNAUTHENTICATED');

    const afterReuse = await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', rotatedCookie);
    expect(afterReuse.status).toBe(401);

    const loggedOut = await request(server)
      .post('/v1/auth/logout')
      .set('Cookie', rotatedCookie);
    expect(loggedOut.status).toBe(204);
  });

  it('returns 503 when Google sign-in is not configured', async () => {
    // The default test environment has no Google client configured.
    const bare = await createHttpApp({ google, requestId: 'req-auth-02' });
    const response = await request(bare.getHttpServer()).get('/v1/auth/google/start');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('AUTH_NOT_CONFIGURED');
    await bare.close();
  });
});
