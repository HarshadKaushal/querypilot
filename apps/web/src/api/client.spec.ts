import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type TokenSource } from './client';

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function tokens(current: string | null, next: string | null = null): TokenSource {
  return { current: () => current, refresh: vi.fn(async () => next) };
}

function authHeader(call: unknown[]): string | null {
  return new Headers((call[1] as RequestInit).headers).get('Authorization');
}

describe('api client', () => {
  it('sends the access token and returns the body', async () => {
    const fetchImpl = vi.fn(async () => json(200, [{ id: 'c1' }]));
    const api = createApiClient(tokens('t1'), fetchImpl);
    expect(await api.get('/v1/connections')).toEqual([{ id: 'c1' }]);
    expect(authHeader(fetchImpl.mock.calls[0])).toBe('Bearer t1');
  });

  it('refreshes once on 401 and repeats the request with the new token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED' } }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const source = tokens('old', 'new');
    const api = createApiClient(source, fetchImpl);
    expect(await api.get('/v1/usage')).toEqual({ ok: true });
    expect(source.refresh).toHaveBeenCalledTimes(1);
    expect(authHeader(fetchImpl.mock.calls[1])).toBe('Bearer new');
  });

  it('gives up with UNAUTHENTICATED when the session cannot be refreshed', async () => {
    const fetchImpl = vi.fn(async () =>
      json(401, {
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Sign in to continue.',
          requestId: 'r1',
        },
      }),
    );
    const api = createApiClient(tokens('old', null), fetchImpl);
    await expect(api.get('/v1/usage')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      requestId: 'r1',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never refreshes for an auth route, so a failed sign-in cannot loop', async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: { code: 'AUTH_FAILED' } }));
    const source = tokens(null, 'new');
    const api = createApiClient(source, fetchImpl);
    await expect(api.post('/v1/auth/dev/login', {})).rejects.toBeInstanceOf(ApiError);
    expect(source.refresh).not.toHaveBeenCalled();
  });

  it('reads the error envelope and Retry-After of a 429', async () => {
    const fetchImpl = vi.fn(async () =>
      json(
        429,
        { error: { code: 'QUOTA_EXCEEDED', message: 'Daily limit.', requestId: 'r2' } },
        { 'Retry-After': '3600' },
      ),
    );
    const api = createApiClient(tokens('t'), fetchImpl);
    await expect(
      api.post('/v1/connections/c1/questions', { question: 'Hi' }),
    ).rejects.toMatchObject({
      status: 429,
      code: 'QUOTA_EXCEEDED',
      message: 'Daily limit.',
      retryAfterSeconds: 3600,
    });
  });

  it('turns a network failure into NETWORK_ERROR, and a non-JSON error into a generic one', async () => {
    const offline = createApiClient(
      tokens('t'),
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    await expect(offline.get('/v1/usage')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
    const proxy = createApiClient(
      tokens('t'),
      vi.fn(async () => new Response('Bad gateway', { status: 502 })),
    );
    await expect(proxy.get('/v1/usage')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 502,
    });
  });

  it('returns the status with send, and nothing for 204', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(202, { id: 'j1' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createApiClient(tokens('t'), fetchImpl);
    expect(await api.send('/v1/connections/c1', { method: 'PATCH', body: {} })).toEqual({
      status: 202,
      data: { id: 'j1' },
    });
    await expect(api.delete('/v1/connections/c1')).resolves.toBeUndefined();
  });
});
