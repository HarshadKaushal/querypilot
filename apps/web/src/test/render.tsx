import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { JobView, PublicUser } from '../api/types';
import { AuthContext, type AuthContextValue, type AuthState } from '../auth/auth-context';
import { theme } from '../theme';

export const USER: PublicUser = {
  id: 'u1',
  email: 'dev@localhost',
  name: 'Local developer',
  avatarUrl: null,
  planTier: 'free',
};

/**
 * An API client whose methods are mocks, for pages that call the API. A mock may return a
 * fixed type where the real method is generic (get<T>), so overrides are loosely typed.
 */
export function fakeApi(
  overrides: { [K in keyof ApiClient]?: (...args: never[]) => unknown } = {},
): ApiClient {
  return {
    send: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    stream: vi.fn(),
    ...overrides,
  } as ApiClient;
}

/**
 * Renders a component with the app's providers: theme, a fresh query cache (no retries),
 * a router at `route`, and a fixed auth context instead of the real sign-in.
 */
export function renderWithApp(
  ui: ReactElement,
  options: {
    api?: ApiClient;
    auth?: Partial<AuthContextValue>;
    state?: AuthState;
    route?: string;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const auth: AuthContextValue = {
    state: options.state ?? { status: 'signedIn', user: USER },
    api: options.api ?? fakeApi(),
    signInDev: vi.fn(),
    signOut: vi.fn(),
    ...options.auth,
  };
  return {
    auth,
    ...render(
      <MantineProvider theme={theme}>
        <Notifications />
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[options.route ?? '/']}>
            <AuthContext.Provider value={auth}>{ui}</AuthContext.Provider>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    ),
  };
}

/** A job view for tests. */
export function job<Result>(fields: Partial<JobView<Result>> = {}): JobView<Result> {
  return {
    id: 'j1',
    kind: 'connection.create',
    state: 'queued',
    createdAt: '2026-10-14T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...fields,
  };
}

/** A response streaming these views as the API's Server-Sent Events. */
export function eventStream(...views: JobView[]): Response {
  const text = views
    .map((view) => `: keep-alive\n\nevent: job\ndata: ${JSON.stringify(view)}\n\n`)
    .join('');
  return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
}
