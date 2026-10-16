import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

/** The cache for server data, with the app's retry rules. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx answer will not change on retry; a network blip or 5xx may.
        retry: (failures, error) =>
          failures < 2 &&
          !(error instanceof ApiError && error.status >= 400 && error.status < 500),
        refetchOnWindowFocus: false,
      },
    },
  });
}
