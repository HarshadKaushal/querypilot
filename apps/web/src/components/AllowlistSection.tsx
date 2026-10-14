import { Alert, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../api/client';
import { runJob } from '../api/jobs';
import type { AllowlistView, JobError, JobView, RefreshSummary } from '../api/types';
import { isAbort, useUnmountSignal } from '../api/use-abort';
import { useAuth } from '../auth/auth-context';
import { AllowlistEditor } from './AllowlistEditor';
import { ErrorAlert } from './ErrorAlert';
import { JobProgress } from './JobProgress';

export function allowlistKey(connectionId: string) {
  return ['allowlist', connectionId] as const;
}

/**
 * Reads the schema (a worker job) and edits the allowlist of one connection. Used by the
 * connect wizard, right after the first read, and by the connection page.
 */
export function AllowlistSection({
  connectionId,
  initialSummary = null,
  initialReadError = null,
  onSaved,
}: {
  connectionId: string;
  initialSummary?: RefreshSummary | null;
  initialReadError?: JobError | null;
  onSaved?: () => void;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const signal = useUnmountSignal();
  const [reading, setReading] = useState<JobView | null>(null);
  const [readError, setReadError] = useState<unknown>(initialReadError);
  const [summary, setSummary] = useState<RefreshSummary | null>(initialSummary);

  const allowlist = useQuery({
    queryKey: allowlistKey(connectionId),
    queryFn: ({ signal: querySignal }) =>
      api.get<AllowlistView>(`/v1/connections/${connectionId}/allowlist`, querySignal),
  });
  const notReady =
    allowlist.error instanceof ApiError && allowlist.error.code === 'SCHEMA_NOT_READY';

  async function readSchema() {
    setReadError(null);
    setSummary(null);
    try {
      const done = await runJob<RefreshSummary>(
        api,
        `/v1/connections/${connectionId}/schema/refresh`,
        undefined,
        { signal: signal(), onUpdate: setReading },
      );
      if (done.state === 'succeeded' && done.result) {
        setSummary(done.result);
        await queryClient.invalidateQueries({ queryKey: allowlistKey(connectionId) });
      } else {
        setReadError(done.error ?? null);
      }
    } catch (error) {
      if (!isAbort(error)) {
        setReadError(error);
      }
    } finally {
      setReading(null);
    }
  }

  const newCount = summary
    ? summary.newObjects.tables.length + summary.newObjects.columns.length
    : 0;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>What the AI can see</Title>
        {allowlist.data && (
          <Button
            variant="default"
            size="xs"
            onClick={() => void readSchema()}
            disabled={reading !== null}
          >
            Read schema again
          </Button>
        )}
      </Group>
      {reading && <JobProgress view={reading} label="Reading the schema" />}
      {readError !== null && (
        <ErrorAlert error={readError} title="The schema could not be read" />
      )}
      {summary && (
        <Alert color="blue">
          <Text size="sm">
            Read {summary.tableCount} tables and {summary.columnCount} columns.{' '}
            {summary.defaultsApplied
              ? 'Every table and every column that does not look sensitive starts allowed. Untick anything the AI should not see.'
              : newCount > 0
                ? `${summary.newObjects.tables.length} new tables and ${summary.newObjects.columns.length} new columns start hidden. Tick them if the AI should see them.`
                : 'Nothing new since the last read.'}
          </Text>
        </Alert>
      )}
      {allowlist.isPending && <Loader aria-label="Loading the allowlist" />}
      {notReady && !reading && (
        <Alert color="yellow" title="The schema has not been read yet">
          <Text size="sm" mb="sm">
            Read the tables and columns this login can see, then choose what the AI may
            use.
          </Text>
          <Button size="xs" onClick={() => void readSchema()}>
            Read schema
          </Button>
        </Alert>
      )}
      {allowlist.isError && !notReady && (
        <ErrorAlert error={allowlist.error} title="Could not load the allowlist" />
      )}
      {allowlist.data && (
        <AllowlistEditor
          key={allowlist.data.version}
          connectionId={connectionId}
          view={allowlist.data}
          onReload={() => void allowlist.refetch()}
          onSaved={() => {
            notifications.show({ color: 'green', message: 'The allowlist was saved.' });
            void queryClient.invalidateQueries({ queryKey: allowlistKey(connectionId) });
            onSaved?.();
          }}
        />
      )}
    </Stack>
  );
}
