import { useInfiniteQuery } from '@tanstack/react-query';
import type { ApiClient } from '../../lib/api-client';
import type { HistoryPage, QueryJobResult } from '../../lib/api-types';
import { runJob, type WatchOptions } from '../../lib/jobs';
import { queryKeys } from '../../lib/query-keys';
import { useAuth } from '../auth';

// Every request the history screen makes.

/** GET /v1/history: 20 entries at a time, newest first; nextCursor fetches older ones. */
export function useHistory() {
  const { api } = useAuth();
  return useInfiniteQuery({
    queryKey: queryKeys.history,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.get<HistoryPage>(
        `/v1/history?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** DELETE /v1/history: every entry. Today's usage still counts. */
export function clearHistory(api: ApiClient): Promise<void> {
  return api.delete('/v1/history');
}

/** DELETE /v1/history/:id */
export function deleteHistoryEntry(api: ApiClient, id: string): Promise<void> {
  return api.delete(`/v1/history/${id}`);
}

/** POST /v1/history/:id/rerun: a query.run job replaying the stored SQL, with no model call. */
export function rerunHistoryEntry(api: ApiClient, id: string, options: WatchOptions) {
  return runJob<QueryJobResult>(api, `/v1/history/${id}/rerun`, undefined, options);
}
