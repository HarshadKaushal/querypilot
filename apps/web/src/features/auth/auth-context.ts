import { createContext, useContext } from 'react';
import type { ApiClient } from '../../lib/api-client';
import type { PublicUser } from '../../lib/api-types';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: PublicUser };

export interface AuthContextValue {
  state: AuthState;
  /** The API client, already holding this session's access token. */
  api: ApiClient;
  signInDev(email: string, name: string): Promise<void>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** The signed-in state and the API client, from the nearest AuthProvider. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
