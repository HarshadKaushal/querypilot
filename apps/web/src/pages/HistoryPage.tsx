import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client';
import { runJob } from '../api/jobs';
import type {
  HistoryEntry,
  HistoryPage as Page,
  JobView,
  PublicConnection,
  QueryJobResult,
} from '../api/types';
import { isAbort, useUnmountSignal } from '../api/use-abort';
import { useAuth } from '../auth/auth-context';
import { QueryResultView } from '../components/answer/AnswerView';
import { FailureView } from '../components/answer/FailureView';
import { ErrorAlert } from '../components/ErrorAlert';
import { JobProgress } from '../components/JobProgress';
import { CONNECTIONS_KEY } from './ConnectionsPage';

export const HISTORY_KEY = ['history'] as const;

const STATUS: Record<HistoryEntry['status'], { label: string; color: string }> = {
  answered: { label: 'Answered', color: 'green' },
  ambiguous: { label: 'Needed detail', color: 'yellow' },
  unanswerable: { label: 'Unanswerable', color: 'gray' },
  failed: { label: 'Failed', color: 'red' },
  cancelled: { label: 'Cancelled', color: 'gray' },
};

/**
 * Past questions and SQL, newest first (GET /v1/history, 20 at a time with a cursor).
 * History keeps what was asked, the SQL that ran, and the outcome, never the rows; run
 * again replays the stored SQL through the guard, with no model call.
 */
export function HistoryPage() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [clearing, setClearing] = useState(false);

  const history = useInfiniteQuery({
    queryKey: HISTORY_KEY,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page>(
        `/v1/history?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  const connections = useQuery({
    queryKey: CONNECTIONS_KEY,
    queryFn: ({ signal }) => api.get<PublicConnection[]>('/v1/connections', signal),
  });
  const labels = new Map(connections.data?.map((c) => [c.id, c.label]));

  const clearAll = useMutation({
    mutationFn: () => api.delete('/v1/history'),
    onSuccess: () => {
      setClearing(false);
      void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
    },
    onError: (error) => {
      setClearing(false);
      notifications.show({
        color: 'red',
        title: 'History was not cleared',
        message: error instanceof ApiError ? error.message : 'Try again.',
      });
    },
  });

  const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <Stack maw={1000}>
      <Group justify="space-between">
        <Title order={2}>History</Title>
        {entries.length > 0 && (
          <Button
            variant="subtle"
            color="red"
            size="xs"
            onClick={() => setClearing(true)}
          >
            Clear all
          </Button>
        )}
      </Group>
      <Text size="sm" c="dimmed">
        What was asked, the SQL that ran, and how it ended. Result rows are never stored.
      </Text>
      {history.isPending && <Loader aria-label="Loading history" />}
      {history.isError && (
        <ErrorAlert error={history.error} title="Could not load history" />
      )}
      {history.data && entries.length === 0 && (
        <Text c="dimmed">
          Nothing yet. <Link to="/ask">Ask a question</Link> and it appears here.
        </Text>
      )}
      {entries.map((entry) => (
        <HistoryCard
          key={entry.id}
          entry={entry}
          label={labels.get(entry.connectionId)}
        />
      ))}
      {history.hasNextPage && (
        <Group justify="center">
          <Button
            variant="default"
            onClick={() => void history.fetchNextPage()}
            loading={history.isFetchingNextPage}
          >
            Load older
          </Button>
        </Group>
      )}
      <Modal
        opened={clearing}
        onClose={() => setClearing(false)}
        title="Clear all history?"
      >
        <Stack>
          <Text size="sm">
            Every saved question and query is deleted. Your connections and databases are
            not touched, and today's usage still counts.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setClearing(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={clearAll.isPending}
              onClick={() => clearAll.mutate()}
            >
              Clear all
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function HistoryCard({ entry, label }: { entry: HistoryEntry; label?: string }) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const signal = useUnmountSignal();
  const [running, setRunning] = useState<JobView | null>(null);
  const [rerun, setRerun] = useState<
    { ok: true; result: QueryJobResult } | { ok: false; error: unknown } | null
  >(null);

  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/history/${entry.id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: HISTORY_KEY }),
    onError: (error) =>
      notifications.show({
        color: 'red',
        title: 'The entry was not deleted',
        message: error instanceof ApiError ? error.message : 'Try again.',
      }),
  });

  async function runAgain() {
    setRerun(null);
    try {
      const done = await runJob<QueryJobResult>(
        api,
        `/v1/history/${entry.id}/rerun`,
        undefined,
        { signal: signal(), onUpdate: setRunning },
      );
      setRerun(
        done.state === 'succeeded' && done.result
          ? { ok: true, result: done.result }
          : { ok: false, error: done.error ?? null },
      );
      // The re-run is a new job, so it becomes a new entry.
      void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
    } catch (error) {
      if (!isAbort(error)) {
        setRerun({ ok: false, error });
      }
    } finally {
      setRunning(null);
    }
  }

  const status = STATUS[entry.status];
  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={2} style={{ minWidth: 0 }}>
            {entry.kind === 'question' ? (
              <Text fw={500}>{entry.question}</Text>
            ) : (
              <Code block>{entry.sql}</Code>
            )}
            <Text size="xs" c="dimmed">
              {new Date(entry.createdAt).toLocaleString()}
              {label ? ` · ${label}` : ''}
              {entry.rowCount !== null
                ? ` · ${entry.rowCount.toLocaleString()} rows`
                : ''}
              {entry.totalMs ? ` · ${(entry.totalMs / 1000).toFixed(1)} s` : ''}
            </Text>
          </Stack>
          <Group gap={4} wrap="nowrap">
            {entry.cached && (
              <Badge size="sm" variant="light" color="teal">
                saved query
              </Badge>
            )}
            <Badge size="sm" variant="light" color={status.color}>
              {status.label}
            </Badge>
          </Group>
        </Group>
        {entry.summary && <Text size="sm">{entry.summary}</Text>}
        {entry.errorCode && (
          <Text size="xs" c="dimmed">
            Code: {entry.errorCode}
          </Text>
        )}
        <Group gap="xs" justify="flex-end">
          {entry.kind === 'question' && entry.question && (
            <Button
              component={Link}
              to={`/ask?connection=${entry.connectionId}&q=${encodeURIComponent(entry.question)}`}
              size="xs"
              variant="light"
            >
              Ask again
            </Button>
          )}
          {entry.sql && entry.status !== 'cancelled' && (
            <Button
              size="xs"
              variant="light"
              onClick={() => void runAgain()}
              disabled={running !== null}
            >
              Run again
            </Button>
          )}
          <Button
            size="xs"
            variant="subtle"
            color="red"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
            aria-label="Delete this entry"
          >
            Delete
          </Button>
        </Group>
        {running && <JobProgress view={running} label="Running the saved SQL again" />}
        {rerun?.ok && <QueryResultView result={rerun.result} />}
        {rerun && !rerun.ok && (
          <FailureView error={rerun.error} connectionId={entry.connectionId} />
        )}
      </Stack>
    </Card>
  );
}
