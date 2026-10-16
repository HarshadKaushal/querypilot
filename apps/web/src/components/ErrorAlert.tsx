import { Alert, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { ApiError } from '../lib/api-client';
import { isJobError } from '../lib/jobs';

/**
 * A failed request or job, shown with the API's own message (already written for users).
 * A failed request also shows its request id, which support can match to the server's
 * logs; a failed job shows its error code.
 */
export function ErrorAlert({
  error,
  title = 'Something went wrong',
  children,
}: {
  error: unknown;
  title?: string;
  children?: ReactNode;
}) {
  const message =
    error instanceof ApiError || isJobError(error)
      ? error.message
      : 'Something went wrong. Try again.';
  const requestId = error instanceof ApiError ? error.requestId : null;
  const code = !(error instanceof ApiError) && isJobError(error) ? error.code : null;
  return (
    <Alert color="red" title={title} role="alert">
      <Text size="sm">{message}</Text>
      {requestId && (
        <Text size="xs" c="dimmed" mt={4}>
          Request id: {requestId}
        </Text>
      )}
      {code && (
        <Text size="xs" c="dimmed" mt={4}>
          Code: {code}
        </Text>
      )}
      {children}
    </Alert>
  );
}
