import { notifications } from '@mantine/notifications';
import { ApiError } from './api-client';

/**
 * A red toast for an action that failed, such as a delete. An ApiError's message was written
 * by the API to be shown; anything else (a network failure, a bug) gets a generic "Try again."
 */
export function notifyError(title: string, error: unknown): void {
  notifications.show({
    color: 'red',
    title,
    message: error instanceof ApiError ? error.message : 'Try again.',
  });
}
