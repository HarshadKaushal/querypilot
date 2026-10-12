import { loadEnv } from './env';

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
});
