import { useQuery } from '@tanstack/react-query';
import type { ApiClient } from '../../lib/api-client';
import type {
  AllowlistInput,
  AllowlistView,
  ConnectionInput,
  EgressInfo,
  PublicConnection,
  RefreshSummary,
} from '../../lib/api-types';
import { runJob, type WatchOptions } from '../../lib/jobs';
import { queryKeys } from '../../lib/query-keys';
import { useAuth } from '../auth';

// Every request the connection screens make. Reads are hooks, so TanStack Query caches them
// and shares them between screens; changes are plain functions a page calls.

/** GET /v1/connections: the user's saved databases. */
export function useConnections() {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.connections,
    queryFn: ({ signal }) => api.get<PublicConnection[]>('/v1/connections', signal),
  });
}

/** GET /v1/connections/:id */
export function useConnection(id: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.connection(id),
    queryFn: ({ signal }) => api.get<PublicConnection>(`/v1/connections/${id}`, signal),
  });
}

/** GET /v1/meta/egress: the address and setup SQL shown before connecting. */
export function useEgress() {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.egress,
    queryFn: ({ signal }) => api.get<EgressInfo>('/v1/meta/egress', signal),
  });
}

/** GET /v1/connections/:id/allowlist: every table and column, allowed or not. */
export function useAllowlist(connectionId: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.allowlist(connectionId),
    queryFn: ({ signal }) =>
      api.get<AllowlistView>(`/v1/connections/${connectionId}/allowlist`, signal),
  });
}

/** POST /v1/connections: a connection.create job, which checks the login before saving. */
export function createConnection(
  api: ApiClient,
  input: ConnectionInput,
  options: WatchOptions,
) {
  return runJob<PublicConnection>(api, '/v1/connections', input, options);
}

/** POST /v1/connections/:id/test: a connection.test job. */
export function testConnection(api: ApiClient, id: string, options: WatchOptions) {
  return runJob<PublicConnection>(api, `/v1/connections/${id}/test`, undefined, options);
}

/** POST /v1/connections/:id/schema/refresh: a schema.refresh job. */
export function refreshSchema(
  api: ApiClient,
  connectionId: string,
  options: WatchOptions,
) {
  return runJob<RefreshSummary>(
    api,
    `/v1/connections/${connectionId}/schema/refresh`,
    undefined,
    options,
  );
}

/**
 * PATCH /v1/connections/:id with the sample-rows choice. Only the label and this flag
 * change at once (200); a new address or login is a job.
 */
export async function setSampleRows(
  api: ApiClient,
  id: string,
  allowed: boolean,
): Promise<PublicConnection> {
  const response = await api.send<PublicConnection>(`/v1/connections/${id}`, {
    method: 'PATCH',
    body: { sendSampleRowsToLlm: allowed },
  });
  return response.data;
}

/** DELETE /v1/connections/:id, with its schema, allowlist, saved answers, and history. */
export function deleteConnection(api: ApiClient, id: string): Promise<void> {
  return api.delete(`/v1/connections/${id}`);
}

/** PUT /v1/connections/:id/allowlist: the full list of what the AI may see. */
export async function saveAllowlist(
  api: ApiClient,
  connectionId: string,
  input: AllowlistInput,
): Promise<void> {
  await api.put(`/v1/connections/${connectionId}/allowlist`, input);
}
