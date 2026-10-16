import { Group, Loader, Text } from '@mantine/core';
import type { JobStage, JobView } from '../lib/api-types';

const STAGES: Record<JobStage, string> = {
  checking_access: 'Checking that the login can only read',
  reading_schema: 'Reading the tables and columns',
  loading_schema: 'Loading the tables you allowed',
  generating_sql: 'Writing the query',
  checking_sql: 'Checking the query is safe',
  connecting: 'Connecting to your database',
  running_query: 'Running the query',
  summarizing: 'Summarising the answer',
};

/** A running job: a spinner and what the worker is doing now. */
export function JobProgress({ view, label }: { view: JobView | null; label: string }) {
  const detail =
    view?.state === 'queued'
      ? 'Waiting for a worker'
      : view?.stage
        ? STAGES[view.stage]
        : 'Starting';
  return (
    <Group gap="sm" role="status" aria-live="polite">
      <Loader size="sm" />
      <div>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Text size="xs" c="dimmed">
          {detail}
        </Text>
      </div>
    </Group>
  );
}
