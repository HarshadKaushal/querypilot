import { Navigate, Route, Routes } from 'react-router';
import { SettingsPage } from '../features/account';
import { AskPage } from '../features/ask';
import { RequireAuth, SignInPage } from '../features/auth';
import {
  ConnectionPage,
  ConnectionsPage,
  ConnectWizardPage,
} from '../features/connections';
import { HistoryPage } from '../features/history';
import { UsagePage } from '../features/usage';
import { AppLayout } from './AppLayout';

/** Which page each URL shows. Every page but sign-in needs a signed-in user. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/ask" element={<AskPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/connections/new" element={<ConnectWizardPage />} />
          <Route path="/connections/:id" element={<ConnectionPage />} />
          <Route path="*" element={<Navigate to="/ask" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
