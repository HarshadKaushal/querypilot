import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { APP_ENV } from '../config/app-config.module';
import { loadEnv, type AppEnv } from '../config/env';
import { UsersController } from '../users/users.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AUTH_REPOSITORY } from './auth.repository';
import { AuthService } from './auth.service';
import { GOOGLE_CLIENT, type GoogleIdentityProvider } from './google.client';
import { MemoryAuthRepository } from './memory-auth.repository';
import { TokenService } from './token.service';

function testEnv(): AppEnv {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://ayd:ayd@localhost:5434/ayd',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_JWT_SECRET: 'test-jwt-secret-that-is-at-least-32',
    CRYPTO_MASTER_KEY_VERSION: '1',
    CRYPTO_MASTER_KEYS: '1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    DEV_LOGIN_ENABLED: 'true',
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/v1/auth/google/callback',
  });
}

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
    const env = testEnv();
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, UsersController],
      providers: [
        AuthService,
        TokenService,
        AuthGuard,
        { provide: APP_ENV, useValue: env },
        { provide: AUTH_REPOSITORY, useClass: MemoryAuthRepository },
        { provide: GOOGLE_CLIENT, useValue: google },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: { id?: string }, _res: unknown, next: () => void) => {
      req.id = 'req-auth-01';
      next();
    });
    app.useGlobalFilters(
      new AllExceptionsFilter({ error: jest.fn() } as unknown as Logger),
    );
    await app.init();
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
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://ayd:ayd@localhost:5434/ayd',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_JWT_SECRET: 'test-jwt-secret-that-is-at-least-32',
      CRYPTO_MASTER_KEY_VERSION: '1',
      CRYPTO_MASTER_KEYS: '1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      DEV_LOGIN_ENABLED: 'true',
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        TokenService,
        { provide: APP_ENV, useValue: env },
        { provide: AUTH_REPOSITORY, useClass: MemoryAuthRepository },
        { provide: GOOGLE_CLIENT, useValue: google },
      ],
    }).compile();
    const bare = moduleRef.createNestApplication();
    bare.use((req: { id?: string }, _res: unknown, next: () => void) => {
      req.id = 'req-auth-02';
      next();
    });
    bare.useGlobalFilters(
      new AllExceptionsFilter({ error: jest.fn() } as unknown as Logger),
    );
    await bare.init();
    const response = await request(bare.getHttpServer()).get('/v1/auth/google/start');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('AUTH_NOT_CONFIGURED');
    await bare.close();
  });
});
