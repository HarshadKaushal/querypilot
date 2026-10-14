import {
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { runJob } from '../api/jobs';
import type { JobView, PublicConnection } from '../api/types';
import { isAbort, useUnmountSignal } from '../api/use-abort';
import { useAuth } from '../auth/auth-context';
import { AllowlistSection } from '../components/AllowlistSection';
import { ErrorAlert } from '../components/ErrorAlert';
import { JobProgress } from '../components/JobProgress';
import { CONNECTIONS_KEY } from './ConnectionsPage';

function connectionKey(id: string) {
  return ['connection', id] as const;
}

/** One connection: its status, a connection test, the sample-rows choice, the allowlist. */
export function ConnectionPage() {
  const { id = '' } = useParams();
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const signal = useUnmountSignal();
  const [testing, setTesting] = useState<JobView | null>(null);
  const [testError, setTestError] = useState<unknown>(null);

  const connection = useQuery({
    queryKey: connectionKey(id),
    queryFn: ({ signal: querySignal }) =>
      api.get<PublicConnection>(`/v1/connections/${id}`, querySignal),
  });

  function store(updated: PublicConnection) {
    queryClient.setQueryData(connectionKey(id), updated);
    void queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
  }

  // Only the label and this flag change at once (200); a new address or login is a job.
  const sampleRows = useMutation({
    mutationFn: async (allowed: boolean) =>
      (
        await api.send<PublicConnection>(`/v1/connections/${id}`, {
          method: 'PATCH',
          body: { sendSampleRowsToLlm: allowed },
        })
      ).data,
    onSuccess: store,
    onError: (error) =>
      notifications.show({
        color: 'red',
        title: 'The setting was not saved',
        message: error instanceof ApiError ? error.message : 'Try again.',
      }),
  });

  async function test() {
    setTestError(null);
    try {
      const done = await runJob<PublicConnection>(
        api,
        `/v1/connections/${id}/test`,
        undefined,
        {
          signal: signal(),
          onUpdate: setTesting,
        },
      );
      if (done.state === 'succeeded' && done.result) {
        store(done.result);
        notifications.show({ color: 'green', message: 'The connection works.' });
      } else {
        setTestError(done.error ?? null);
        // A failed test marks the connection as failing.
        void queryClient.invalidateQueries({ queryKey: connectionKey(id) });
        void queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
      }
    } catch (error) {
      if (!isAbort(error)) {
        setTestError(error);
      }
    } finally {
      setTesting(null);
    }
  }

  if (connection.isPending) {
    return <Loader aria-label="Loading the connection" />;
  }
  if (connection.isError) {
    return (
      <Stack>
        <ErrorAlert
          error={connection.error}
          title={
            connection.error instanceof ApiError && connection.error.status === 404
              ? 'This connection was not found'
              : 'Could not load the connection'
          }
        />
        <Anchor component={Link} to="/connections">
          Back to connections
        </Anchor>
      </Stack>
    );
  }

  const current = connection.data;
  const failing = current.status === 'failing';
  return (
    <Stack maw={900}>
      <Anchor component={Link} to="/connections" size="sm">
        ← Connections
      </Anchor>
      <Group justify="space-between">
        <Title order={2}>{current.label}</Title>
        <Badge color={failing ? 'red' : 'green'} variant="light">
          {failing ? 'Failing' : 'Active'}
        </Badge>
      </Group>
      <Card withBorder>
        <Stack gap="sm">
          <Text size="sm">
            {current.host}:{current.port}/{current.databaseName} · SSL {current.sslMode}
          </Text>
          <Text size="xs" c="dimmed">
            {current.lastTestedAt
              ? `Last checked ${new Date(current.lastTestedAt).toLocaleString()}`
              : 'Not checked yet'}
          </Text>
          <Switch
            label="Let the AI see up to 20 result rows when it writes the summary"
            description="Off: it sees only column names, the row count, and numeric totals."
            checked={current.sendSampleRowsToLlm}
            disabled={sampleRows.isPending}
            onChange={(event) => sampleRows.mutate(event.currentTarget.checked)}
          />
          {testing && <JobProgress view={testing} label="Testing the connection" />}
          {testError !== null && (
            <ErrorAlert error={testError} title="The connection test failed" />
          )}
          <Group>
            <Button
              variant="default"
              size="xs"
              onClick={() => void test()}
              disabled={testing !== null}
            >
              Test connection
            </Button>
          </Group>
        </Stack>
      </Card>
      <AllowlistSection connectionId={id} />
    </Stack>
  );
}
