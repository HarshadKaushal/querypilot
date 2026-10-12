import { loadEnv, type AppEnv } from '../config/env';
import { TokenService } from './token.service';

function env(): AppEnv {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://ayd:ayd@localhost:5434/ayd',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_JWT_SECRET: 'test-jwt-secret-that-is-at-least-32',
    CRYPTO_MASTER_KEY_VERSION: '1',
    CRYPTO_MASTER_KEYS: '1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  });
}

describe('TokenService', () => {
  const tokens = new TokenService(env());

  it('round-trips an access token', async () => {
    const userId = 'user-123';
    const token = await tokens.signAccess(userId);
    await expect(tokens.verifyAccess(token)).resolves.toBe(userId);
  });

  it('rejects a tampered oauth seal', () => {
    const sealed = tokens.seal({ state: 'state-1', verifier: 'verifier-1' });
    expect(tokens.open(sealed)).toEqual({ state: 'state-1', verifier: 'verifier-1' });
    expect(tokens.open(`${sealed}x`)).toBeNull();
  });

  it('stores only a hash of the refresh token', () => {
    const issued = tokens.issueRefresh();
    expect(issued.tokenHash).not.toBe(issued.raw);
    expect(tokens.hash(issued.raw)).toBe(issued.tokenHash);
  });
});
