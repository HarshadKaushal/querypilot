/**
 * Every piece of server data the app keeps in TanStack Query's cache, by its key. A screen
 * that changes data refreshes another screen's data by key (asking a question refreshes
 * history and usage), so the keys live here rather than in one feature, and features never
 * import each other's internals to find them.
 */
export const queryKeys = {
  connections: ['connections'] as const,
  connection: (id: string) => ['connection', id] as const,
  allowlist: (connectionId: string) => ['allowlist', connectionId] as const,
  schema: (connectionId: string | null) => ['schema', connectionId] as const,
  egress: ['egress'] as const,
  history: ['history'] as const,
  usage: ['usage'] as const,
};
