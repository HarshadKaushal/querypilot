import type { AppEnv } from '../../config/env';
import { testEnv } from '../../testing/test-env';
import { MemoryAuthRepository } from '../../testing/memory-auth.repository';
import type { GoogleIdentityProvider, GoogleProfile } from './google.client';
import { AuthService } from './auth.service';
import { TokenService } from '../tokens/token.service';

const meta = { ip: '127.0.0.1', deviceInfo: 'jest' };

function env(overrides: Record<string, string> = {}): AppEnv {
  return testEnv({
    DEV_LOGIN_ENABLED: 'true',
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/v1/auth/google/callback',
    ...overrides,
  });
}

class FakeGoogle implements GoogleIdentityProvider {
  emailVerified = true;
  fail = false;
  verifier = '';

  authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('state', input.state);
    url.searchParams.set('challenge', input.codeChallenge);
    url.searchParams.set('redirect_uri', input.redirectUri);
    return url.toString();
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleProfile> {
    this.verifier = input.codeVerifier;
    if (this.fail) {
      throw new Error('google down');
    }
    return {
      subject: 'google-subject-1',
      email: 'Ada@Example.com',
      name: 'Ada',
      avatarUrl: null,
      emailVerified: this.emailVerified,
    };
  }
}

function setup(overrides: Record<string, string> = {}) {
  const repository = new MemoryAuthRepository();
  const google = new FakeGoogle();
  const loaded = env(overrides);
  const service = new AuthService(repository, google, new TokenService(loaded), loaded);
  return { repository, google, service };
}

describe('AuthService', () => {
  it('hides the dev login when the flag is off', async () => {
    const { service } = setup({ DEV_LOGIN_ENABLED: 'false' });
    await expect(
      service.devLogin({ email: undefined, name: undefined, meta }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('revokes the refresh family when an old token is presented again', async () => {
    const { service, repository } = setup();
    const first = await service.devLogin({ email: 'dev@localhost', name: 'Dev', meta });
    const rotated = await service.refresh(first.refreshToken, meta);
    await expect(service.refresh(first.refreshToken, meta)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(service.refresh(rotated.refreshToken, meta)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(
      repository.audits.some((audit) => audit.eventType === 'auth.refresh_reuse'),
    ).toBe(true);
    expect(JSON.stringify(repository.audits)).not.toContain(first.refreshToken);
  });

  it('logs out one device and leaves another session usable', async () => {
    const { service } = setup();
    const first = await service.devLogin({ email: 'dev@localhost', name: 'Dev', meta });
    const second = await service.devLogin({ email: 'dev@localhost', name: 'Dev', meta });
    await service.logout(first.refreshToken, meta);
    await expect(service.refresh(first.refreshToken, meta)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(service.refresh(second.refreshToken, meta)).resolves.toMatchObject({
      user: { email: 'dev@localhost' },
    });
  });

  it('removes the user on account deletion', async () => {
    const { service, repository } = setup();
    const session = await service.devLogin({ email: 'dev@localhost', name: 'Dev', meta });
    await service.deleteAccount(session.user.id, meta);
    await expect(service.currentUser(session.user.id)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const deleted = repository.audits.find(
      (audit) => audit.eventType === 'account.deleted',
    );
    expect(deleted?.metadata.deletedUserId).toBe(session.user.id);
    expect(deleted?.userId).toBeNull();
  });

  it('rejects a Google callback whose state does not match', async () => {
    const { service, repository } = setup();
    const begun = service.beginGoogle();
    await expect(
      service.completeGoogle({
        code: 'code',
        state: 'other-state',
        sealed: begun.sealed,
        meta,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(repository.users).toHaveLength(0);
  });

  it('creates a user from a verified Google profile and lowercases the email', async () => {
    const { service, google } = setup();
    const begun = service.beginGoogle();
    const state = new URL(begun.url).searchParams.get('state');
    const session = await service.completeGoogle({
      code: 'code',
      state: state ?? undefined,
      sealed: begun.sealed,
      meta,
    });
    expect(session.user.email).toBe('ada@example.com');
    expect(google.verifier.length).toBeGreaterThan(10);
    expect(begun.url).not.toContain(google.verifier);
  });

  it('does not create a user when Google rejects the code', async () => {
    const { service, google, repository } = setup();
    google.fail = true;
    const begun = service.beginGoogle();
    const state = new URL(begun.url).searchParams.get('state');
    await expect(
      service.completeGoogle({
        code: 'code',
        state: state ?? undefined,
        sealed: begun.sealed,
        meta,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(repository.users).toHaveLength(0);
  });
});
