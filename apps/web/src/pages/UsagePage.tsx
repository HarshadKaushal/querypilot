import {
  Card,
  Group,
  Loader,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { UsageToday } from '../api/types';
import { useAuth } from '../auth/auth-context';
import { ErrorAlert } from '../components/ErrorAlert';

export const USAGE_KEY = ['usage'] as const;

/** Today's usage against the limits (GET /v1/usage). The day is UTC. */
export function UsagePage() {
  const { api } = useAuth();
  const usage = useQuery({
    queryKey: USAGE_KEY,
    queryFn: ({ signal }) => api.get<UsageToday>('/v1/usage', signal),
  });

  if (usage.isPending) {
    return <Loader aria-label="Loading usage" />;
  }
  if (usage.isError) {
    return <ErrorAlert error={usage.error} title="Could not load usage" />;
  }
  const today = usage.data;
  const { used, limit } = today.questions;
  const share = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <Stack maw={800}>
      <Title order={2}>Usage</Title>
      <Card withBorder padding="lg" radius="md">
        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={500}>Questions today</Text>
            <Text fw={700}>
              {used} of {limit}
            </Text>
          </Group>
          <Progress
            value={share}
            color={share >= 100 ? 'red' : share >= 80 ? 'orange' : 'blue'}
            aria-label={`${used} of ${limit} questions used today`}
          />
          <Text size="xs" c="dimmed">
            {used >= limit
              ? 'The daily limit is reached. It resets at midnight UTC.'
              : `${limit - used} left today. The count resets at midnight UTC (${today.day} now).`}{' '}
            Questions still running count already.
          </Text>
        </Stack>
      </Card>
      <SimpleGrid cols={{ base: 1, xs: 3 }}>
        <Stat label="Questions finished" value={today.finishedQuestions} />
        <Stat label="Rows returned" value={today.rowsReturned} />
        <Stat label="AI tokens" value={today.tokens.input + today.tokens.output} />
      </SimpleGrid>
      <Text size="sm" c="dimmed">
        Plan: {today.plan}. You can send up to {today.submissionsPerMinute} questions,
        queries, or re-runs a minute. SQL you write yourself does not count toward the
        daily questions.
      </Text>
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card withBorder padding="md" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text fz={28} fw={700}>
        {value.toLocaleString()}
      </Text>
    </Card>
  );
}
