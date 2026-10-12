import { loadEnv, type AppEnv } from '../config/env';

/** The minimum valid environment for unit tests. Local defaults, never real secrets. */
export const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://ayd:ayd@localhost:5434/ayd',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_JWT_SECRET: 'test-jwt-secret-that-is-at-least-32',
  CRYPTO_MASTER_KEY_VERSION: '1',
  CRYPTO_MASTER_KEYS: '1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
};

/** A parsed AppEnv for tests. Never reads process.env, so local settings cannot leak in. */
export function testEnv(overrides: Record<string, string | undefined> = {}): AppEnv {
  return loadEnv({ ...TEST_ENV, ...overrides });
}
