import { useQuery } from '@tanstack/react-query';
import type { ApiClient } from '../../lib/api-client';
import type { AskResult, QueryJobResult, SchemaView } from '../../lib/api-types';
import { runJob, type WatchOptions } from '../../lib/jobs';
import { queryKeys } from '../../lib/query-keys';
import { useAuth } from '../auth';

// Every request the ask screen makes (cancelling a job is in lib/jobs.ts).

/** GET /v1/connections/:id/schema: only the allowed tables, for the example questions. */
export function useSchema(connectionId: string | null) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.schema(connectionId),
    queryFn: ({ signal }) =>
      api.get<SchemaView>(`/v1/connections/${connectionId}/schema`, signal),
    enabled: connectionId !== null,
  });
}

/** POST /v1/connections/:id/questions: a question.ask job (the model writes the SQL). */
export function askQuestion(
  api: ApiClient,
  connectionId: string,
  question: string,
  options: WatchOptions,
) {
  return runJob<AskResult>(
    api,
    `/v1/connections/${connectionId}/questions`,
    { question },
    options,
  );
}

/** POST /v1/connections/:id/queries: a query.run job for SQL the user wrote. */
export function runSql(
  api: ApiClient,
  connectionId: string,
  sql: string,
  options: WatchOptions,
) {
  return runJob<QueryJobResult>(
    api,
    `/v1/connections/${connectionId}/queries`,
    { sql },
    options,
  );
}
