import { Alert, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { JobProgress } from '../../../components/JobProgress';
import { ApiError } from '../../../lib/api-client';
import type { RefreshSummary } from '../../../lib/api-types';
import { queryKeys } from '../../../lib/query-keys';
import { useJobRunner } from '../../../lib/use-job-runner';
import { useAuth } from '../../auth';
import { refreshSchema, useAllowlist } from '../api';
import { AllowlistEditor } from './AllowlistEditor';

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
  /** Why the first read failed: a JobError, or an ApiError if the API refused it. */
  initialReadError?: unknown;
  onSaved?: () => void;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const job = useJobRunner();
  const reading = job.busy;
  const [readError, setReadError] = useState<unknown>(initialReadError);
  const [summary, setSummary] = useState<RefreshSummary | null>(initialSummary);

  const allowlist = useAllowlist(connectionId);
  const notReady =
    allowlist.error instanceof ApiError && allowlist.error.code === 'SCHEMA_NOT_READY';

  async function readSchema() {
    setReadError(null);
    setSummary(null);
    const ended = await job.run(async (options) => {
      const done = await refreshSchema(api, connectionId, options);
      if (done.state === 'succeeded') {
        // Reloaded before the progress clears, so the "not read yet" notice does not
        // flash while the new allowlist loads.
        await queryClient.invalidateQueries({
          queryKey: queryKeys.allowlist(connectionId),
        });
      }
      return done;
    });
    if (ended?.ok) {
      setSummary(ended.result);
    } else if (ended) {
      setReadError(ended.error);
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
            disabled={reading}
          >
            Read schema again
          </Button>
        )}
      </Group>
      {job.progress && <JobProgress view={job.progress} label="Reading the schema" />}
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
            void queryClient.invalidateQueries({
              queryKey: queryKeys.allowlist(connectionId),
            });
            onSaved?.();
          }}
        />
      )}
    </Stack>
  );
}
