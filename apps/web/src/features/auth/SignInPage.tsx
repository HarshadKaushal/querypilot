import {
  Alert,
  Button,
  Center,
  Divider,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { ErrorAlert } from '../../components/ErrorAlert';
import { GOOGLE_SIGN_IN_URL } from './api';
import { useAuth } from './auth-context';

// Codes the API puts in ?error= when Google sign-in fails (auth.controller.ts).
const GOOGLE_ERRORS: Record<string, string> = {
  AUTH_FAILED: 'Google sign-in did not complete. Try again.',
  AUTH_NOT_CONFIGURED: 'Google sign-in is not set up on this server yet.',
  RATE_LIMITED: 'Too many sign-in attempts from this address. Try again in a minute.',
};

export function SignInPage({ devLogin = import.meta.env.DEV }: { devLogin?: boolean }) {
  const { state, signInDev } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const [email, setEmail] = useState('dev@localhost');
  const [name, setName] = useState('Local developer');
  const [busy, setBusy] = useState(false);
  const [devError, setDevError] = useState<unknown>(null);

  if (state.status === 'signedIn') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const googleError = params.get('error');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setDevError(null);
    try {
      await signInDev(email, name);
    } catch (error) {
      setDevError(error);
      setBusy(false);
    }
  }

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" radius="md" w="100%" maw={420}>
        <Stack>
          <div>
            <Title order={1} size="h2">
              Ask Your Database
            </Title>
            <Text c="dimmed" size="sm">
              Ask questions about your PostgreSQL data in plain English.
            </Text>
          </div>
          {googleError && (
            <Alert color="red" role="alert">
              {GOOGLE_ERRORS[googleError] ?? 'Sign-in did not complete. Try again.'}
            </Alert>
          )}
          {/* A full page visit, not fetch: the API sends the browser on to Google. */}
          <Button component="a" href={GOOGLE_SIGN_IN_URL} size="md">
            Sign in with Google
          </Button>
          {devLogin && (
            <>
              <Divider label="Local development" labelPosition="center" />
              <form onSubmit={submit}>
                <Stack gap="sm">
                  <TextInput
                    label="Email"
                    value={email}
                    onChange={(event) => setEmail(event.currentTarget.value)}
                    required
                  />
                  <TextInput
                    label="Name"
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                  />
                  {devError !== null && (
                    <ErrorAlert error={devError} title="Dev sign-in failed" />
                  )}
                  <Button type="submit" variant="default" loading={busy}>
                    Dev sign-in
                  </Button>
                </Stack>
              </form>
            </>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
