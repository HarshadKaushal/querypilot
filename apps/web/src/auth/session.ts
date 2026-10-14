import { toApiError } from '../api/client';
import type { Session } from '../api/types';

// The API rotates the refresh token on every refresh, and treats a token used twice as
// stolen: it revokes the whole sign-in and the user is signed out. So two refreshes must
// never run at once. Inside a tab, callers share one pending promise (React runs start-up
// effects twice in development). Across tabs, the browser's Web Locks API makes a second
// tab wait, and it then sends the newer cookie the first tab received.
let inFlight: Promise<Session | null> | null = null;

/** A new session from the refresh cookie, or null when there is none or it has expired. */
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
