import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadEnv, ROOT_ENV_FILE } from './env';

describe('loadEnv', () => {
  it('requires a redis URL and does not echo it', () => {
    expect(() => loadEnv({ REDIS_URL: 'http://secret-host' })).toThrow(
      'Invalid environment: REDIS_URL',
    );
  });

  it('accepts a redis URL', () => {
    expect(
      loadEnv({
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        REDIS_URL: 'redis://localhost:6379',
      }),
    ).toMatchObject({ REDIS_URL: 'redis://localhost:6379' });
  });

  it('reads .env from the repository root', () => {
    const rootPackage = JSON.parse(
      readFileSync(join(dirname(ROOT_ENV_FILE), 'package.json'), 'utf8'),
    ) as { name: string };
    expect(rootPackage.name).toBe('ask-your-database');
  });
});
