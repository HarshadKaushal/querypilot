import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useAuth } from './auth-context';
import { AuthProvider } from './AuthProvider';

function Status() {
  const { state } = useAuth();
  return (
    <p>{state.status === 'signedIn' ? `in as ${state.user.email}` : state.status}</p>
  );
}

function session(email: string) {
  return new Response(
    JSON.stringify({
      accessToken: 'a1',
      expiresIn: 900,
      user: { id: 'u1', email, name: 'Dev', avatarUrl: null, planTier: 'free' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function renderProvider(fetchImpl: typeof fetch) {
  return render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider fetchImpl={fetchImpl}>
          <Status />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

describe('AuthProvider', () => {
  it('restores the session from the cookie with exactly one refresh, even in StrictMode', async () => {
    // Two refreshes with the same cookie would look like a stolen token to the API.
    const fetchImpl = vi.fn<typeof fetch>(async () => session('dev@localhost'));
    renderProvider(fetchImpl);
    expect(await screen.findByText('in as dev@localhost')).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('/v1/auth/refresh');
  });

  it('is signed out when there is no valid refresh cookie', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 401 }),
    );
    renderProvider(fetchImpl);
    expect(await screen.findByText('signedOut')).toBeInTheDocument();
  });

  it('is signed out, not stuck loading, when the server cannot be reached', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    renderProvider(fetchImpl);
    await waitFor(() => expect(screen.getByText('signedOut')).toBeInTheDocument());
  });
});
