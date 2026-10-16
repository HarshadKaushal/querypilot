import { Alert, Anchor, Text } from '@mantine/core';
import { Link } from 'react-router';
import { ApiError } from '../../../lib/api-client';
import type { JobError } from '../../../lib/api-types';
import { isJobError } from '../../../lib/jobs';

// A title per failure the user can act on (blueprint 16, states). The message under it is
// the API's own, already written for users.
const TITLES: Record<string, string> = {
  SQL_REJECTED: 'Not run: the query did not pass the safety checks',
  QUERY_WRITE_BLOCKED: 'Not run: only reading is allowed',
  QUERY_NOT_PERMITTED: 'Not run: the login cannot read that',
  QUERY_TIMEOUT: 'The query took too long',
  QUERY_INVALID: 'The query could not run',
  QUERY_SCHEMA_CHANGED: 'Your database has changed',
  QUERY_FAILED: 'The query failed',
  CONNECTION_FAILED: 'Your database could not be reached',
  CONNECTION_BUSY: 'Your database is busy',
  CONNECTION_PAUSED: 'Connections to this database are paused',
  SCHEMA_NOT_READY: 'Choose what the AI can see first',
  LLM_NOT_CONFIGURED: 'The assistant is not set up on this server',
  LLM_UNAVAILABLE: 'The assistant is unavailable right now',
  JOB_CANCELLED: 'Cancelled',
  RATE_LIMITED: 'Slow down a little',
  QUOTA_EXCEEDED: 'Daily limit reached',
  TOO_MANY_JOBS: 'Too much running at once',
};

/** "about 2 minutes", "about 7 hours": the wait in a 429's Retry-After. */
export function formatWait(seconds: number): string {
  if (seconds < 90) {
    return `${Math.max(1, Math.round(seconds))} seconds`;
  }
  if (seconds < 90 * 60) {
    return `about ${Math.round(seconds / 60)} minutes`;
  }
  return `about ${Math.round(seconds / 3600)} hours`;
}

/** A refused request or a failed job, with a designed title and what to do next. */
export function FailureView({
  error,
  connectionId,
}: {
  error: ApiError | JobError | unknown;
  connectionId: string;
}) {
  const known = error instanceof ApiError || isJobError(error);
  const code = known ? (error as JobError).code : 'INTERNAL_ERROR';
  const message = known
    ? (error as JobError).message
    : 'Something went wrong. Try again.';
  const cancelled = code === 'JOB_CANCELLED';
  const retryAfter = error instanceof ApiError ? error.retryAfterSeconds : null;
  const guardCode = isJobError(error) ? error.detail?.guardCode : undefined;
  return (
    <Alert
      color={
        cancelled
          ? 'gray'
          : code.startsWith('SQL_') || code === 'QUOTA_EXCEEDED'
            ? 'orange'
            : 'red'
      }
      title={TITLES[code] ?? 'Something went wrong'}
      role="alert"
    >
      <Text size="sm">{message}</Text>
      {retryAfter !== null && (
        <Text size="sm" mt={4}>
          You can try again in {formatWait(retryAfter)}.
        </Text>
      )}
      {guardCode && (
        <Text size="xs" c="dimmed" mt={4}>
          Safety check: {guardCode}. Nothing ran on your database.
        </Text>
      )}
      {(code === 'SCHEMA_NOT_READY' || code === 'QUERY_SCHEMA_CHANGED') && (
        <Anchor component={Link} to={`/connections/${connectionId}`} size="sm">
          Open the connection to read the schema and choose tables
        </Anchor>
      )}
      {error instanceof ApiError && error.requestId && (
        <Text size="xs" c="dimmed" mt={4}>
          Request id: {error.requestId}
        </Text>
      )}
      {!cancelled && !(error instanceof ApiError) && known && (
        <Text size="xs" c="dimmed" mt={4}>
          Code: {code}
        </Text>
      )}
    </Alert>
  );
}
