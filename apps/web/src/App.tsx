import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ApiError } from './api/client';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { AppLayout } from './layout/AppLayout';
import { AskPage } from './pages/AskPage';
import { ConnectionPage } from './pages/ConnectionPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { ConnectWizardPage } from './pages/ConnectWizardPage';
import { SignInPage } from './pages/SignInPage';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx answer will not change on retry; a network blip or 5xx may.
        retry: (failures, error) =>
          failures < 2 &&
          !(error instanceof ApiError && error.status >= 400 && error.status < 500),
        refetchOnWindowFocus: false,
      },
    },
  });
}

const queryClient = createQueryClient();

/** Providers (theme, server data, routing, sign-in) and the pages. */
export function App() {
  return (
    <MantineProvider defaultColorScheme="auto">
      <Notifications />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/ask" element={<AskPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/connections/new" element={<ConnectWizardPage />} />
          <Route path="/connections/:id" element={<ConnectionPage />} />
          <Route path="*" element={<Navigate to="/ask" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
