import type { ApiClient } from '../../lib/api-client';

/** DELETE /v1/users/me: the account and everything stored for it, sessions included. */
export function deleteAccount(api: ApiClient): Promise<void> {
  return api.delete('/v1/users/me');
}
