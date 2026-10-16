import { toApiError, type ApiClient } from '../../lib/api-client';
import type { Session } from '../../lib/api-types';

/** GET /v1/auth/google/start, opened as a full page visit: the API sends the browser on to Google. */
export const GOOGLE_SIGN_IN_URL = '/v1/auth/google/start';

/** POST /v1/auth/dev/login: a session for any email, offered only in development. */
export function devLogin(api: ApiClient, email: string, name: string): Promise<Session> {
  return api.post<Session>('/v1/auth/dev/login', { email, name });
}

/** POST /v1/auth/logout: the API revokes the refresh token and clears its cookie. */
export async function logout(api: ApiClient): Promise<void> {
  await api.post('/v1/auth/logout');
}

// The API rotates the refresh token on every refresh, and treats a token used twice as
// stolen: it revokes the whole sign-in and the user is signed out. So two refreshes must
// never run at once. Inside a tab, callers share one pending promise (React runs start-up
// effects twice in development). Across tabs, the browser's Web Locks API makes a second
// tab wait, and it then sends the newer cookie the first tab received.
let inFlight: Promise<Session | null> | null = null;

/**
 * POST /v1/auth/refresh: a new session from the refresh cookie, or null when there is none
 * or it has expired. Sent with fetch directly, not the API client, because the client
 * itself calls this when a token expires.
 */
export function refreshSession(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<Session | null> {
  if (!inFlight) {
    inFlight = withRefreshLock(() => postRefresh(fetchImpl)).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

function withRefreshLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? locks.request('ayd-refresh', run) : run();
}

async function postRefresh(fetchImpl: typeof fetch): Promise<Session | null> {
  const response = await fetchImpl('/v1/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  return (await response.json()) as Session;
}
