import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createApiClient } from '../api/client';
import type { Session } from '../api/types';
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context';
import { refreshSession } from './session';

/**
 * Holds who is signed in. The access token lives only in memory (a TokenHolder), never in
 * localStorage, where any script on the page could read it. The refresh token is an
 * httpOnly cookie the page cannot read at all; on load, /v1/auth/refresh turns it back
 * into a session, so a reload keeps the user signed in.
 */
/** The access token. Read when a request is sent, never while rendering. */
class TokenHolder {
  private value: string | null = null;
  get(): string | null {
    return this.value;
  }
  set(value: string | null): void {
    this.value = value;
  }
}

export function AuthProvider({
  children,
  fetchImpl,
}: {
  children: ReactNode;
  fetchImpl?: typeof fetch;
}) {
  // Created once per provider; changing the token does not need a re-render.
  const [token] = useState(() => new TokenHolder());
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const queryClient = useQueryClient();

  const apply = useCallback(
    (session: Session | null) => {
      token.set(session?.accessToken ?? null);
      if (session) {
        setState({ status: 'signedIn', user: session.user });
      } else {
        // Nothing cached for one user may show for the next.
        queryClient.clear();
        setState({ status: 'signedOut' });
      }
    },
    [queryClient, token],
  );

  const api = useMemo(
    () =>
      createApiClient(
        {
          current: () => token.get(),
          refresh: async () => {
            const session = await refreshSession(fetchImpl).catch(() => null);
            apply(session);
            return session?.accessToken ?? null;
          },
        },
        fetchImpl,
      ),
    [apply, fetchImpl, token],
  );

  useEffect(() => {
    let active = true;
    refreshSession(fetchImpl)
      .catch(() => null)
      .then((session) => {
        if (active) {
          apply(session);
        }
      });
    return () => {
      active = false;
    };
  }, [apply, fetchImpl]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      api,
      signInDev: async (email, name) => {
        apply(await api.post<Session>('/v1/auth/dev/login', { email, name }));
      },
      signOut: async () => {
        // Signed out here even if the server cannot be reached; the cookie then expires.
        await api.post('/v1/auth/logout').catch(() => undefined);
        apply(null);
      },
    }),
    [state, api, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
