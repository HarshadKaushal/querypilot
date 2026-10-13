import { loadCoreEnv, type CoreEnv } from '../config/env';

/** The minimum valid core environment for unit tests. Local defaults, never real secrets. */
export const CORE_TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://ayd:ayd@localhost:5434/ayd',
  REDIS_URL: 'redis://localhost:6379',
};

/** A parsed CoreEnv for tests. Never reads process.env, so local settings cannot leak in. */
export function coreTestEnv(overrides: Record<string, string | undefined> = {}): CoreEnv {
  return loadCoreEnv({ ...CORE_TEST_ENV, ...overrides });
}
