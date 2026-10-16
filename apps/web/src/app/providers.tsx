import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import { AuthProvider } from '../features/auth';
import { createQueryClient } from '../lib/query-client';
import { cssVariablesResolver, theme } from './theme';

const queryClient = createQueryClient();

/**
 * What every page can use: the theme, pop-up notifications, the server-data cache, the
 * router, and who is signed in (with the API client). AuthProvider sits inside the others
 * because it clears the cache on sign-out.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      defaultColorScheme="auto"
    >
      <Notifications />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>{children}</AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}
