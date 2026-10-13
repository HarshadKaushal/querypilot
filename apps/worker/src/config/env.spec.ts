import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadEnv, ROOT_ENV_FILE } from './env';

const VALID = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://ayd:ayd@localhost:5434/ayd',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadEnv', () => {
  it('requires a redis URL and does not echo it', () => {
    expect(() => loadEnv({ ...VALID, REDIS_URL: 'http://secret-host' })).toThrow(
      'Invalid environment: REDIS_URL',
    );
  });

  it('requires the application database URL, which jobs will use', () => {
    expect(() => loadEnv({ ...VALID, DATABASE_URL: undefined })).toThrow(
      'Invalid environment: DATABASE_URL',
    );
  });

  it('accepts the core settings and fills the executor defaults', () => {
    expect(loadEnv(VALID)).toMatchObject({
      REDIS_URL: 'redis://localhost:6379',
      SQL_ROW_CAP: 1000,
      EXECUTOR_STATEMENT_TIMEOUT_MS: 15000,
    });
  });

  it('reads .env from the repository root', () => {
    const rootPackage = JSON.parse(
      readFileSync(join(dirname(ROOT_ENV_FILE), 'package.json'), 'utf8'),
    ) as { name: string };
    expect(rootPackage.name).toBe('ask-your-database');
  });
});
