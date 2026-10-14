import { Alert, Text } from '@mantine/core';
import { ApiError } from '../api/client';

/**
 * A failed request, shown with the API's own message (already written for users) and the
 * request id, which support can match to the server's logs.
 */
export function ErrorAlert({
  error,
  title = 'Something went wrong',
}: {
  error: unknown;
  title?: string;
}) {
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <Alert color="red" title={title} role="alert">
      <Text size="sm">{message}</Text>
      {requestId && (
        <Text size="xs" c="dimmed" mt={4}>
          Request id: {requestId}
        </Text>
      )}
    </Alert>
  );
}
