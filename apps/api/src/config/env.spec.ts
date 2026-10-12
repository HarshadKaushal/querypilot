import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadEnv, ROOT_ENV_FILE } from './env';

describe('loadEnv', () => {
  const valid = {
    NODE_ENV: 'test',
    API_PORT: '3000',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://ayd:ayd@localhost:5432/ayd',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_JWT_SECRET: 'test-jwt-secret-that-is-at-least-32',
    CRYPTO_MASTER_KEY_VERSION: '1',
    CRYPTO_MASTER_KEYS: '1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  };

  it('accepts a complete environment', () => {
    expect(loadEnv(valid)).toMatchObject({
      NODE_ENV: 'test',
      API_PORT: 3000,
      DATABASE_URL: valid.DATABASE_URL,
      REDIS_URL: valid.REDIS_URL,
    });
  });

  it('names invalid fields and does not echo their values', () => {
    expect(() =>
      loadEnv({
        ...valid,
        DATABASE_URL: 'mysql://secret-user:secret-pass@db/app',
        REDIS_URL: '',
      }),
    ).toThrow('Invalid environment: DATABASE_URL, REDIS_URL');
  });

  it('rejects a short JWT secret without echoing it', () => {
    expect(() =>
      loadEnv({ ...valid, AUTH_JWT_SECRET: 'short-password-hunter2' }),
    ).toThrow('Invalid environment: AUTH_JWT_SECRET');
  });

  it('rejects private-address exceptions in production', () => {
    expect(() =>
      loadEnv({ ...valid, NODE_ENV: 'production', SSRF_ALLOW_PRIVATE: 'true' }),
    ).toThrow('Invalid environment: SSRF_ALLOW_PRIVATE');
  });

  it('rejects the dev login in production', () => {
    expect(() =>
      loadEnv({ ...valid, NODE_ENV: 'production', DEV_LOGIN_ENABLED: 'true' }),
    ).toThrow('Invalid environment: DEV_LOGIN_ENABLED');
  });

  it('requires the full Google trio when any Google setting is present', () => {
    expect(() => loadEnv({ ...valid, GOOGLE_CLIENT_ID: 'client-id-only' })).toThrow(
      'Invalid environment: GOOGLE_CLIENT_ID',
    );
  });

  it('reads .env from the repository root', () => {
    const rootPackage = JSON.parse(
      readFileSync(join(dirname(ROOT_ENV_FILE), 'package.json'), 'utf8'),
    ) as { name: string };
    expect(rootPackage.name).toBe('ask-your-database');
  });
});
