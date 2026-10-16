import type { AppEnv } from '../../config/env';
import { testEnv } from '../../testing/test-env';
import { TokenService } from './token.service';

function env(): AppEnv {
  return testEnv();
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
