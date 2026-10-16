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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorAlert } from '../../components/ErrorAlert';
import { JobProgress } from '../../components/JobProgress';
import { ApiError } from '../../lib/api-client';
import type { JobView, PublicConnection } from '../../lib/api-types';
import { queryKeys } from '../../lib/query-keys';
import { isAbort, useUnmountSignal } from '../../lib/use-abort';
import { useAuth } from '../auth';
import { setSampleRows, testConnection, useConnection } from './api';
import { AllowlistSection } from './components/AllowlistSection';

/** One connection: its status, a connection test, the sample-rows choice, the allowlist. */
export function ConnectionPage() {
  const { id = '' } = useParams();
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const signal = useUnmountSignal();
  const [testing, setTesting] = useState<JobView | null>(null);
  const [testError, setTestError] = useState<unknown>(null);

  const connection = useConnection(id);

  function store(updated: PublicConnection) {
    queryClient.setQueryData(queryKeys.connection(id), updated);
    void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
  }

  const sampleRows = useMutation({
    mutationFn: (allowed: boolean) => setSampleRows(api, id, allowed),
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
      const done = await testConnection(api, id, {
        signal: signal(),
        onUpdate: setTesting,
      });
      if (done.state === 'succeeded' && done.result) {
        store(done.result);
        notifications.show({ color: 'green', message: 'The connection works.' });
      } else {
        setTestError(done.error ?? null);
        // A failed test marks the connection as failing.
        void queryClient.invalidateQueries({ queryKey: queryKeys.connection(id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
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
