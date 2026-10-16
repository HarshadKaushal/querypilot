import { useQuery } from '@tanstack/react-query';
import type { UsageToday } from '../../lib/api-types';
import { queryKeys } from '../../lib/query-keys';
import { useAuth } from '../auth';

/** GET /v1/usage: today (UTC) against the limits. */
export function useUsage() {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.usage,
    queryFn: ({ signal }) => api.get<UsageToday>('/v1/usage', signal),
  });
}
